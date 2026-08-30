"""LiveCode — workspace."""
from __future__ import annotations

from livecode._deps import load_prior
load_prior('livecode.workspace', globals())

import fnmatch
import json
import os
import re
import shutil
import subprocess
import time


SKIP_DIRS = {
    ".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "build",
    ".idea", ".cursor", "target", ".next", ".nuxt", "coverage",
}
SKIP_EXT = {".pyc", ".pyo", ".so", ".dylib", ".dll", ".exe", ".zip", ".tar", ".gz"}
MAX_FILES = 8000
MAX_FILE_SIZE = 2 * 1024 * 1024
MAX_FILESIZE_RG = "2M"
LAYOUT_MAX_CHARS = 10_000
LAYOUT_MAX_DEPTH = 12
LAYOUT_MAX_DIRS = 2000
GLOB_MAX_RESULTS = 100
FIND_FILES_MAX_RESULTS = 50

def _index_path(project_path: str) -> str:
    path = project_file(project_path, "index", "workspace.json")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    return path

def resolve_safe_path(project_path: str, rel_path: str) -> tuple[str | None, str | None]:
    root = os.path.abspath(os.path.expanduser(project_path))
    if not os.path.isdir(root):
        return None, f"Project path does not exist: {project_path}"
    safe_rel = os.path.normpath((rel_path or "").lstrip("/"))
    if safe_rel.startswith("..") or "/.." in safe_rel.split(os.sep):
        return None, "Path traversal not allowed"
    full = os.path.abspath(os.path.join(root, safe_rel)) if safe_rel and safe_rel != "." else root
    if not full.startswith(root + os.sep) and full != root:
        return None, "Path outside project root"
    return full, safe_rel if safe_rel != "." else ""

def _load_gitignore_patterns(project_path: str) -> list[re.Pattern]:
    patterns: list[re.Pattern] = []
    gi = os.path.join(project_path, ".gitignore")
    if not os.path.isfile(gi):
        return patterns
    try:
        with open(gi, "r", errors="replace") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if line.startswith("!"):
                    continue
                pat = line.rstrip("/")
                if "*" in pat or "?" in pat:
                    patterns.append(re.compile("^" + re.escape(pat).replace(r"\*", ".*").replace(r"\?", ".") + "$"))
                else:
                    patterns.append(re.compile(re.escape(pat)))
    except OSError:
        pass
    return patterns

def _ignored(name: str, rel: str, gitignore: list[re.Pattern]) -> bool:
    if name.startswith(".") and name not in (".env", ".env.example"):
        return True
    parts = rel.split(os.sep)
    for p in parts:
        if p in SKIP_DIRS:
            return True
    for pat in gitignore:
        if pat.search(rel) or pat.search(name):
            return True
    return False

def path_blocked_for_edit(project_path: str, safe_rel: str) -> str | None:
    rel = (safe_rel or "").replace("\\", "/").lstrip("/")
    if not rel:
        return None
    parts = rel.split("/")
    for p in parts:
        if p in SKIP_DIRS:
            return (
                f"Refusing to edit gitignored or excluded path: {rel} "
                f"(excluded directory '{p}')"
            )
    name = parts[-1]
    gitignore = _load_gitignore_patterns(os.path.abspath(os.path.expanduser(project_path)))
    for pat in gitignore:
        if pat.search(rel) or pat.search(name):
            return f"Refusing to edit gitignored path: {rel}"
    return None

def _project_mtime(root: str) -> float:
    latest = 0.0
    try:
        latest = max(latest, os.path.getmtime(root))
        for name in os.listdir(root):
            path = os.path.join(root, name)
            try:
                latest = max(latest, os.path.getmtime(path))
            except OSError:
                continue
    except OSError:
        pass
    return latest

