"""LiveCode — search replace."""
from __future__ import annotations

from livecode._deps import load_prior
load_prior('livecode.search_replace', globals())

import os
import re
from dataclasses import dataclass
from typing import Callable

ERROR_MULTIPLE_MATCHES = (
    "The string to replace was found multiple times in the file. "
    "Use replace_all to replace all occurrences, or include more context to only edit one occurrence."
)
ERROR_NO_MATCHES_BASE = (
    "The string to replace was not found in the file, use the read_repo_file tool to see the "
    "correct string."
)
ERROR_USER_EDIT_HINT = " The user may have changed the file since you last read it."
ERROR_UNREAD_HINT = (
    " You have not read this file this turn — call read_repo_file first."
)
ERROR_NO_MATCHES = ERROR_NO_MATCHES_BASE + ERROR_USER_EDIT_HINT
ERROR_SAME_STRING = "Old string and new string are the same"
ERROR_FILE_ALREADY_EXISTS = (
    "File already exists and is not empty. An empty old_string is only allowed "
    "when creating a new file or when the file is empty."
)
ERROR_WHITESPACE_HINT = (
    " If a nearest-match line is shown, copy its exact leading whitespace into old_string "
    "(sibling files may differ by a few spaces)."
)
ERROR_NO_MATCHES_RECOVERY_HINT = (
    "Re-read the target line range with read_repo_file, then retry edit_file using an exact "
    "old_string copied from that file. Do not reuse snippets from sibling files or include "
    "LINE_NUMBER| prefixes."
)
ERROR_BATCH_EDIT_CONFLICT = (
    "Multiple edit_file calls on the same file in one turn conflicted — no changes were written. "
    "Combine all edits into a single edit_file with one old_string/new_string pair."
)
ERROR_BATCH_EDIT_SKIPPED = (
    "Skipped because an earlier edit_file on this file in the same turn failed."
)
ERROR_BATCH_EDIT_ABORTED = (
    "Edit batch aborted before write; no changes were applied to the file."
)

NAME_MAX = 255
CONTEXT_LINES = 3

_READ_LINE_PREFIX_RE = re.compile(r"^(?:\s*\d+\|\s|\d+→)")

_NEAREST_HINT_MAX = 200

@dataclass
class SearchReplaceParams:

    empty_old_string_does_not_override: bool = False
    include_user_edit_hint: bool = True
    unicode_normalized_fallback: bool = True

_UNICODE_CONFUSABLES = str.maketrans({
    "\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"',
    "\u2013": "-", "\u2014": "-", "\u2026": "...",
    "\u00a0": " ", "\u200b": "",
})

def normalize_confusables(text: str) -> str:
    return (text or "").translate(_UNICODE_CONFUSABLES)

def has_confusables(text: str) -> bool:
    return normalize_confusables(text) != text

def find_normalized_match_positions(text: str, pattern: str) -> list[int]:
    norm_pattern = normalize_confusables(pattern)
    if not norm_pattern:
        return []
    norm_text = normalize_confusables(text)
    positions: list[int] = []
    start = 0
    while True:
        idx = norm_text.find(norm_pattern, start)
        if idx == -1:
            break
        positions.append(idx)
        start = idx + max(1, len(norm_pattern))
    return positions

def replace_normalized_matches(text: str, pattern: str, new_string: str, positions: list[int]) -> str:
    if not positions:
        return text
    norm_pattern = normalize_confusables(pattern)
    parts: list[str] = []
    last_end = 0
    for pos in positions:
        parts.append(text[last_end:pos])
        parts.append(new_string)
        last_end = pos + len(norm_pattern)
    parts.append(text[last_end:])
    return "".join(parts)

def build_confusable_hint(file_text: str, old_string: str) -> str:
    if not has_confusables(file_text) and not has_confusables(old_string):
        return ""
    norm_old = normalize_confusables(old_string)
    if norm_old and norm_old in normalize_confusables(file_text):
        return (
            " Unicode look-alike characters may differ (smart quotes, dashes). "
            "Copy exact characters from read_repo_file or retry with normalized punctuation."
        )
    return ""

@dataclass(frozen=True)
class LineRange:

    start_line: int
    end_line: int

