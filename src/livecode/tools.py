"""LiveCode — tools."""
from __future__ import annotations

from livecode._deps import load_prior
load_prior('livecode.tools', globals())

import json
import os
import re
import shlex
import subprocess


def _rel_path_or_empty(project_path: str, path: str) -> str:
    root = os.path.abspath(os.path.expanduser(project_path))
    try:
        return os.path.relpath(path, root).replace("\\", "/")
    except ValueError:
        return ""

def _resolve_flexible_project_path(project_path: str, rel_path: str) -> str | None:
    scoped_path, _ = resolve_safe_path(project_path, rel_path)
    if scoped_path and (os.path.exists(scoped_path) or os.path.isdir(os.path.dirname(scoped_path))):
        return scoped_path

    root = os.path.abspath(os.path.expanduser(project_path))
    parts = [p for p in str(rel_path or "").replace("\\", "/").strip("/").split("/") if p]
    root_name = os.path.basename(root)
    for idx, part in enumerate(parts):
        if part != root_name:
            continue
        candidate_rel = "/".join(parts[idx + 1:])
        candidate, _ = resolve_safe_path(project_path, candidate_rel)
        if candidate and (os.path.exists(candidate) or os.path.isdir(os.path.dirname(candidate))):
            return candidate
    return scoped_path

LIVECODE_COAUTHOR_NAME = "LiveCode"
LIVECODE_COAUTHOR_EMAIL = "livecode@live-code.local"
LIVECODE_COAUTHOR_TRAILER = (
    f"Co-authored-by: {LIVECODE_COAUTHOR_NAME} <{LIVECODE_COAUTHOR_EMAIL}>"
)

def _segment_looks_like_git_commit(segment: str) -> bool:
    low = (segment or "").lower()
    if not re.search(r"\bgit\b", low):
        return False
    if not re.search(r"\bcommit\b", low):
        return False
    if re.search(r"\bcommit-(tree|graph)\b", low):
        return False
    if re.search(r"\bcommit\b[^\n]*--help\b", low):
        return False
    return True

def _inject_livecode_coauthor_into_commit_segment(segment: str) -> str:
    if not _segment_looks_like_git_commit(segment):
        return segment
    if LIVECODE_COAUTHOR_EMAIL.lower() in segment.lower():
        return segment
    if re.search(r"co-authored-by:\s*livecode\b", segment, re.I):
        return segment

    has_message_flag = bool(
        re.search(r"(?:^|[\s])(-m|--message|--file|-F)\b", segment)
        or "<<" in segment
    )
    trailer = LIVECODE_COAUTHOR_TRAILER
    if has_message_flag:
        suffix = f' -m "{trailer}"'
    else:
        suffix = f' --trailer "{trailer}"'
    return segment.rstrip() + suffix

def inject_livecode_commit_coauthor(command: str) -> str:
    cmd = command or ""
    if not re.search(r"\bgit\b", cmd, re.I) or not re.search(r"\bcommit\b", cmd, re.I):
        return cmd

    parts = re.split(r"(&&|\|\||;)", cmd)
    out: list[str] = []
    for part in parts:
        if part in ("&&", "||", ";"):
            out.append(part)
            continue
        out.append(_inject_livecode_coauthor_into_commit_segment(part))
    return "".join(out)

