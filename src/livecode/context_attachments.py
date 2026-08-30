"""LiveCode — context attachments."""
from __future__ import annotations

from livecode._deps import load_prior
load_prior('livecode.context_attachments', globals())

import os
from typing import Any


CHAT_ATTACHMENT_MAX_CHARS = 40_000
FOLDER_LISTING_MAX_CHARS = 10_000

def _read_repo_file_content(project_path: str, repo_path: str) -> tuple[str, bool]:
    full, safe_rel = resolve_safe_path(project_path, repo_path)
    if not full:
        return (str(safe_rel or "Invalid path"), False)
    if not os.path.isfile(full):
        return (f"File not found: {safe_rel}", False)
    try:
        with open(full, "r", errors="replace") as f:
            content = f.read()
    except OSError as exc:
        return (f"Could not read {safe_rel}: {exc}", False)
    truncated = False
    if len(content) > CHAT_ATTACHMENT_MAX_CHARS:
        content = content[:CHAT_ATTACHMENT_MAX_CHARS]
        truncated = True
    return content, truncated

def _build_folder_listing(project_path: str, repo_path: str) -> tuple[str, bool]:
    prefix = (repo_path or "").strip().replace("\\", "/").strip("/")
    index = build_workspace_index(project_path)
    all_files = [str(entry.get("rel") or "") for entry in (index.get("files") or [])]

    matched_files: list[str] = []
    dirs: set[str] = set()
    if prefix:
        dirs.add(prefix)
        prefix_slash = prefix + "/"
        for rel in all_files:
            if rel == prefix or rel.startswith(prefix_slash):
                matched_files.append(rel)
                parts = rel.split("/")
                for i in range(len(parts) - 1):
                    d = "/".join(parts[: i + 1])
                    if d.startswith(prefix) or d == prefix:
                        dirs.add(d)
    else:
        for rel in all_files:
            matched_files.append(rel)
            parts = rel.split("/")
            for i in range(len(parts) - 1):
                dirs.add("/".join(parts[: i + 1]))
        for top in index.get("top_dirs") or []:
            dirs.add(str(top).rstrip("/"))

    label = prefix or "/"
    lines = [
        f"Folder: {label}",
        "",
        "Directories:",
    ]
    for d in sorted(dirs)[:300]:
        lines.append(f"  {d}/")
    lines.extend(["", "Files:"])
    for rel in sorted(matched_files)[:800]:
        lines.append(f"  {rel}")

    text = "\n".join(lines)
    truncated = False
    if len(text) > FOLDER_LISTING_MAX_CHARS:
        text = text[:FOLDER_LISTING_MAX_CHARS] + "\n...(truncated)"
        truncated = True
    return text, truncated

def expand_repo_context_attachments(
    project_path: str,
    attachments: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    expanded: list[dict[str, Any]] = []
    for att in attachments or []:
        if not isinstance(att, dict):
            continue
        att_type = str(att.get("type") or "")
        repo_path = str(att.get("repo_path") or "").strip().replace("\\", "/").lstrip("/")
        name = str(att.get("name") or os.path.basename(repo_path) or repo_path or "context")

        if att_type == "repo_file":
            if not repo_path:
                continue
            content, truncated = _read_repo_file_content(project_path, repo_path)
            out: dict[str, Any] = {
                "name": name,
                "type": "text",
                "content": content,
                "size": len(content),
            }
            if truncated:
                out["truncated"] = True
            expanded.append(out)
            continue

        if att_type == "repo_folder":
            content, truncated = _build_folder_listing(project_path, repo_path)
            out = {
                "name": name,
                "type": "text",
                "content": content,
                "size": len(content),
            }
            if truncated:
                out["truncated"] = True
            expanded.append(out)
            continue

        expanded.append(att)
    return expanded

def list_context_directory(
    project_path: str,
    directory: str = "",
    *,
    limit: int = 50,
) -> dict[str, Any]:
    cap = min(max(int(limit or 50), 1), 100)
    full, safe_rel = resolve_safe_path(project_path, directory or "")
    if not full:
        return {"success": False, "error": str(safe_rel or "Invalid path"), "results": []}
    if not os.path.isdir(full):
        return {
            "success": True,
            "query": "",
            "directory": (safe_rel or "").replace("\\", "/").strip("/"),
            "results": [],
        }

    rel_prefix = (safe_rel or "").replace("\\", "/").strip("/")
    dirs: list[dict[str, str]] = []
    files: list[dict[str, str]] = []
    try:
        entries = sorted(os.listdir(full), key=lambda n: n.lower())
    except OSError as exc:
        return {"success": False, "error": str(exc), "results": []}

    for name in entries:
        if name.startswith("."):
            continue
        child_full = os.path.join(full, name)
        child_rel = f"{rel_prefix}/{name}".strip("/") if rel_prefix else name
        if os.path.isdir(child_full):
            dirs.append({"kind": "folder", "path": child_rel, "name": name})
        elif os.path.isfile(child_full):
            files.append({"kind": "file", "path": child_rel, "name": name})

    results = (dirs + files)[:cap]
    return {
        "success": True,
        "query": "",
        "directory": rel_prefix,
        "results": results,
    }

def search_context_targets(
    project_path: str,
    query: str = "",
    *,
    limit: int = 20,
    directory: str | None = None,
) -> dict[str, Any]:
    cap = min(max(int(limit or 20), 1), 50)
    q = (query or "").strip().lower()

    if not q and directory is not None:
        payload = list_context_directory(project_path, directory, limit=cap)
        payload["query"] = query
        return payload

    index = build_workspace_index(project_path)
    results: list[dict[str, str]] = []
    seen_paths: set[str] = set()

    def _add(kind: str, path: str) -> None:
        path = path.replace("\\", "/").strip("/")
        key = f"{kind}:{path}"
        if key in seen_paths or len(results) >= cap:
            return
        seen_paths.add(key)
        display = os.path.basename(path) if path else "/"
        results.append({
            "kind": kind,
            "path": path,
            "name": display or path,
        })

    if not q:
        for top in (index.get("top_dirs") or [])[:12]:
            _add("folder", str(top).rstrip("/"))
        for rel in (index.get("sample_files") or [])[:12]:
            _add("file", str(rel))
        return {"success": True, "query": query, "results": results[:cap]}

    folder_candidates: set[str] = set()
    for top in index.get("top_dirs") or []:
        folder_candidates.add(str(top).rstrip("/"))
    for entry in index.get("files") or []:
        rel = str(entry.get("rel") or "")
        parts = rel.split("/")
        for i in range(len(parts) - 1):
            folder_candidates.add("/".join(parts[: i + 1]))

    for folder in sorted(folder_candidates, key=lambda p: (p.count("/"), p.lower())):
        folder_lower = folder.lower()
        base = os.path.basename(folder_lower)
        if q in folder_lower or q in base:
            _add("folder", folder)
        if len(results) >= cap:
            break

    file_search = search_file_manifest(project_path, query, max_results=cap)
    for entry in file_search.get("files") or []:
        rel = str(entry.get("path") or "")
        if rel:
            _add("file", rel)
        if len(results) >= cap:
            break

    return {"success": True, "query": query, "results": results[:cap]}

# ============================================================================