def truncate_str_with_marker(s: str, max_len: int) -> str:
    if max_len <= 0:
        return ""
    if len(s) <= max_len:
        return s
    if max_len == 1:
        return "…"
    return s[: max_len - 1] + "…"

def find_match_positions(text: str, old_string: str) -> list[int]:
    if not old_string:
        return []
    positions: list[int] = []
    start = 0
    while True:
        idx = text.find(old_string, start)
        if idx == -1:
            break
        positions.append(idx)
        start = idx + len(old_string)
    return positions

def replace_using_positions(
    text: str,
    positions: list[int],
    old_string: str,
    new_string: str,
) -> str:
    if not positions:
        return text
    parts: list[str] = []
    last_end = 0
    for pos in positions:
        parts.append(text[last_end:pos])
        parts.append(new_string)
        last_end = pos + len(old_string)
    parts.append(text[last_end:])
    return "".join(parts)

def strip_read_line_prefixes(s: str) -> str:
    if not s:
        return s
    lines = s.split("\n")
    stripped = [_READ_LINE_PREFIX_RE.sub("", line) for line in lines]
    return "\n".join(stripped)

def compute_line_range(text: str, start_pos: int, inserted_text: str) -> LineRange:
    start_line = text[:start_pos].count("\n")
    if inserted_text.endswith("\n"):
        lines_in_inserted = inserted_text.count("\n")
    elif inserted_text:
        lines_in_inserted = inserted_text.count("\n") + 1
    else:
        lines_in_inserted = 1
    end_line = start_line + lines_in_inserted - 1
    return LineRange(start_line=start_line, end_line=end_line)

def render_snippet(
    new_text: str,
    new_string: str,
    start_pos: int,
    context_size: int = CONTEXT_LINES,
) -> tuple[str, str, str]:
    line_range = compute_line_range(new_text, start_pos, new_string)
    lines = new_text.splitlines(keepends=True)
    if not lines and new_text == "":
        lines = [""]
    total = len(lines)
    start_line = line_range.start_line
    end_line = min(line_range.end_line, max(0, total - 1))
    snippet_start = max(0, start_line - context_size)
    snippet_end = min(total - 1, end_line + context_size) if total else 0

    before_context = "".join(lines[snippet_start:start_line]) if snippet_start < start_line else ""
    after_context = (
        "".join(lines[end_line + 1 : snippet_end + 1]) if end_line < snippet_end else ""
    )
    snippet_parts: list[str] = []
    for i in range(snippet_start, snippet_end + 1 if total else 0):
        snippet_parts.append(f"{i + 1}→{lines[i]}")
    return "".join(snippet_parts), before_context, after_context

def build_edit_details(
    new_text: str,
    old_string: str,
    new_string: str,
    new_positions: list[int],
    context_lines: int = CONTEXT_LINES,
) -> list[dict]:
    details: list[dict] = []
    for start_pos in new_positions:
        _snippet, context_before, context_after = render_snippet(
            new_text, new_string, start_pos, context_lines
        )
        line_range = compute_line_range(new_text, start_pos, new_string)
        line_start = new_text.rfind("\n", 0, start_pos)
        line_start = 0 if line_start < 0 else line_start + 1
        line_prefix = new_text[line_start:start_pos]
        details.append({
            "old_string": old_string,
            "old_line": line_range.start_line + 1,
            "new_string": new_string,
            "new_line": line_range.start_line + 1,
            "context_before": context_before,
            "context_after": context_after,
            "line_prefix": line_prefix,
        })
    return details

def build_nearest_match_hint(file_text: str, old_string: str) -> str:
    first_line = (old_string.split("\n", 1)[0] if old_string else "") or ""
    tokens = first_line.split()
    if not tokens:
        return ""
    keyword = max(tokens, key=len)
    if not keyword:
        return ""
    for i, line in enumerate(file_text.splitlines()):
        if keyword in line:
            full = f"\n\nNearest match: line {i + 1}: {line.rstrip()}"
            return truncate_str_with_marker(full, _NEAREST_HINT_MAX)
    return ""

