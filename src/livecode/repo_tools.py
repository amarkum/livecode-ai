"""Repository tool callbacks injected into the LiveCode agent harness."""
from __future__ import annotations

import difflib
import html
import os
import subprocess
from typing import Any

MAX_READ_LINES = 300
MAX_GREP_CHARS = 16_000
CONTEXT_LINES = 3


def _escape(text: str) -> str:
    return html.escape(text or "", quote=True)


def _diff_line_row(line_no: int, content: str, kind: str) -> str:
    wrapper = {
        "added": "diff-line-added-wrapper",
        "deleted": "diff-line-deleted-wrapper",
        "context": "diff-line-context-wrapper",
    }.get(kind, "diff-line-context-wrapper")
    row = {
        "added": "diff-line-added-row",
        "deleted": "diff-line-deleted-row",
        "context": "diff-line-row",
    }.get(kind, "diff-line-row")
    content_cls = {
        "added": "diff-line-content diff-line-added",
        "deleted": "diff-line-content diff-line-deleted",
        "context": "diff-line-content diff-line-context",
    }.get(kind, "diff-line-content diff-line-context")
    gutter_cls = {
        "added": "diff-line-gutter-bar diff-line-gutter-bar-added",
        "deleted": "diff-line-gutter-bar diff-line-gutter-bar-deleted",
        "context": "diff-line-gutter-bar diff-line-gutter-bar-context",
    }.get(kind, "diff-line-gutter-bar diff-line-gutter-bar-context")
    sign_cls = "diff-line-sign"
    if kind == "added":
        sign_cls += " diff-line-sign-added"
    elif kind == "deleted":
        sign_cls += " diff-line-sign-deleted"
    sign_char = {"added": "+", "deleted": "-", "context": ""}.get(kind, "")
    display_content = _escape(content.rstrip("\n\r"))
    return (
        f'<div class="diff-line-wrapper {wrapper}">'
        f'<div class="diff-line-row {row}">'
        f'<span class="{gutter_cls}"></span>'
        f'<span class="diff-line-number-inline">{line_no}</span>'
        f'<span class="{sign_cls}">{_escape(sign_char)}</span>'
        f'<span class="{content_cls}">{display_content}</span>'
        f"</div></div>"
    )


def _build_diff_rows(
    old_lines: list[str],
    new_lines: list[str],
) -> tuple[list[dict[str, Any]], int, int]:
    matcher = difflib.SequenceMatcher(None, old_lines, new_lines)
    rows: list[dict[str, Any]] = []
    additions = deletions = 0
    old_idx = 0

    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            for offset in range(i2 - i1):
                line_no = i1 + offset + 1
                rows.append({
                    "line_no": line_no,
                    "kind": "context",
                    "content": old_lines[i1 + offset],
                })
                old_idx = line_no
        elif tag == "delete":
            for offset in range(i2 - i1):
                line_no = i1 + offset + 1
                rows.append({
                    "line_no": line_no,
                    "kind": "deleted",
                    "content": old_lines[i1 + offset],
                })
                deletions += 1
                old_idx = line_no
        elif tag == "insert":
            for offset in range(j2 - j1):
                line_no = max(old_idx, j1 + offset + 1)
                rows.append({
                    "line_no": line_no,
                    "kind": "added",
                    "content": new_lines[j1 + offset],
                })
                additions += 1
        elif tag == "replace":
            for offset in range(i2 - i1):
                line_no = i1 + offset + 1
                rows.append({
                    "line_no": line_no,
                    "kind": "deleted",
                    "content": old_lines[i1 + offset],
                })
                deletions += 1
            for offset in range(j2 - j1):
                line_no = j1 + offset + 1
                rows.append({
                    "line_no": line_no,
                    "kind": "added",
                    "content": new_lines[j1 + offset],
                })
                additions += 1

    return rows, additions, deletions