LIVECODE_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "find_symbol",
            "description": "Find symbol definitions by name in the codebase index. Prefer over grep for known identifiers.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Symbol name or substring"},
                    "kind": {"type": "string", "description": "Optional: class, function, async_function"},
                    "max_results": {"type": "integer"},
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "find_references",
            "description": "Find text references to a symbol name across the project.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "max_results": {"type": "integer"},
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_symbols",
            "description": "List indexed symbols in a file or directory prefix.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "File or directory prefix"},
                    "max_results": {"type": "integer"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_memory",
            "description": "Save a durable fact about this project for future sessions (appends to MEMORY.md).",
            "parameters": {
                "type": "object",
                "properties": {
                    "note": {"type": "string", "description": "Fact to remember"},
                },
                "required": ["note"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "memory_search",
            "description": (
                "Search project memory (MEMORY.md + past session logs) via FTS + local embeddings. "
                "Use to recall prior decisions, conventions, and debugging notes."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query"},
                    "max_results": {"type": "integer", "description": "Max hits (default 6)"},
                    "min_score": {"type": "number", "description": "Minimum score (default 0.0)"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "memory_get",
            "description": "Read a memory file by relative path under the project memory store (e.g. MEMORY.md or sessions/...).",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Relative path under memory/"},
                    "from_line": {"type": "integer", "description": "0-based start line"},
                    "lines": {"type": "integer", "description": "Max lines to return"},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "spawn_subagent",
            "description": "Delegate a focused sub-task to a child agent. Returns compact findings only.",
            "parameters": {
                "type": "object",
                "properties": {
                    "goal": {"type": "string", "description": "Focused task for the subagent"},
                    "read_only": {"type": "boolean", "description": "If true, subagent cannot write files"},
                },
                "required": ["goal"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "glob_files",
            "description": (
                "Find files by glob pattern (e.g. '**/*.tsx', 'src/**/*.py'). "
                "Returns paths sorted by modification time. Use for filename-pattern discovery."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "pattern": {"type": "string", "description": "Glob pattern e.g. '**/*.test.py'"},
                    "path": {"type": "string", "description": "Optional subdirectory to search in"},
                    "max_results": {"type": "integer", "description": "Max files (default 100)"},
                },
                "required": ["pattern"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "find_files",
            "description": (
                "Fuzzy search for files by path/name substring using the workspace index. "
                "Use when you know part of a filename but not the exact path."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Substring to match in file path or name"},
                    "ext": {"type": "string", "description": "Optional extension filter e.g. '.ts'"},
                    "path_prefix": {"type": "string", "description": "Optional directory prefix e.g. 'src/'"},
                    "max_results": {"type": "integer", "description": "Max results (default 50)"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "grep_repo",
            "description": "Search project code using regex (ripgrep). Returns matching lines with file paths and line numbers.",
            "parameters": {
                "type": "object",
                "properties": {
                    "pattern": {"type": "string", "description": "Regex pattern to search"},
                    "glob_filter": {"type": "string", "description": "Optional glob e.g. '*.py'"},
                    "directory": {"type": "string", "description": "Optional subdirectory to scope search"},
                    "max_results": {"type": "integer", "description": "Max matches (default 60)"},
                },
                "required": ["pattern"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_repo_file",
            "description": (
                "Read a file from the project. Returns numbered source lines "
                "(format: LINE_NUMBER| content, max 300 lines per call). "
                "The LINE_NUMBER| prefix is not part of the file — do not include it in edit_file old_string."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {"type": "string", "description": "Relative path within project"},
                    "start_line": {"type": "integer"},
                    "end_line": {"type": "integer"},
                },
                "required": ["file_path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_repo_dir",
            "description": "List files and subdirectories in the project.",
            "parameters": {
                "type": "object",
                "properties": {
                    "directory": {"type": "string", "description": "Relative directory path, empty for root"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "git_log",
            "description": (
                "Fast git history lookup. Prefer this over run_command for commit history, "
                "file blame context, or searching commits by message."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Optional path filter (file or directory)"},
                    "grep": {"type": "string", "description": "Optional commit message search (--grep)"},
                    "max_count": {"type": "integer", "description": "Max commits (default 25, max 80)"},
                    "since": {"type": "string", "description": "Optional --since date e.g. '2025-01-01'"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ast_symbols",
            "description": "Extract Python symbols from a .py file.",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {"type": "string", "description": "Relative path to .py file"},
                },
                "required": ["file_path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Create or overwrite a file with full content.",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {"type": "string"},
                    "content": {"type": "string"},
                },
                "required": ["file_path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "edit_file",
            "description": (
                "Replace an exact string in a file. "
                "read_repo_file prefixes each line with \"LINE_NUMBER| \" — that prefix is not part of "
                "the file: match only what comes after the |, with its exact indentation. "
                "Issue at most one edit_file call per file per turn — combine all edits into one "
                "old_string/new_string pair. "
                "old_string must match exactly one place unless replace_all=true "
                "(handy for renaming an identifier or mirrored STG/DWD blocks). "
                "To create a new file, set old_string to an empty string. "
                "new_string must differ from old_string."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {"type": "string"},
                    "old_string": {"type": "string", "description": "Exact text to find"},
                    "new_string": {
                        "type": "string",
                        "description": "Replacement text (must differ from old_string)",
                    },
                    "replace_all": {
                        "type": "boolean",
                        "description": "Replace all occurrences of old_string (default false)",
                    },
                },
                "required": ["file_path", "old_string", "new_string"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_command",
            "description": (
                "Run a shell command in the project directory (tests, builds, git). "
                "Do NOT use for git history — use git_log instead. "
                "Every git commit is automatically tagged with "
                "Co-authored-by: LiveCode <livecode@live-code.local>."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "Shell command to execute"},
                },
                "required": ["command"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "attempt_completion",
            "description": "Signal task completion with a final message for the user. Call as soon as you have enough context.",
            "parameters": {
                "type": "object",
                "properties": {
                    "result": {"type": "string", "description": "Final summary for the user"},
                },
                "required": ["result"],
            },
        },
    },
]

CREATE_PLAN_TOOL = {
    "type": "function",
    "function": {
        "name": "create_plan",
        "description": (
            "Record the implementation plan while plan mode is active. This is the only write "
            "available in plan mode. Call once with the complete plan; pass plan_file to revise "
            "an existing plan after user feedback instead of creating a second one."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "title": {
                    "type": "string",
                    "description": "Short plan title, e.g. 'LiveCode plan mode'",
                },
                "plan": {
                    "type": "string",
                    "description": (
                        "Full plan as markdown with the sections Context, Approach, Changes, "
                        "Verification. Mermaid fenced blocks are supported."
                    ),
                },
                "todos": {
                    "type": "array",
                    "description": "Ordered checklist items rendered as '## Task checklist'",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string"},
                            "content": {"type": "string"},
                        },
                        "required": ["content"],
                    },
                },
                "plan_file": {
                    "type": "string",
                    "description": "Existing plan filename to overwrite (from a prior create_plan)",
                },
            },
            "required": ["title", "plan"],
        },
    },
}

WEB_SEARCH_TOOL = {
    "type": "function",
    "function": {
        "name": "web_search",
            "description": (
                "Search the web — only when the user explicitly asked for internet research "
                "or enabled the Web toggle. Returns snippets and URLs."
            ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query"},
                "allowed_domains": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional list of domains to restrict results",
                },
                "max_results": {"type": "integer", "description": "Max results (default 8)"},
            },
            "required": ["query"],
        },
    },
}

WEB_FETCH_TOOL = {
    "type": "function",
    "function": {
        "name": "web_fetch",
            "description": (
                "Fetch readable text from a public URL. Only when the user provided a link "
                "or explicitly asked for web/internet lookup."
            ),
        "parameters": {
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "HTTPS or HTTP URL to fetch"},
                "max_chars": {"type": "integer", "description": "Max characters to return (default 12000)"},
            },
            "required": ["url"],
        },
    },
}

STRUCTURED_OUTPUT_TOOL = "structured_output"
STRUCTURED_OUTPUT_MAX_RETRIES = 3
STRUCTURED_OUTPUT_SCHEMA: dict = {
    "type": "object",
    "additionalProperties": True,
}

STRUCTURED_OUTPUT_TOOL_DEF = {
    "type": "function",
    "function": {
        "name": STRUCTURED_OUTPUT_TOOL,
        "description": (
            "Return final JSON API response example(s) after reading source. "
            "Call exactly once at the end with response payload(s) derived from code."
        ),
        "parameters": STRUCTURED_OUTPUT_SCHEMA,
    },
}

def get_structured_output_tool() -> dict:
    return dict(STRUCTURED_OUTPUT_TOOL_DEF)

def validate_structured_output(data: dict) -> tuple[bool, str]:
    if not isinstance(data, dict):
        return False, "structured_output payload must be a JSON object"
    try:
        from jsonschema import ValidationError, validate

        validate(instance=data, schema=STRUCTURED_OUTPUT_SCHEMA)
        return True, ""
    except ValidationError as exc:
        return False, str(exc.message)
    except Exception as exc:
        return False, str(exc)

def format_structured_output_answer(data: dict) -> str:
    text = json.dumps(data, indent=2, default=str)
    return f"```json\n{text}\n```"

def get_livecode_tools(
    *,
    enable_mcp: bool = False,
    enable_web: bool = False,
    include_structured_output: bool = False,
) -> list[dict]:
    tools = list(LIVECODE_TOOLS)
    if include_structured_output:
        tools.append(get_structured_output_tool())
    if enable_web:
        tools.append(WEB_SEARCH_TOOL)
        tools.append(WEB_FETCH_TOOL)
    return tools

READ_ONLY_TOOL_NAMES = frozenset({
    "grep_repo",
    "read_repo_file",
    "list_repo_dir",
    "find_symbol",
    "find_references",
    "list_symbols",
    "glob_files",
    "find_files",
    "web_search",
    "web_fetch",
    "git_log",
    "ast_symbols",
    "memory_search",
    "memory_get",
})

LIVECODE_MODES = ("agent", "plan", "ask")

MUTATING_TOOL_NAMES = frozenset({"write_file", "edit_file", "run_command"})

PLAN_MODE_REJECTION = (
    "Plan mode is active, so `{tool}` is unavailable. The only write allowed is the "
    "`create_plan` tool. Keep exploring with the read-only tools and record the "
    "approach with create_plan."
)

ASK_MODE_REJECTION = (
    "Ask mode is active, so `{tool}` is unavailable — this is a read-only conversation. "
    "Answer from the code you can read, and tell the user to switch the composer to "
    "Agent mode if they want the change applied."
)

def normalize_mode(mode: str | None) -> str:
    candidate = (mode or "").strip().lower()
    return candidate if candidate in LIVECODE_MODES else "agent"

def mode_rejection_message(mode: str, tool_name: str) -> str:
    if normalize_mode(mode) == "plan":
        return PLAN_MODE_REJECTION.format(tool=tool_name)
    return ASK_MODE_REJECTION.format(tool=tool_name)

def filter_tools_for_mode(tools: list[dict], mode: str | None) -> list[dict]:
    normalized = normalize_mode(mode)
    if normalized == "agent":
        return list(tools)
    allowed = READ_ONLY_TOOL_NAMES | {"attempt_completion", STRUCTURED_OUTPUT_TOOL}
    filtered = [
        tool for tool in tools
        if (tool.get("function") or {}).get("name") in allowed
    ]
    if normalized == "plan":
        filtered.append(dict(CREATE_PLAN_TOOL))
    return filtered

def _sanitize_shell_command(cmd: str) -> str:
    cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", (cmd or "").strip())
    debris_markers = ('"}', '", "', "', ", " # ")
    for marker in debris_markers:
        idx = cleaned.find(marker)
        if idx > 0:
            cleaned = cleaned[:idx].strip()
    return cleaned.strip()

def try_extract_concatenated_json_objects(raw: str) -> list[dict] | None:
    trimmed = (raw or "").strip()
    if not trimmed.startswith("{"):
        return None
    try:
        loaded = json.loads(trimmed)
        if isinstance(loaded, dict):
            return None
    except json.JSONDecodeError:
        pass
    decoder = json.JSONDecoder()
    objects: list[dict] = []
    idx = 0
    length = len(trimmed)
    while idx < length:
        while idx < length and trimmed[idx].isspace():
            idx += 1
        if idx >= length:
            break
        try:
            value, end = decoder.raw_decode(trimmed, idx)
        except json.JSONDecodeError:
            break
        if isinstance(value, dict):
            objects.append(value)
        else:
            break
        idx = end
    return objects if len(objects) >= 2 else None

def parse_livecode_tool_arguments(tool_name: str, raw: str) -> tuple[dict, str | None]:
    normalized = (raw or "").strip() or "{}"
    if not normalized:
        parsed: dict = {}
    else:
        try:
            loaded = json.loads(normalized)
        except json.JSONDecodeError:
            recovered = try_extract_concatenated_json_objects(normalized)
            if recovered:
                loaded = recovered[0]
            elif tool_name == "run_command":
                return {}, 'Invalid tool arguments — provide only {"command": "..."}'
            else:
                return {}, None
        if not isinstance(loaded, dict):
            return {}, "Tool arguments must be a JSON object"
        parsed = loaded

    if tool_name != "run_command":
        return parsed, None

    cmd = parsed.get("command")
    if not cmd or not str(cmd).strip():
        if parsed:
            return {}, 'Invalid tool arguments — run_command requires {"command": "..."}'
        return {}, "Empty command"
    return {"command": _sanitize_shell_command(str(cmd))}, None

TOOL_RESULT_MAX_CHARS = 16_000

def _subprocess_env() -> dict[str, str]:
    env = os.environ.copy()
    env.setdefault("GIT_PAGER", "cat")
    env.setdefault("PAGER", "cat")
    env.setdefault("NONINTERACTIVE", "1")
    env.setdefault("GIT_TERMINAL_PROMPT", "0")
    return env

def compact_tool_result_for_llm(tool_name: str, result: dict) -> dict:
    if not isinstance(result, dict):
        return {"summary": str(result)[:500]}
    if result.get("error"):
        out = dict(result)
        if (
            tool_name in ("write_file", "edit_file")
            and out.get("error_kind") == "invalid_input"
            and "missing required argument: file_path" in str(out.get("error") or "").lower()
        ):
            out["recovery_hint"] = (
                "Retry the tool call with a relative file_path. If you do not know the path, "
                "use find_files, glob_files, or grep_repo first; do not repeat write_file/edit_file without file_path."
            )
        return out

    out = dict(result)
    if tool_name == "grep_repo":
        matches = out.get("matches") or []
        if len(matches) > 30:
            out["matches"] = matches[:30]
            out["truncated"] = True
            out["match_count"] = len(matches)
    elif tool_name == "read_repo_file":
        content = out.get("content") or ""
        if len(content) > TOOL_RESULT_MAX_CHARS:
            out["content"] = content[:TOOL_RESULT_MAX_CHARS] + "\n... [truncated]"
            out["truncated"] = True
    elif tool_name == "run_command":
        output = out.get("output") or ""
        if len(output) > TOOL_RESULT_MAX_CHARS:
            out["output"] = output[:TOOL_RESULT_MAX_CHARS] + "\n... [truncated]"
            out["truncated"] = True
    elif tool_name == "git_log":
        commits = out.get("commits") or []
        if len(commits) > 40:
            out["commits"] = commits[:40]
            out["truncated"] = True
    elif tool_name in ("find_symbol", "find_references", "list_symbols"):
        for key in ("symbols", "references", "matches"):
            items = out.get(key) or []
            if len(items) > 40:
                out[key] = items[:40]
                out["truncated"] = True
    elif tool_name in ("glob_files", "find_files"):
        files = out.get("files") or []
        if len(files) > 50:
            out["files"] = files[:50]
            out["truncated"] = True
    elif tool_name == "web_search":
        results = out.get("results") or []
        if len(results) > 8:
            out["results"] = results[:8]
            out["truncated"] = True
    elif tool_name == "web_fetch":
        content = out.get("content") or ""
        if len(content) > TOOL_RESULT_MAX_CHARS:
            out["content"] = content[:TOOL_RESULT_MAX_CHARS] + "\n... [truncated]"
            out["truncated"] = True
    return out

def _livecode_write_file(project_path: str, file_path: str, content: str, create_diff_html_fn) -> dict:
    if not str(file_path or "").strip():
        return {"error": "Missing required argument: file_path", "error_kind": "invalid_input"}
    full, err = resolve_safe_path(project_path, file_path)
    if full is None:
        return {"error": err, "error_kind": "invalid_input"}
    safe_rel = os.path.relpath(full, os.path.abspath(os.path.expanduser(project_path))).replace("\\", "/")
    path_err = validate_path_components(safe_rel)
    if path_err:
        return {"error": path_err, "error_kind": "filename_too_long"}
    blocked = path_blocked_for_edit(project_path, safe_rel)
    if blocked:
        return {"error": blocked, "error_kind": "invalid_input"}
    original = ""
    if os.path.isfile(full):
        try:
            with open(full, "r", errors="replace") as f:
                original = f.read()
        except OSError as e:
            return {"error": str(e), "error_kind": "invalid_input"}
    if original == content:
        return {
            "success": True,
            "file_path": safe_rel,
            "action": "write_file",
            "diff_html": "",
            "additions": 0,
            "deletions": 0,
            "absolute_path": full,
            "no_changes": True,
            "edits": [],
        }
    os.makedirs(os.path.dirname(full) or ".", exist_ok=True)
    try:
        _write_file_with_retry(full, content)
    except OSError as e:
        return {"error": str(e), "error_kind": "invalid_input"}
    ext = os.path.splitext(safe_rel)[1]
    diff_html, _diff_text, add_count, del_count = create_diff_html_fn(original, content, ext)
    return {
        "success": True,
        "file_path": safe_rel,
        "action": "write_file",
        "diff_html": diff_html,
        "additions": add_count,
        "deletions": del_count,
        "absolute_path": full,
        "pre_content": original,
        "post_content": content,
        "edits": [],
        "is_new_file": not bool(original),
    }

def _livecode_edit_file(
    project_path: str,
    file_path: str,
    old_string: str,
    new_string: str,
    create_diff_html_fn,
    *,
    replace_all: bool = False,
    params: SearchReplaceParams | None = None,
    file_was_read_this_turn: bool | None = None,
) -> dict:
    if not str(file_path or "").strip():
        return {"error": "Missing required argument: file_path", "error_kind": "invalid_input"}
    full, err = resolve_safe_path(project_path, file_path)
    if full is None:
        return {"error": err, "error_kind": "invalid_input"}
    safe_rel = os.path.relpath(full, os.path.abspath(os.path.expanduser(project_path))).replace("\\", "/")
    blocked = path_blocked_for_edit(project_path, safe_rel)
    if blocked:
        return {"error": blocked, "error_kind": "invalid_input"}
    return apply_search_replace(
        full,
        safe_rel,
        old_string,
        new_string,
        create_diff_html_fn,
        replace_all=replace_all,
        params=params or SearchReplaceParams(),
        file_was_read_this_turn=file_was_read_this_turn,
    )

def _livecode_git_log(
    project_path: str,
    path: str | None = None,
    grep: str | None = None,
    max_count: int = 25,
    since: str | None = None,
) -> dict:
    root = os.path.abspath(os.path.expanduser(project_path))
    if not os.path.isdir(root):
        return {"error": "Invalid project path"}
    git_dir = os.path.join(root, ".git")
    if not os.path.isdir(git_dir):
        return {"error": "Not a git repository"}

    cap = min(max(int(max_count or 25), 1), 80)
    cmd = [
        "git", "--no-pager", "log",
        f"-n{cap}",
        "--date=short",
        "--pretty=format:%h %ad %an %s",
    ]
    if since:
        cmd.append(f"--since={since}")
    if grep:
        cmd.append(f"--grep={grep}")
        cmd.append("-i")

    path_args: list[str] = []
    if path:
        full, err = resolve_safe_path(project_path, path)
        if full is None:
            return {"error": err}
        safe_rel = os.path.relpath(full, root).replace("\\", "/")
        path_args = ["--", safe_rel]

    try:
        result = subprocess.run(
            cmd + path_args,
            cwd=root,
            capture_output=True,
            text=True,
            timeout=30,
            env=_subprocess_env(),
        )
    except subprocess.TimeoutExpired:
        return {"error": "git log timed out (>30s). Narrow with path or grep."}
    except OSError as e:
        return {"error": str(e)}

    lines = [ln for ln in (result.stdout or "").splitlines() if ln.strip()]
    commits = []
    for line in lines:
        m = re.match(r"^(\S+)\s+(\S+)\s+(.+?)\s+(.+)$", line)
        if m:
            commits.append({
                "hash": m.group(1),
                "date": m.group(2),
                "author": m.group(3),
                "subject": m.group(4),
            })
        else:
            commits.append({"raw": line})

    return {
        "success": True,
        "commit_count": len(commits),
        "commits": commits,
        "stderr": (result.stderr or "")[:500] if result.returncode != 0 and not commits else "",
    }

def _emit_command_stream(
    socketio,
    session_id: str | None,
    payload: dict,
    socket_id: str | None = None,
) -> None:
    if not socketio:
        return
    enriched = {**payload, "source": "livecode"}
    if session_id:
        enriched["session_id"] = session_id
    try:
        room = (socket_id or "").strip() or None
        if room:
            socketio.emit("agent_command_stream", enriched, room=room)
        else:
            socketio.emit("agent_command_stream", enriched)
    except Exception:
        pass

def _tokenize_shell_segment(segment: str) -> list[str]:
    text = (segment or "").strip()
    if not text:
        return []
    try:
        return shlex.split(text, posix=True)
    except ValueError:
        return text.split()

def _segment_is_git_log(segment: str) -> bool:
    tokens = _tokenize_shell_segment(segment)
    if not tokens:
        return False
    i = 0
    while i < len(tokens):
        if tokens[i].lower() != "git":
            i += 1
            continue
        j = i + 1
        while j < len(tokens):
            tok = tokens[j]
            low = tok.lower()
            if tok in ("-C", "-c") or low in ("--git-dir", "--work-tree"):
                j += 2 if j + 1 < len(tokens) else 1
                continue
            if low.startswith("--git-dir=") or low.startswith("--work-tree="):
                j += 1
                continue
            if tok.startswith("-"):
                j += 1
                continue
            return low == "log"
        return False
    return False

def _command_has_git_log(command: str) -> bool:
    if "git_log" in (command or "").lower():
        return False
    for seg in re.split(r"&&|\|\||;", command or ""):
        if _segment_is_git_log(seg):
            return True
    return False

def _livecode_run_command(
    project_path: str,
    command: str,
    execute_command_pty_fn,
    socketio,
    session_id: str | None = None,
    socket_id: str | None = None,
    *,
    use_streaming: bool = True,
) -> dict:
    root = os.path.abspath(os.path.expanduser(project_path))
    if not os.path.isdir(root):
        return {"error": "Invalid project path"}
    cmd = command.strip()
    if not cmd:
        return {"error": "Empty command"}
    cmd = inject_livecode_commit_coauthor(cmd)
    blocked = ["rm -rf /", "mkfs", ":(){ :|:& };:"]
    low = cmd.lower()
    for b in blocked:
        if b in low:
            return {"error": "Command blocked for safety"}

    if _command_has_git_log(cmd):
        segments = re.split(r"(&&|\|\||;)", cmd)
        kept: list[str] = []
        dropped_any = False
        for seg in segments:
            if seg.strip() in ("&&", "||", ";"):
                kept.append(seg)
                continue
            if _segment_is_git_log(seg):
                dropped_any = True
                continue
            kept.append(seg)
        remaining = re.sub(r"^\s*(&&|\|\||;)\s*", "", "".join(kept))
        remaining = re.sub(r"\s*(&&|\|\||;)\s*$", "", remaining)
        remaining = re.sub(r"(&&|\|\||;)\s*(&&|\|\||;)", r"\1", remaining).strip()

        if not dropped_any or not remaining:
            return {
                "error": "Use the git_log tool for commit history instead of run_command git log.",
                "hint": "git_log supports path, grep, max_count, since filters.",
            }
        cmd = remaining
        low = cmd.lower()
        _dropped_git_log_hint = "Dropped a `git log` segment — call the git_log tool separately for commit history."
    else:
        _dropped_git_log_hint = None

    quick_prefixes = ("echo ", "pwd", "which ", "ls ", "cat ", "head ", "tail ", "wc ")
    if not use_streaming or low.startswith(quick_prefixes):
        try:
            result = subprocess.run(
                cmd,
                shell=True,
                cwd=root,
                capture_output=True,
                text=True,
                timeout=90,
                env=_subprocess_env(),
            )
            output = (result.stdout or "") + (result.stderr or "")
            out = {
                "success": result.returncode == 0,
                "command": cmd,
                "exit_code": result.returncode,
                "output": output[:12000],
            }
            if _dropped_git_log_hint:
                out["hint"] = _dropped_git_log_hint
            return out
        except subprocess.TimeoutExpired:
            return {"error": "Command timed out (>90s). Try a narrower command or use git_log for history."}
        except OSError as e:
            return {"error": str(e)}

    _emit_command_stream(socketio, session_id, {
        "status": "start",
        "command": cmd,
        "command_name": cmd.split()[0] if cmd.split() else cmd[:30],
        "command_index": 1,
        "total_commands": 1,
    }, socket_id=socket_id)
    output_chunks: list[str] = []
    exit_code = 0
    try:
        proc = subprocess.Popen(
            cmd,
            shell=True,
            cwd=root,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            env=_subprocess_env(),
        )
        assert proc.stdout is not None
        for line in proc.stdout:
            output_chunks.append(line)
            _emit_command_stream(socketio, session_id, {
                "status": "stream",
                "command": cmd,
                "output": line,
                "command_index": 1,
                "total_commands": 1,
                "was_streaming": True,
            }, socket_id=socket_id)
        proc.wait(timeout=600)
        exit_code = proc.returncode or 0
    except subprocess.TimeoutExpired:
        try:
            proc.kill()
        except Exception:
            pass
        exit_code = 124
        output_chunks.append("\n[Command timed out after 600s]")
    except OSError as e:
        return {"error": str(e)}

    output = "".join(output_chunks)
    _emit_command_stream(socketio, session_id, {
        "status": "output",
        "command": cmd,
        "output": output[-12000:] if len(output) > 12000 else output,
        "exit_code": exit_code,
        "command_index": 1,
        "total_commands": 1,
        "was_streaming": True,
    }, socket_id=socket_id)
    out = {
        "success": exit_code == 0,
        "command": cmd,
        "exit_code": exit_code,
        "output": output[:12000],
    }
    if _dropped_git_log_hint:
        out["hint"] = _dropped_git_log_hint
    return out

def _normalize_grep_scope(project_path: str, args: dict) -> dict:
    out = dict(args or {})
    directory = str(out.get("directory") or "").strip()
    if not directory:
        return out

    scoped_path = _resolve_flexible_project_path(project_path, directory)
    if not scoped_path:
        return out

    basename = os.path.basename(scoped_path.rstrip(os.sep))
    parent = os.path.dirname(scoped_path.rstrip(os.sep))
    looks_like_file = bool(os.path.splitext(basename)[1])
    if os.path.isfile(scoped_path) or (looks_like_file and os.path.isdir(parent)):
        rel_parent = _rel_path_or_empty(project_path, parent)
        out["directory"] = "" if rel_parent in ("", ".") else rel_parent
        if not str(out.get("glob_filter") or "").strip():
            out["glob_filter"] = basename
        out["_normalized_file_scope"] = True
    elif not os.path.isdir(scoped_path):
        parent_rel = _rel_path_or_empty(project_path, parent)
        if looks_like_file and parent_rel:
            out["directory"] = parent_rel
            if not str(out.get("glob_filter") or "").strip():
                out["glob_filter"] = basename
            out["_normalized_file_scope"] = True
    return out

def dispatch_tool(
    project_path: str,
    name: str,
    args: dict,
    *,
    repo_grep_fn,
    repo_read_fn,
    repo_list_fn,
    repo_ast_fn,
    create_diff_html_fn,
    execute_command_pty_fn,
    socketio=None,
    session_id: str | None = None,
    socket_id: str | None = None,
    subagent_runner=None,
    files_read_this_turn: set[str] | None = None,
) -> dict:
    if name == "find_symbol":
        idx = get_codebase_index(project_path)
        symbols = idx.find_symbol(
            args.get("name", ""),
            kind=args.get("kind"),
            limit=min(int(args.get("max_results") or 30), 50),
        )
        return {"success": True, "symbol_count": len(symbols), "symbols": symbols}
    if name == "find_references":
        idx = get_codebase_index(project_path)
        refs = idx.find_references(
            args.get("name", ""),
            limit=min(int(args.get("max_results") or 40), 60),
        )
        return {"success": True, "reference_count": len(refs), "references": refs}
    if name == "list_symbols":
        idx = get_codebase_index(project_path)
        symbols = idx.list_symbols(
            args.get("path", ""),
            limit=min(int(args.get("max_results") or 80), 100),
        )
        return {"success": True, "symbol_count": len(symbols), "symbols": symbols}
    if name == "update_memory":
        note = args.get("note", "")
        memory = append_project_memory(project_path, note)
        return {"success": True, "memory_chars": len(memory)}
    if name == "memory_search":
        query = str(args.get("query") or "")
        max_results = min(int(args.get("max_results") or 6), 20)
        min_score = float(args.get("min_score") if args.get("min_score") is not None else 0.0)
        hits = search_memory(
            project_path,
            query,
            max_results=max_results,
            min_score=min_score,
        )
        return {
            "success": True,
            "result_count": len(hits),
            "results": [
                {
                    "path": h.path,
                    "start_line": h.start_line,
                    "end_line": h.end_line,
                    "score": round(h.score, 4),
                    "source": h.source,
                    "snippet": h.snippet[:500],
                }
                for h in hits
            ],
        }
    if name == "memory_get":
        return read_memory_file(
            project_path,
            str(args.get("path") or ""),
            from_line=int(args.get("from_line") or 0),
            lines=int(args["lines"]) if args.get("lines") is not None else None,
        )
    if name == "spawn_subagent":
        if not subagent_runner:
            return {"error": "Subagent runner not configured"}
        return subagent_runner(project_path, args, session_id)
    if name == "glob_files":
        return glob_files(
            project_path,
            args.get("pattern", ""),
            path=str(args.get("path") or ""),
            max_results=min(int(args.get("max_results") or 100), 100),
        )
    if name == "find_files":
        return search_file_manifest(
            project_path,
            args.get("query", ""),
            ext=str(args.get("ext") or ""),
            path_prefix=str(args.get("path_prefix") or ""),
            max_results=min(int(args.get("max_results") or 50), 100),
        )
    if name == "grep_repo":
        grep_args = _normalize_grep_scope(project_path, args)
        return repo_grep_fn(
            project_path,
            grep_args.get("pattern", ""),
            grep_args.get("glob_filter"),
            min(int(grep_args.get("max_results") or 60), 100),
            directory=str(grep_args.get("directory") or ""),
        )
    if name == "read_repo_file":
        return repo_read_fn(
            project_path,
            args.get("file_path", ""),
            args.get("start_line"),
            args.get("end_line"),
        )
    if name == "list_repo_dir":
        directory = str(args.get("directory") or "").strip()
        if not directory or directory in (".", "/"):
            tree = build_project_layout_tree(project_path)
            return {
                "success": True,
                "directory": "/",
                "mode": "tree",
                "layout_tree": tree,
            }
        return repo_list_fn(project_path, directory)
    if name == "git_log":
        return _livecode_git_log(
            project_path,
            path=args.get("path"),
            grep=args.get("grep"),
            max_count=args.get("max_count", 25),
            since=args.get("since"),
        )
    if name == "ast_symbols":
        return repo_ast_fn(project_path, args.get("file_path", ""))
    if name == "write_file":
        return _livecode_write_file(
            project_path,
            args.get("file_path", ""),
            args.get("content", ""),
            create_diff_html_fn,
        )
    if name == "edit_file":
        fp = str(args.get("file_path") or "")
        was_read = None
        if files_read_this_turn is not None:
            full_resolved, _err = resolve_safe_path(project_path, fp)
            if full_resolved is not None:
                safe = os.path.relpath(
                    full_resolved,
                    os.path.abspath(os.path.expanduser(project_path)),
                ).replace("\\", "/")
            else:
                safe = fp.replace("\\", "/").lstrip("/")
            was_read = safe in files_read_this_turn
        return _livecode_edit_file(
            project_path,
            args.get("file_path", ""),
            args.get("old_string", ""),
            args.get("new_string", ""),
            create_diff_html_fn,
            replace_all=bool(args.get("replace_all")),
            file_was_read_this_turn=was_read,
        )
    if name == "run_command":
        return _livecode_run_command(
            project_path,
            args.get("command", ""),
            execute_command_pty_fn,
            socketio,
            session_id,
            socket_id=socket_id,
        )
    if name == "web_search":

        domains = args.get("allowed_domains")
        if isinstance(domains, str):
            domains = [domains]
        return _web_search(
            args.get("query", ""),
            allowed_domains=domains if isinstance(domains, list) else None,
            max_results=min(int(args.get("max_results") or 8), 12),
        )
    if name == "web_fetch":

        return _web_fetch(
            args.get("url", ""),
            max_chars=min(int(args.get("max_chars") or 12000), 50000),
        )
    if name == "create_plan":
        return _livecode_create_plan(project_path, args, session_id)
    if name == "attempt_completion":
        return {"success": True, "completed": True, "result": args.get("result", "")}
    return {"error": f"Unknown tool: {name}"}

def _render_todo_checklist(todos) -> str:
    if not isinstance(todos, list):
        return ""
    lines = []
    for todo in todos:
        if isinstance(todo, dict):
            content = str(todo.get("content") or "").strip()
        else:
            content = str(todo or "").strip()
        if content:
            lines.append(f"- [ ] {content}")
    if not lines:
        return ""
    return "## Task checklist\n\n" + "\n".join(lines)

def _livecode_create_plan(project_path: str, args: dict, session_id: str | None) -> dict:

    title = str(args.get("title") or "").strip()
    body = str(args.get("plan") or "").strip()
    if not body:
        return {"error": "plan is required — pass the full plan markdown"}
    if "## Task checklist" not in body:
        checklist = _render_todo_checklist(args.get("todos"))
        if checklist:
            body = f"{body}\n\n{checklist}"
    try:
        saved = write_plan(
            body,
            title=title or "Untitled plan",
            project_path=project_path,
            session_id=session_id or "",
            filename=str(args.get("plan_file") or "").strip(),
        )
    except ValueError as exc:
        return {"error": str(exc)}
    except OSError as exc:
        return {"error": f"Could not write plan: {exc}"}
    return {
        "success": True,
        "plan_file": saved["file"],
        "plan_path": saved["path"],
        "title": saved["title"],
        "plan_chars": len(saved["body"]),
    }

def human_tool_label(name: str, args: dict) -> str:
    if name == "grep_repo":
        pat = str(args.get("pattern", ""))[:80]
        gf = str(args.get("glob_filter") or "").strip()
        directory = str(args.get("directory") or "").strip()
        if directory and gf:
            return f"Grepped `{pat}` in {directory} ({gf})"
        if directory:
            return f"Grepped `{pat}` in {directory}"
        if gf:
            return f"Grepped `{pat}` in {gf}"
        return f"Grepped `{pat}`"
    if name == "glob_files":
        pat = str(args.get("pattern", ""))[:60]
        return f"Glob `{pat}`"
    if name == "find_files":
        q = str(args.get("query", ""))[:50]
        return f"Find files `{q}`"
    if name == "web_search":
        return f"Web search `{str(args.get('query', ''))[:60]}`"
    if name == "web_fetch":
        from urllib.parse import urlparse

        host = urlparse(str(args.get("url") or "")).hostname or "url"
        return f"Fetched {host}"
    if name == "read_repo_file":
        fp = os.path.basename(str(args.get("file_path", "")))
        start = args.get("start_line")
        end = args.get("end_line")
        if start and end:
            return f"Read {fp} L{start}-{end}"
        if start:
            return f"Read {fp} L{start}+"
        return f"Read {fp}"
    if name == "list_repo_dir":
        directory = str(args.get("directory") or "").strip()
        label = directory if directory else "project"
        return f"Explored {label}"
    if name == "git_log":
        path = str(args.get("path") or "").strip()
        grep = str(args.get("grep") or "").strip()
        if path and grep:
            return f"Git log `{path}` grep `{grep[:40]}`"
        if path:
            return f"Git log `{path}`"
        if grep:
            return f"Git log grep `{grep[:40]}`"
        return "Git log"
    if name == "ast_symbols":
        return f"Explored {os.path.basename(str(args.get('file_path', '')))}"
    if name == "write_file":
        return f"Editing {os.path.basename(str(args.get('file_path', '')))}"
    if name == "edit_file":
        return f"Editing {os.path.basename(str(args.get('file_path', '')))}"
    if name == "run_command":
        cmd = str(args.get("command", ""))[:72]
        return f"Running `{cmd}`"
    if name == "find_symbol":
        return f"Find symbol `{str(args.get('name', ''))[:40]}`"
    if name == "find_references":
        return f"Find refs `{str(args.get('name', ''))[:40]}`"
    if name == "list_symbols":
        p = str(args.get("path") or "project")
        return f"List symbols in {p[:40]}"
    if name == "update_memory":
        return "Updated memory"
    if name == "memory_search":
        return f"Memory search `{str(args.get('query', ''))[:40]}`"
    if name == "memory_get":
        return f"Read memory `{str(args.get('path', ''))[:40]}`"
    if name == "create_plan":
        title = str(args.get("title") or "").strip()
        return f"Writing plan{': ' + title if title else ''}"
    if name == "spawn_subagent":
        return f"Subagent: {str(args.get('goal', ''))}"
    if name == "attempt_completion":
        return "Thought briefly"
    return name

# ============================================================================