def build_no_match_message(
    file_text: str,
    old_string: str,
    *,
    include_user_edit_hint: bool = True,
    file_was_read_this_turn: bool | None = None,
) -> str:
    msg = ERROR_NO_MATCHES_BASE
    if include_user_edit_hint:
        msg += ERROR_USER_EDIT_HINT
    nearest = build_nearest_match_hint(file_text, old_string)
    msg += nearest
    if nearest:
        msg += ERROR_WHITESPACE_HINT
    if file_was_read_this_turn is False:
        msg += ERROR_UNREAD_HINT
    return msg

def validate_path_components(safe_rel: str) -> str | None:
    if not safe_rel:
        return None
    for part in safe_rel.replace("\\", "/").split("/"):
        if part and len(part) > NAME_MAX:
            return (
                f"Error: file name exceeds the {NAME_MAX}-character limit. "
                "Please use a shorter file name."
            )
    return None

def suggest_similar_filename(full_path: str, safe_rel: str) -> str:
    parent = os.path.dirname(full_path) or "."
    target = os.path.basename(safe_rel).lower()
    if not target or not os.path.isdir(parent):
        return ""
    try:
        names = os.listdir(parent)
    except OSError:
        return ""
    best = None
    best_score = 0
    for name in names:
        if not os.path.isfile(os.path.join(parent, name)):
            continue
        n = name.lower()
        if n == target:
            continue
        score = 0
        if n.startswith(target[:3]) or target.startswith(n[:3]):
            score += 2
        shared = set(n) & set(target)
        score += len(shared)
        if abs(len(n) - len(target)) <= 2:
            score += 1
        if score > best_score:
            best_score = score
            best = name
    if best and best_score >= 4:
        parent_rel = os.path.dirname(safe_rel).replace("\\", "/")
        suggestion = f"{parent_rel}/{best}" if parent_rel else best
        return f" Did you mean: {suggestion}?"
    return ""

def _error(kind: str, message: str) -> dict:
    return {"error": message, "error_kind": kind}

def _resolve_search_match(
    match_text: str,
    old_string: str,
) -> tuple[str, list[int]] | tuple[None, None]:
    search_string = old_string
    positions = find_match_positions(match_text, search_string)
    if not positions:
        stripped = strip_read_line_prefixes(old_string)
        if stripped != old_string and stripped:
            search_string = stripped
            positions = find_match_positions(match_text, search_string)
    if not positions:
        return None, None
    return search_string, positions

def _write_file_with_retry(full_path: str, content: str, *, attempts: int = 3) -> None:
    last_err: OSError | None = None
    for attempt in range(attempts):
        try:
            with open(full_path, "w", encoding="utf-8") as f:
                f.write(content)
            return
        except OSError as exc:
            last_err = exc
            if attempt + 1 < attempts:
                time.sleep(0.05 * (2 ** attempt))
    if last_err:
        raise last_err

def _replace_in_text(
    match_text: str,
    old_string: str,
    new_string: str,
    *,
    replace_all: bool = False,
    params: SearchReplaceParams | None = None,
    file_was_read_this_turn: bool | None = None,
) -> tuple[str | None, dict | None, bool]:
    if old_string == new_string:
        return None, _error("invalid_input", ERROR_SAME_STRING), False

    cfg = params or SearchReplaceParams()
    used_normalized = False
    resolved = _resolve_search_match(match_text, old_string)
    search_string = old_string
    positions: list[int] = []

    if resolved[0] is not None:
        search_string, positions = resolved
    elif cfg.unicode_normalized_fallback:
        norm_positions = find_normalized_match_positions(match_text, old_string)
        if norm_positions:
            positions = norm_positions
            search_string = old_string
            used_normalized = True

    if not positions:
        search_string = old_string
        stripped = strip_read_line_prefixes(old_string)
        if stripped != old_string and stripped:
            search_string = stripped
            resolved = _resolve_search_match(match_text, stripped)
            if resolved[0] is not None:
                search_string, positions = resolved
        if not positions and cfg.unicode_normalized_fallback:
            norm_positions = find_normalized_match_positions(match_text, search_string)
            if norm_positions:
                positions = norm_positions
                used_normalized = True

    if not positions:
        msg = build_no_match_message(
            match_text,
            search_string,
            include_user_edit_hint=cfg.include_user_edit_hint,
            file_was_read_this_turn=file_was_read_this_turn,
        )
        hint = build_confusable_hint(match_text, search_string)
        if hint:
            msg += hint
        out = _error("no_matches", msg)
        out["recovery_hint"] = ERROR_NO_MATCHES_RECOVERY_HINT
        return None, out, False

    if len(positions) > 1 and not replace_all:
        return None, _error("multiple_matches", ERROR_MULTIPLE_MATCHES), False

    if used_normalized:
        new_content = replace_normalized_matches(match_text, search_string, new_string, positions)
    else:
        new_content = replace_using_positions(match_text, positions, search_string, new_string)
    return new_content, None, used_normalized