def _group_hunk_indices(rows: list[dict[str, Any]], context_lines: int) -> list[list[int]]:
    changed = {idx for idx, row in enumerate(rows) if row["kind"] != "context"}
    if not changed:
        return []

    included: set[int] = set()
    total = len(rows)
    for idx in changed:
        start = max(0, idx - context_lines)
        end = min(total, idx + context_lines + 1)
        included.update(range(start, end))

    groups: list[list[int]] = []
    current: list[int] = []
    for idx in sorted(included):
        if not current or idx == current[-1] + 1:
            current.append(idx)
            continue
        groups.append(current)
        current = [idx]
    if current:
        groups.append(current)
    return groups


def _render_hunk_wrapper(group: list[int], rows: list[dict[str, Any]]) -> str:
    hunk_html: list[str] = []
    hunk_additions = hunk_deletions = 0
    start_line = end_line = 1

    for idx in group:
        row = rows[idx]
        line_no = int(row["line_no"])
        kind = str(row["kind"])
        hunk_html.append(_diff_line_row(line_no, str(row["content"]), kind))
        if kind == "added":
            hunk_additions += 1
        elif kind == "deleted":
            hunk_deletions += 1
        if len(hunk_html) == 1:
            start_line = end_line = line_no
        else:
            start_line = min(start_line, line_no)
            end_line = max(end_line, line_no)

    body = "".join(hunk_html)
    return (
        f'<div class="diff-block-wrapper" data-start-line="{start_line}" '
        f'data-end-line="{end_line}" data-additions="{hunk_additions}" '
        f'data-deletions="{hunk_deletions}">{body}</div>'
    )


def create_diff_html(old: str, new: str, ext: str = "") -> tuple[str, str, int, int]:
    del ext
    old_lines = (old or "").splitlines()
    new_lines = (new or "").splitlines()
    rows, additions, deletions = _build_diff_rows(old_lines, new_lines)

    if not rows:
        diff_html = (
            '<div class="diff-block-wrapper" data-start-line="1" data-end-line="1" '
            'data-additions="0" data-deletions="0">'
            f"{_diff_line_row(1, '', 'context')}</div>"
        )
        plain = difflib.unified_diff(old_lines, new_lines, lineterm="")
        return diff_html, "\n".join(plain), additions, deletions

    hunk_groups = _group_hunk_indices(rows, CONTEXT_LINES)
    if not hunk_groups:
        hunk_groups = [list(range(len(rows)))]

    diff_html = "".join(_render_hunk_wrapper(group, rows) for group in hunk_groups)
    plain = difflib.unified_diff(old_lines, new_lines, lineterm="")
    return diff_html, "\n".join(plain), additions, deletions


def repo_read_fn(
    project_path: str,
    file_path: str,
    start_line: int | None = None,
    end_line: int | None = None,
) -> dict[str, Any]:
    from livecode.workspace import resolve_safe_path

    full, safe_rel = resolve_safe_path(project_path, file_path)
    if full is None:
        return {"error": safe_rel or "Invalid path"}
    if not os.path.isfile(full):
        return {"error": f"File not found: {file_path}"}
    try:
        with open(full, "r", encoding="utf-8", errors="replace") as handle:
            lines = handle.readlines()
    except OSError as exc:
        return {"error": str(exc)}

    start = max(1, int(start_line or 1))
    end = int(end_line or min(len(lines), start + MAX_READ_LINES - 1))
    end = min(end, len(lines))
    if end - start + 1 > MAX_READ_LINES:
        end = start + MAX_READ_LINES - 1

    numbered = [f"{i}|{lines[i - 1].rstrip()}" for i in range(start, end + 1)]
    rel = safe_rel or file_path
    return {
        "success": True,
        "file_path": rel,
        "start_line": start,
        "end_line": end,
        "total_lines": len(lines),
        "showing": f"{start}-{end}",
        "content": "\n".join(numbered),
        "truncated": end < len(lines),
    }