def build_workspace_index(project_path: str, force: bool = False) -> dict:
    root = os.path.abspath(os.path.expanduser(project_path))
    cache_file = _index_path(root)
    current_mtime = _project_mtime(root)
    if not force and os.path.isfile(cache_file):
        try:
            with open(cache_file, "r", errors="replace") as f:
                cached = json.load(f)
            if (
                cached.get("project_path") == root
                and cached.get("project_mtime") == current_mtime
            ):
                cached["from_cache"] = True
                return cached
        except (json.JSONDecodeError, OSError):
            pass

    gitignore = _load_gitignore_patterns(root)
    files: list[dict] = []
    ext_counts: dict[str, int] = {}
    top_dirs: list[str] = []

    try:
        for entry in sorted(os.listdir(root)):
            if os.path.isdir(os.path.join(root, entry)) and entry not in SKIP_DIRS and not entry.startswith("."):
                top_dirs.append(entry + "/")
    except OSError:
        pass

    count = 0
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
        for name in filenames:
            if count >= MAX_FILES:
                break
            rel = os.path.relpath(os.path.join(dirpath, name), root)
            if _ignored(name, rel, gitignore):
                continue
            ext = os.path.splitext(name)[1].lower()
            if ext in SKIP_EXT:
                continue
            try:
                size = os.path.getsize(os.path.join(dirpath, name))
            except OSError:
                continue
            if size > MAX_FILE_SIZE:
                continue
            files.append({"rel": rel.replace("\\", "/"), "ext": ext, "size": size})
            ext_counts[ext or "(no ext)"] = ext_counts.get(ext or "(no ext)", 0) + 1
            count += 1

    index = {
        "project_path": root,
        "project_mtime": current_mtime,
        "indexed_at": time.time(),
        "from_cache": False,
        "file_count": len(files),
        "top_dirs": top_dirs[:30],
        "ext_counts": dict(sorted(ext_counts.items(), key=lambda x: -x[1])[:15]),
        "sample_files": [f["rel"] for f in files[:40]],
        "files": files,
    }
    try:
        with open(cache_file, "w") as f:
            json.dump(index, f, indent=0)
    except OSError:
        pass
    return index

def build_project_layout_tree(
    project_path: str,
    *,
    max_chars: int = LAYOUT_MAX_CHARS,
    max_depth: int = LAYOUT_MAX_DEPTH,
    max_dirs: int = LAYOUT_MAX_DIRS,
) -> str:
    root = os.path.abspath(os.path.expanduser(project_path))
    if not os.path.isdir(root):
        return ""
    gitignore = _load_gitignore_patterns(root)
    lines: list[str] = [root]
    chars = len(root)
    dirs_visited = 0

    def _walk(dirpath: str, prefix: str, depth: int) -> None:
        nonlocal chars, dirs_visited
        if depth > max_depth or chars >= max_chars or dirs_visited >= max_dirs:
            return
        try:
            names = sorted(os.listdir(dirpath))
        except OSError:
            return
        dirs: list[str] = []
        files: list[str] = []
        for name in names:
            if name.startswith(".") and name not in (".env", ".env.example"):
                continue
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, root).replace("\\", "/")
            if os.path.isdir(full):
                if name in SKIP_DIRS:
                    continue
                if _ignored(name, rel, gitignore):
                    continue
                dirs.append(name)
            else:
                if _ignored(name, rel, gitignore):
                    continue
                ext = os.path.splitext(name)[1].lower()
                if ext in SKIP_EXT:
                    continue
                files.append(name)

        for name in dirs:
            if dirs_visited >= max_dirs or chars >= max_chars:
                break
            dirs_visited += 1
            line = f"{prefix}{name}/"
            if chars + len(line) + 1 > max_chars:
                return
            lines.append(line)
            chars += len(line) + 1
            subpath = os.path.join(dirpath, name)
            sub_names: list[str] = []
            try:
                for sn in os.listdir(subpath):
                    if sn.startswith("."):
                        continue
                    sp = os.path.join(subpath, sn)
                    srel = os.path.relpath(sp, root).replace("\\", "/")
                    if os.path.isdir(sp):
                        if sn in SKIP_DIRS or _ignored(sn, srel, gitignore):
                            continue
                        sub_names.append(sn)
                    else:
                        if _ignored(sn, srel, gitignore):
                            continue
                        ext = os.path.splitext(sn)[1].lower()
                        if ext not in SKIP_EXT:
                            sub_names.append(sn)
            except OSError:
                sub_names = []
            if sub_names and depth < max_depth:
                _walk(subpath, prefix + "  ", depth + 1)
            elif len(sub_names) > 0:
                collapsed = f"{prefix}  [+{len(sub_names)} items]"
                if chars + len(collapsed) + 1 <= max_chars:
                    lines.append(collapsed)
                    chars += len(collapsed) + 1

        shown_files = 0
        for name in files:
            if shown_files >= 8 or chars >= max_chars:
                if len(files) > shown_files:
                    more = f"{prefix}  [+{len(files) - shown_files} files]"
                    if chars + len(more) + 1 <= max_chars:
                        lines.append(more)
                break
            line = f"{prefix}{name}"
            if chars + len(line) + 1 > max_chars:
                break
            lines.append(line)
            chars += len(line) + 1
            shown_files += 1

    _walk(root, "  ", 0)
    text = "\n".join(lines)
    if len(text) > max_chars:
        text = text[:max_chars] + "\n...[truncated]"
    return text