def _success_payload(
    *,
    safe_rel: str,
    full_path: str,
    diff_html: str,
    add_count: int,
    del_count: int,
    edits: list[dict],
    is_new_file: bool,
    replace_count: int,
    pre_content: str | None = None,
    post_content: str | None = None,
) -> dict:
    if is_new_file:
        summary = f"File {safe_rel} created successfully."
    elif replace_count > 1:
        summary = f"All {replace_count} occurrences in {safe_rel} were successfully replaced."
    else:
        summary = f"File {safe_rel} updated successfully."
    out = {
        "success": True,
        "file_path": safe_rel,
        "action": "edit_file",
        "diff_html": diff_html,
        "additions": add_count,
        "deletions": del_count,
        "absolute_path": full_path,
        "edits": edits,
        "is_new_file": is_new_file,
        "summary": summary,
    }
    if pre_content is not None:
        out["pre_content"] = pre_content
    if post_content is not None:
        out["post_content"] = post_content
    return out

def apply_search_replace(
    full_path: str,
    safe_rel: str,
    old_string: str,
    new_string: str,
    create_diff_html_fn: Callable,
    *,
    replace_all: bool = False,
    params: SearchReplaceParams | None = None,
    file_was_read_this_turn: bool | None = None,
) -> dict:
    cfg = params or SearchReplaceParams()

    path_err = validate_path_components(safe_rel)
    if path_err:
        return _error("filename_too_long", path_err)

    if os.path.isdir(full_path):
        return _error("invalid_input", f"Error: {safe_rel} is a directory, not a file.")

    if old_string == new_string:
        return _error("invalid_input", ERROR_SAME_STRING)

    if not old_string:
        original = ""
        existed = os.path.isfile(full_path)
        if existed:
            try:
                with open(full_path, "r", errors="replace") as f:
                    original = f.read()
            except OSError as e:
                return _error("invalid_input", str(e))
        if (
            cfg.empty_old_string_does_not_override
            and existed
            and original
        ):
            return _error("file_already_exists", ERROR_FILE_ALREADY_EXISTS)
        try:
            os.makedirs(os.path.dirname(full_path) or ".", exist_ok=True)
            with open(full_path, "w", encoding="utf-8") as f:
                f.write(new_string)
        except OSError as e:
            return _error("invalid_input", str(e))
        ext = os.path.splitext(safe_rel)[1]
        diff_html, _diff_text, add_count, del_count = create_diff_html_fn(original, new_string, ext)
        is_new = not existed or not original
        edits = [{
            "old_string": "",
            "old_line": 1,
            "new_string": new_string,
            "new_line": 1,
            "context_before": "",
            "context_after": "",
            "line_prefix": "",
        }]
        return _success_payload(
            safe_rel=safe_rel,
            full_path=full_path,
            diff_html=diff_html,
            add_count=add_count,
            del_count=del_count,
            edits=edits,
            is_new_file=is_new,
            replace_count=1,
        )

    if not os.path.isfile(full_path):
        msg = f"File not found: {safe_rel}"
        msg += suggest_similar_filename(full_path, safe_rel)
        return _error("file_not_found", msg)

    try:
        with open(full_path, "r", errors="replace") as f:
            original = f.read()
    except OSError as e:
        return _error("invalid_input", str(e))

    has_crlf = "\r\n" in original
    match_text = original.replace("\r\n", "\n") if has_crlf else original

    new_content, patch_err, used_normalized = _replace_in_text(
        match_text,
        old_string,
        new_string,
        replace_all=replace_all,
        params=cfg,
        file_was_read_this_turn=file_was_read_this_turn,
    )
    if patch_err:
        return patch_err

    search_string = old_string
    if used_normalized:
        positions = find_normalized_match_positions(match_text, old_string)
    else:
        resolved = _resolve_search_match(match_text, old_string)
        if resolved[0] is not None:
            search_string, positions = resolved
        else:
            search_string = old_string
            positions = []

    new_positions: list[int] = []
    offset = 0
    delta = len(new_string) - len(search_string if not used_normalized else normalize_confusables(search_string))
    for pos in positions:
        new_positions.append(pos + offset)
        offset += delta

    write_text = new_content.replace("\n", "\r\n") if has_crlf else new_content

    try:
        _write_file_with_retry(full_path, write_text)
    except OSError as e:
        return _error("invalid_input", str(e))

    edits = build_edit_details(new_content, search_string, new_string, new_positions)
    ext = os.path.splitext(safe_rel)[1]
    diff_html, _diff_text, add_count, del_count = create_diff_html_fn(original, write_text, ext)
    return _success_payload(
        safe_rel=safe_rel,
        full_path=full_path,
        diff_html=diff_html,
        add_count=add_count,
        del_count=del_count,
        edits=edits,
        is_new_file=False,
        replace_count=len(positions),
        pre_content=original,
        post_content=write_text,
    )