def repo_list_fn(project_path: str, directory: str) -> dict[str, Any]:
    from livecode.workspace import resolve_safe_path

    full, safe_rel = resolve_safe_path(project_path, directory or ".")
    if full is None:
        return {"error": safe_rel or "Invalid path"}
    if not os.path.isdir(full):
        return {"error": f"Directory not found: {directory}"}

    root = os.path.abspath(os.path.expanduser(project_path))
    entries: list[dict[str, str]] = []
    dirs: list[str] = []
    files: list[str] = []
    try:
        for name in sorted(os.listdir(full)):
            if name.startswith(".") and name not in (".env", ".env.example"):
                continue
            path = os.path.join(full, name)
            rel = os.path.relpath(path, root).replace("\\", "/")
            kind = "dir" if os.path.isdir(path) else "file"
            entries.append({"name": name, "path": rel, "type": kind})
            if kind == "dir":
                dirs.append(rel)
            else:
                files.append(rel)
    except OSError as exc:
        return {"error": str(exc)}

    return {
        "success": True,
        "directory": directory or "/",
        "entries": entries,
        "dirs": dirs,
        "files": files,
        "total": len(entries),
    }


def repo_grep_fn(
    project_path: str,
    pattern: str,
    glob_filter: str | None,
    max_results: int,
    directory: str = "",
) -> dict[str, Any]:
    from livecode.workspace import resolve_safe_path

    root = os.path.abspath(os.path.expanduser(project_path))
    search_root, err = resolve_safe_path(project_path, directory or ".")
    if search_root is None:
        return {"error": err or "Invalid search path"}

    cap = min(max(int(max_results or 60), 1), 100)
    cmd = ["rg", "--line-number", "--no-heading", "--color=never", "-m", str(cap), pattern, search_root]
    if glob_filter:
        cmd[1:1] = ["-g", glob_filter]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30, cwd=root)
    except FileNotFoundError:
        return {"error": "ripgrep (rg) not installed"}
    except subprocess.TimeoutExpired:
        return {"error": "grep_repo timed out (>30s)"}

    output = (result.stdout or "")[:MAX_GREP_CHARS]
    matches: list[dict[str, Any]] = []
    for ln in output.splitlines():
        if not ln.strip():
            continue
        parts = ln.split(":", 2)
        if len(parts) >= 3:
            rel = os.path.relpath(parts[0], root).replace("\\", "/")
            try:
                line_no = int(parts[1])
            except ValueError:
                line_no = 0
            matches.append({"file": rel, "line": line_no, "text": parts[2]})
        if len(matches) >= cap:
            break

    return {
        "success": True,
        "pattern": pattern,
        "match_count": len(matches),
        "matches": matches,
        "truncated": len(matches) >= cap,
    }


def repo_ast_fn(project_path: str, file_path: str) -> dict[str, Any]:
    from livecode.codebase_index import _parse_file_symbols
    from livecode.workspace import resolve_safe_path

    full, safe_rel = resolve_safe_path(project_path, file_path)
    if full is None:
        return {"error": safe_rel or "Invalid path"}
    if not os.path.isfile(full):
        return {"error": f"File not found: {file_path}"}
    try:
        with open(full, "r", encoding="utf-8", errors="replace") as handle:
            content = handle.read()
    except OSError as exc:
        return {"error": str(exc)}

    rel = safe_rel or file_path
    symbols = _parse_file_symbols(rel, content)
    return {"success": True, "file_path": rel, "symbols": symbols}


def execute_command_pty_fn(
    project_path: str,
    command: str,
    session_id: str | None = None,
) -> dict[str, Any]:
    del session_id
    root = os.path.abspath(os.path.expanduser(project_path))
    try:
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=600,
            cwd=root,
        )
        output = (result.stdout or "") + (result.stderr or "")
        return {
            "success": result.returncode == 0,
            "exit_code": result.returncode,
            "output": output[:12000],
        }
    except subprocess.TimeoutExpired:
        return {"error": "Command timed out after 600s"}
    except OSError as exc:
        return {"error": str(exc)}