def format_project_layout_block(project_path: str, tree: str | None = None) -> str:
    if tree is None:
        tree = build_project_layout_tree(project_path)
    if not tree:
        return ""
    return f"<project_layout>\n{tree}\n</project_layout>"

def index_summary_brief(index: dict, symbol_index: dict | None = None, max_chars: int = 800) -> str:
    if not index:
        return "No workspace index."
    lines = [
        f"Files: {index.get('file_count', 0)}",
        f"Top dirs: {', '.join(index.get('top_dirs', [])[:12])}",
    ]
    if symbol_index:
        lines.append(
            f"Symbols: {symbol_index.get('symbol_count', 0)} in "
            f"{symbol_index.get('file_count', 0)} files"
        )
    text = "\n".join(lines)
    return text[:max_chars]

def _ripgrep_available() -> bool:
    return bool(shutil.which("rg"))

def glob_files(
    project_path: str,
    pattern: str,
    *,
    path: str = "",
    max_results: int = GLOB_MAX_RESULTS,
) -> dict:
    root = os.path.abspath(os.path.expanduser(project_path))
    if not os.path.isdir(root):
        return {"error": f"Project path does not exist: {project_path}"}

    pat = (pattern or "").strip()
    if not pat:
        return {"error": "pattern is required"}

    cap = min(max(int(max_results or GLOB_MAX_RESULTS), 1), GLOB_MAX_RESULTS)
    search_root, err = resolve_safe_path(project_path, path or ".")
    if search_root is None:
        return {"error": err}
    if not os.path.isdir(search_root):
        return {"error": f"Directory not found: {path or '/'}"}

    rel_root = os.path.relpath(search_root, root).replace("\\", "/")
    if rel_root == ".":
        rel_root = ""

    entries: list[dict[str, str | float]] = []

    if _ripgrep_available():
        cmd = ["rg", "--files", "-g", pat, "--max-filesize", MAX_FILESIZE_RG]
        cmd.append(search_root)
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=30,
                cwd=None,
            )
            lines = [ln.strip() for ln in (result.stdout or "").splitlines() if ln.strip()]
            for line in lines:
                full = line if os.path.isabs(line) else os.path.join(root, line)
                if not full.startswith(root + os.sep) and full != root:
                    continue
                if not os.path.isfile(full):
                    continue
                rel = os.path.relpath(full, root).replace("\\", "/")
                try:
                    mtime = os.path.getmtime(full)
                except OSError:
                    mtime = 0.0
                entries.append({"path": rel, "mtime": mtime})
        except subprocess.TimeoutExpired:
            return {"error": "glob_files timed out (>30s). Narrow path or pattern."}
        except OSError as exc:
            return {"error": str(exc)}
    else:
        norm_pat = pat.lstrip("/")
        for dirpath, dirnames, filenames in os.walk(search_root):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
            for name in filenames:
                full = os.path.join(dirpath, name)
                rel = os.path.relpath(full, root).replace("\\", "/")
                base = os.path.basename(rel)
                if fnmatch.fnmatch(rel, norm_pat) or fnmatch.fnmatch(base, norm_pat):
                    try:
                        mtime = os.path.getmtime(full)
                    except OSError:
                        mtime = 0.0
                    entries.append({"path": rel, "mtime": mtime})

    entries.sort(key=lambda e: float(e.get("mtime") or 0), reverse=True)
    truncated = len(entries) > cap
    kept = entries[:cap]
    paths = [str(e["path"]) for e in kept]
    return {
        "success": True,
        "pattern": pat,
        "path": rel_root or "/",
        "file_count": len(paths),
        "truncated": truncated,
        "files": paths,
    }