def apply_search_replace_batch(
    full_path: str,
    safe_rel: str,
    patches: list[tuple[str, str, bool]],
    create_diff_html_fn: Callable,
    *,
    params: SearchReplaceParams | None = None,
    file_was_read_this_turn: bool | None = None,
) -> dict:
    cfg = params or SearchReplaceParams()

    path_err = validate_path_components(safe_rel)
    if path_err:
        return _error("filename_too_long", path_err)

    if os.path.isdir(full_path):
        return _error("invalid_input", f"Error: {safe_rel} is a directory, not a file.")

    if not patches:
        return _error("invalid_input", "No edit patches provided.")

    if not os.path.isfile(full_path):
        msg = f"File not found: {safe_rel}"
        msg += suggest_similar_filename(full_path, safe_rel)
        return _error("file_not_found", msg)

    try:
        with open(full_path, "r", errors="replace") as f:
            original = f.read()
    except OSError as e:
        return _error("invalid_input", str(e))

    has_crlf = "\r\n" in original
    match_text = original.replace("\r\n", "\n") if has_crlf else original
    working = match_text
    all_edits: list[dict] = []
    replace_count = 0

    for patch_index, (old_string, new_string, replace_all) in enumerate(patches):
        if not old_string:
            return _error(
                "invalid_input",
                "Batch edit_file does not support empty old_string (new file creation).",
            )
        new_content, patch_err, _used_norm = _replace_in_text(
            working,
            old_string,
            new_string,
            replace_all=replace_all,
            params=cfg,
            file_was_read_this_turn=file_was_read_this_turn,
        )
        if patch_err:
            patch_err = dict(patch_err)
            patch_err["batch_index"] = patch_index
            patch_err["recovery_hint"] = ERROR_BATCH_EDIT_CONFLICT
            return patch_err

        search_string, positions = _resolve_search_match(working, old_string)
        if search_string is None:
            out = _error("no_matches", ERROR_NO_MATCHES_BASE)
            out["batch_index"] = patch_index
            out["recovery_hint"] = ERROR_BATCH_EDIT_CONFLICT
            return out

        new_positions: list[int] = []
        offset = 0
        delta = len(new_string) - len(search_string)
        for pos in positions:
            new_positions.append(pos + offset)
            offset += delta

        all_edits.extend(build_edit_details(new_content, search_string, new_string, new_positions))
        replace_count += len(positions)
        working = new_content

    write_text = working.replace("\n", "\r\n") if has_crlf else working

    try:
        _write_file_with_retry(full_path, write_text)
    except OSError as e:
        return _error("invalid_input", str(e))

    ext = os.path.splitext(safe_rel)[1]
    diff_html, _diff_text, add_count, del_count = create_diff_html_fn(original, write_text, ext)
    return _success_payload(
        safe_rel=safe_rel,
        full_path=full_path,
        diff_html=diff_html,
        add_count=add_count,
        del_count=del_count,
        edits=all_edits,
        is_new_file=False,
        replace_count=replace_count,
        pre_content=original,
        post_content=write_text,
    )

# ============================================================================