def search_file_manifest(
    project_path: str,
    query: str,
    *,
    ext: str = "",
    path_prefix: str = "",
    max_results: int = FIND_FILES_MAX_RESULTS,
) -> dict:
    q = (query or "").strip().lower()
    if not q:
        return {"error": "query is required"}

    cap = min(max(int(max_results or FIND_FILES_MAX_RESULTS), 1), 100)
    ext_norm = (ext or "").strip().lower()
    if ext_norm and not ext_norm.startswith("."):
        ext_norm = f".{ext_norm}"
    prefix = (path_prefix or "").strip().replace("\\", "/").strip("/")
    if prefix and not prefix.endswith("/"):
        prefix = prefix + "/"

    index = build_workspace_index(project_path)
    files = index.get("files") or []
    matches: list[dict[str, str | int]] = []

    for entry in files:
        rel = str(entry.get("rel") or "")
        rel_lower = rel.lower()
        if prefix and not rel_lower.startswith(prefix.lower()):
            continue
        if ext_norm and not rel_lower.endswith(ext_norm):
            continue
        if q not in rel_lower and q not in os.path.basename(rel_lower):
            continue
        matches.append({
            "path": rel,
            "size": int(entry.get("size") or 0),
            "ext": str(entry.get("ext") or ""),
        })
        if len(matches) >= cap:
            break

    return {
        "success": True,
        "query": query,
        "path_prefix": prefix.rstrip("/") if prefix else "",
        "ext": ext_norm,
        "match_count": len(matches),
        "truncated": len(matches) >= cap,
        "files": matches,
    }

def index_summary_text(index: dict, max_chars: int = 3500, symbol_index: dict | None = None) -> str:
    if not index:
        return "No workspace index available."
    lines = [
        f"Project root: {index.get('project_path', '')}",
        f"Indexed files: {index.get('file_count', 0)}",
        f"Top-level dirs: {', '.join(index.get('top_dirs', [])[:20])}",
        f"File types: {', '.join(f'{k}({v})' for k, v in list(index.get('ext_counts', {}).items())[:10])}",
    ]
    if symbol_index:
        lines.append(f"Symbol index: {symbol_index.get('symbol_count', 0)} symbols in {symbol_index.get('file_count', 0)} files")
        langs = symbol_index.get("languages") or {}
        if langs:
            lines.append("Symbol languages: " + ", ".join(f"{k}({v})" for k, v in list(langs.items())[:8]))
    sample = index.get("sample_files") or []
    if sample:
        lines.append("Sample paths: " + ", ".join(sample[:25]))
    text = "\n".join(lines)
    return text[:max_chars]

# ============================================================================
