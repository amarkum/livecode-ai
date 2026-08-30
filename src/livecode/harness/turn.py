"""LiveCode — harness turn loop."""
from __future__ import annotations

from livecode._deps import load_prior
load_prior('livecode.harness.turn', globals())

import json
import os
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Callable, Generator

from livecode.harness.interjection_format import format_interjection, format_interrupt
from livecode.harness.sampler import (
    handle_length_salvage,
    maybe_inject_output_limit_reminder,
    run_with_transient_retry,
)
from livecode.harness.turn_end import (
    collect_todo_gate_input_from_session,
    emit_turn_end_plan_cleanup,
    evaluate_todo_gate,
    todo_gate_active,
)
from livecode.harness.types import (
    LengthSalvageAction,
    LengthSalvageStreak,
    TodoGateConfig,
    TodoGateDecision,
    TransientRetryState,
)


def _log_session_id(session_id: str) -> str:
    sid = str(session_id or "")
    if len(sid) <= 24:
        return sid
    return f"{sid[:12]}…{sid[-8:]}"

def _ide_log(
    logger: Any,
    level: str,
    headline: str,
    *parts: Any,
    sid: str = "",
    exc_info: bool = False,
) -> None:
    if not logger:
        return
    bits = [str(p).strip() for p in parts if p is not None and str(p).strip() != ""]
    msg = f"[LiveCode] {headline}"
    if bits:
        msg += " | " + " | ".join(bits)
    if sid:
        msg += f" | session {sid}"
    log_fn = getattr(logger, level, None)
    if not callable(log_fn):
        return
    if exc_info:
        log_fn(msg, exc_info=True)
    else:
        log_fn(msg)

def _ide_log_plain(
    logger: Any,
    level: str,
    message: str,
    *,
    sid: str = "",
    exc_info: bool = False,
) -> None:
    if not logger or not str(message or "").strip():
        return
    msg = f"[LiveCode] {str(message).strip()}"
    if sid:
        msg += f" | session {sid}"
    log_fn = getattr(logger, level, None)
    if not callable(log_fn):
        return
    if exc_info:
        log_fn(msg, exc_info=True)
    else:
        log_fn(msg)

def _format_token_usage_parts(response: dict | None) -> list[str]:
    if not isinstance(response, dict):
        return []
    parts: list[str] = []
    prompt = response.get("prompt_tokens")
    completion = response.get("completion_tokens")
    total = response.get("total_tokens")
    cached = response.get("cached_tokens")
    if prompt is not None:
        parts.append(f"in={prompt}")
    if completion is not None:
        parts.append(f"out={completion}")
    if total is not None and (prompt is None or completion is None):
        parts.append(f"total={total}")
    if cached is not None:
        parts.append(f"cached={cached}")
    return parts

def _accumulate_token_usage(totals: dict[str, int], response: dict | None) -> None:
    if not isinstance(response, dict):
        return
    for key in ("prompt_tokens", "completion_tokens", "total_tokens", "cached_tokens"):
        val = response.get(key)
        if val is None:
            continue
        try:
            totals[key] = totals.get(key, 0) + int(val)
        except (TypeError, ValueError):
            continue

def _merge_thought_content(response: dict[str, Any]) -> str:
    parts = []
    reasoning = (response.get("reasoning_content") or "").strip()
    content = (response.get("content") or "").strip()
    if reasoning:
        parts.append(reasoning)
    if content:
        parts.append(content)
    return "\n".join(parts)

def _describe_upcoming_tool_calls(tool_calls: list[dict] | None) -> str:
    if not tool_calls:
        return ""
    first_fn = (tool_calls[0] or {}).get("function") or {}
    name = first_fn.get("name") or ""
    if not name:
        return ""
    try:
        args = json.loads(first_fn.get("arguments") or "{}")
    except (TypeError, ValueError):
        args = {}
    preview = describe_tool_start(name, args)
    extra = len(tool_calls) - 1
    if extra > 0:
        preview += f" (+{extra} more)"
    return preview

def _brief_thought_line(text: str, max_len: int = 160) -> str:
    raw = (text or "").strip()
    if not raw:
        return ""
    line = ""
    for part in raw.splitlines():
        collapsed = " ".join(part.split())
        if collapsed:
            line = collapsed
            break
    if not line:
        return ""
    if len(line) > max_len:
        return line[: max_len - 1].rstrip() + "…"
    return line

def _is_auto_model(user_model: str) -> bool:
    return (user_model or "").strip().lower() in ("", "auto")

def _pick_iteration_model(
    user_model: str,
    classification: dict[str, Any],
    *,
    tool_loop: bool,
    escalate: bool,
    content_chars: int = 0,
    edit_pending: bool = False,
    edit_completed: bool = False,
    needs_flagship: bool = False,
) -> str:
    from livecode.runtime import pick_livecode_auto_model, resolve_agent_model

    if not _is_auto_model(user_model):
        return resolve_agent_model(user_model)
    return pick_livecode_auto_model(
        classification,
        tool_loop=tool_loop,
        escalate=escalate,
        content_chars=content_chars,
        edit_pending=edit_pending,
        edit_completed=edit_completed,
        needs_flagship=needs_flagship,
        needs_flagship_edit=needs_flagship,
    )

def _auto_route_reason(
    classification: dict[str, Any],
    *,
    tool_loop: bool,
    escalate: bool,
    content_chars: int,
    edit_pending: bool,
    edit_completed: bool,
    needs_flagship: bool,
    model: str,
) -> str:
    from livecode.runtime import livecode_auto_model_route_reason

    return livecode_auto_model_route_reason(
        classification,
        tool_loop=tool_loop,
        escalate=escalate,
        content_chars=content_chars,
        edit_pending=edit_pending,
        edit_completed=edit_completed,
        needs_flagship=needs_flagship,
        needs_flagship_edit=needs_flagship,
        model=model,
    )

def _classify_turn(
    user_model: str,
    question: str,
    call_with_tools: Callable,
    call_summarize: Callable[[str, list[dict[str, str]]], str] | None,
    *,
    project_path: str = "",
    session_id: str = "",
    logger: Any = None,
) -> tuple[dict[str, Any], bool]:
    from livecode.runtime import pick_fast_model

    chat_history = []
    if project_path and session_id:
        chat_history = get_session_chat_history_for_classify(project_path, session_id, question)
    has_prior_turns = len(chat_history) > 0

    route_model = pick_fast_model(task="fast")

    def _call_non_streaming(model_: str, messages_: list, *, prompt_cache_key: str | None = None) -> str:
        if call_summarize:
            try:
                return call_summarize(model_, messages_) or ""
            except TypeError:
                return call_summarize(model_, messages_) or ""
        try:
            resp = call_with_tools(model_, messages_, [], prompt_cache_key=prompt_cache_key)
        except TypeError:
            resp = call_with_tools(model_, messages_, [])
        return resp.get("content") or ""

    classification = intelligent_classify_turn(
        model=route_model,
        call_non_streaming=_call_non_streaming,
        user_message=question,
        chat_history=chat_history or None,
        has_prior_turns=has_prior_turns,
        logger=logger,
    )
    return classification, has_prior_turns

class _StreakTracker:

    def __init__(self) -> None:
        self.run_len = 0
        self.nudged = False

    def _bump(self) -> int:
        self.run_len += 1
        return self.run_len

    def _reset(self, reset_to: int = 0) -> int:
        self.run_len = reset_to
        self.nudged = False
        return self.run_len

    def _take_nudge(self, nudge_after: int) -> bool:
        fire = self.run_len >= nudge_after and not self.nudged
        self.nudged |= fire
        return fire

class _IdenticalToolCallRun(_StreakTracker):
    def __init__(self) -> None:
        super().__init__()
        self.last_signature: str | None = None
        self.tool_name = ""

    def observe(self, signature: str, tool_name: str) -> int:
        if self.last_signature == signature:
            self._bump()
        else:
            self._reset(reset_to=1)
            self.last_signature = signature
        self.tool_name = tool_name
        return self.run_len

    def take_nudge(self) -> bool:
        return self._take_nudge(STATIONARITY_NUDGE_AFTER)

    def should_hard_stop(self) -> bool:
        return self.run_len >= STATIONARITY_HARD_STOP

_SEARCH_SCATTER_TOOLS = frozenset({"grep_repo", "glob_files", "find_files"})

_READ_ONLY_TOOLS = READ_ONLY_TOOL_NAMES

class _SearchScatterRun(_StreakTracker):

    def observe(self, tool_name: str) -> int:
        if tool_name in _SEARCH_SCATTER_TOOLS:
            self._bump()
        else:
            self._reset()
        return self.run_len

    def take_nudge(self) -> bool:
        return self._take_nudge(SEARCH_SCATTER_NUDGE_AFTER)

class _ExplorationStreakRun(_StreakTracker):

    def observe_iteration(self, tool_names: list[str]) -> int:
        if tool_names and all(name in _READ_ONLY_TOOLS for name in tool_names):
            self._bump()
        else:
            self._reset()
        return self.run_len

    def take_nudge(self) -> bool:
        return self._take_nudge(EXPLORATION_STREAK_NUDGE_AFTER)

class _EditNoMatchRun(_StreakTracker):

    def observe(self, tool_name: str, result: dict) -> int:
        if tool_name == "edit_file" and result.get("error_kind") == "no_matches":
            self._bump()
        else:
            self._reset()
        return self.run_len

    def take_nudge(self) -> bool:
        return self._take_nudge(EDIT_NO_MATCH_NUDGE_AFTER)

def _is_child_directory(parent: str, child: str) -> bool:
    parent_norm = (parent or "").strip().strip("/")
    child_norm = (child or "").strip().strip("/")
    if not child_norm:
        return False
    if not parent_norm:
        return True
    return child_norm.startswith(parent_norm + "/")

class _DirectoryDrillRun(_StreakTracker):

    def __init__(self) -> None:
        super().__init__()
        self.last_dir = ""

    def observe(self, tool_name: str, tool_args: dict) -> int:
        if tool_name != "list_repo_dir":
            self.last_dir = ""
            self._reset()
            return 0
        directory = str(tool_args.get("directory") or "").strip().strip("/")
        if self.last_dir and _is_child_directory(self.last_dir, directory):
            self._bump()
        else:
            self._reset(reset_to=1)
        self.last_dir = directory
        return self.run_len

    def take_nudge(self) -> bool:
        return self._take_nudge(DIRECTORY_DRILL_NUDGE_AFTER)

def _is_test_command(command: str) -> bool:
    low = (command or "").lower()
    return "pytest" in low or "run_tests" in low

def _attempt_completion_only_tools(tools: list[dict]) -> list[dict]:
    return [
        t for t in tools
        if (t.get("function") or {}).get("name") == "attempt_completion"
    ]

def _build_exhaustion_partial_summary(tool_events: list[dict[str, Any]]) -> str:
    activity = build_turn_activity_summary(tool_events)
    lines = [
        "Reached the maximum analysis steps for this turn. Partial progress:",
    ]
    if activity:
        lines.append(activity)
    lines.append("Try a more focused follow-up or continue in a new turn.")
    return "\n".join(lines)

def _complete_text_non_streaming(
    model: str,
    messages: list[dict[str, Any]],
    *,
    call_summarize: Callable[[str, list[dict[str, str]]], str] | None = None,
    call_with_tools: Callable | None = None,
    logger: Any = None,
    session_id: str = "",
    log_label: str = "complete text",
) -> str:
    if call_summarize:
        try:
            text = (call_summarize(model, messages) or "").strip()
            if text:
                return text
        except Exception:
            if logger:
                _ide_log(
                    logger,
                    "exception",
                    f"Failed {log_label} via summarize",
                    sid=_log_session_id(session_id),
                    exc_info=True,
                )
    if call_with_tools:
        try:
            try:
                resp = call_with_tools(model, messages, [])
            except TypeError:
                resp = call_with_tools(model, messages, [])
            return ((resp or {}).get("content") or "").strip()
        except Exception:
            if logger:
                _ide_log(
                    logger,
                    "exception",
                    f"Failed {log_label} via tools call",
                    sid=_log_session_id(session_id),
                    exc_info=True,
                )
    return ""

def _run_exhaustion_summarize(
    *,
    summarize_model: str,
    messages: list[dict[str, Any]],
    call_summarize: Callable[[str, list[dict[str, str]]], str] | None,
    call_with_tools: Callable | None,
    tool_events: list[dict[str, Any]],
    logger: Any,
    session_id: str,
) -> str:
    summarize_prompt = (
        "Summarize your findings and answer the original question. Do not call more tools."
    )
    base_msgs = list(messages)
    base_msgs.append({"role": "user", "content": summarize_prompt})
    fitted = fit_messages_for_summarizer(base_msgs)

    if call_summarize:
        try:
            text = (call_summarize(summarize_model, fitted) or "").strip()
            if text:
                return text
        except Exception:
            if logger:
                _ide_log(logger, "exception", "Failed to summarize after max iterations", sid=_log_session_id(session_id), exc_info=True)
        try:
            fitted_short = fit_messages_for_summarizer(base_msgs, max_chars=60_000)
            text = (call_summarize(summarize_model, fitted_short) or "").strip()
            if text:
                return text
        except Exception:
            if logger:
                _ide_log(logger, "exception", "Failed to summarize after max iterations retry", sid=_log_session_id(session_id), exc_info=True)

    text = _complete_text_non_streaming(
        summarize_model,
        fitted,
        call_summarize=None,
        call_with_tools=call_with_tools,
        logger=logger,
        session_id=session_id,
        log_label="exhaustion summary",
    )
    if text:
        return text

    return _build_exhaustion_partial_summary(tool_events)

def _tool_call_signature(tool_name: str, tool_args: dict) -> str:
    try:
        return f"{tool_name}:{json.dumps(tool_args, sort_keys=True, default=str)}"
    except TypeError:
        return f"{tool_name}:{tool_args}"

def _tool_summary(tool_name: str, result: dict) -> tuple[str, bool]:
    if not isinstance(result, dict):
        return "", False
    if result.get("error"):
        err = str(result["error"])
        if tool_name in ("edit_file", "write_file"):
            return err, True
        return err[:200], True
    if tool_name == "grep_repo":
        count = result.get("match_count", 0)
        return f"Found {count} match{'es' if count != 1 else ''}", False
    if tool_name in ("glob_files", "find_files"):
        count = result.get("file_count", result.get("match_count", 0))
        return f"Found {count} file{'s' if count != 1 else ''}", False
    if tool_name == "web_search":
        count = result.get("result_count", 0)
        return f"{count} web result{'s' if count != 1 else ''}", False
    if tool_name == "web_fetch":
        return "Fetched page", False
    if tool_name == "list_repo_dir":
        count = result.get("total")
        if count is None:
            count = len(result.get("dirs", []) or []) + len(result.get("files", []) or [])
        return f"{count} item{'s' if count != 1 else ''}", False
    if tool_name == "read_repo_file":
        showing = result.get("showing") or result.get("total_lines")
        if showing:
            return f"Read lines {showing}", False
        return "Read file", False
    if tool_name == "run_command":
        return f"Exit {result.get('exit_code', '?')}", False
    if tool_name == "git_log":
        count = result.get("commit_count", 0)
        return f"{count} commit{'s' if count != 1 else ''}", False
    return "", False

def _normalize_tool_file_path(file_path: str) -> str:
    return str(file_path or "").replace("\\", "/").lstrip("/")

def _tool_call_edit_args(tc: dict) -> tuple[str, dict, str | None]:
    fn = tc.get("function", {})
    tool_name = fn.get("name", "")
    tool_args, parse_error = parse_livecode_tool_arguments(
        tool_name, fn.get("arguments") or "{}",
    )
    file_path = _normalize_tool_file_path(tool_args.get("file_path", ""))
    return tool_name, tool_args, parse_error if parse_error else None

def _collect_same_file_edit_run(tool_calls: list[dict], start: int) -> list[dict]:
    if start >= len(tool_calls):
        return []
    first = tool_calls[start]
    tool_name, tool_args, parse_error = _tool_call_edit_args(first)
    if tool_name != "edit_file" or parse_error:
        return [first]
    target = _normalize_tool_file_path(tool_args.get("file_path", ""))
    if not target:
        return [first]
    run = [first]
    for tc in tool_calls[start + 1:]:
        next_name, next_args, next_err = _tool_call_edit_args(tc)
        if next_name != "edit_file" or next_err:
            break
        if _normalize_tool_file_path(next_args.get("file_path", "")) != target:
            break
        run.append(tc)
    return run

def _execute_coalesced_edit_file_batch(
    project_path: str,
    tool_calls: list[dict],
    iteration: int,
    *,
    repo_grep_fn,
    repo_read_fn,
    repo_list_fn,
    repo_ast_fn,
    create_diff_html_fn,
    execute_command_pty_fn,
    socketio,
    session_id: str = "",
    socket_id: str = "",
    require_permissions: bool = False,
    emit_progress_fn=None,
    subagent_runner=None,
    mode: str = "agent",
    files_read_this_turn: set[str] | None = None,
) -> list[dict[str, Any]]:
    if not tool_calls:
        return []

    parsed_calls: list[tuple[str, dict, str | None]] = []
    for tc in tool_calls:
        tool_name, tool_args, parse_error = _tool_call_edit_args(tc)
        parsed_calls.append((tool_name, tool_args, parse_error))

    if any(err for (_n, _a, err) in parsed_calls):
        return [{
            "tool_call_id": tc.get("id", ""),
            "tool_name": "edit_file",
            "tool_args": tool_args,
            "result": {"error": err or "Invalid tool arguments"},
            "compacted": {"error": err or "Invalid tool arguments"},
            "iteration": iteration,
        } for tc, (_n, tool_args, err) in zip(tool_calls, parsed_calls)]

    if mode != "agent":
        rejection = mode_rejection_message(mode, "edit_file")
        return [{
            "tool_call_id": tc.get("id", ""),
            "tool_name": "edit_file",
            "tool_args": tool_args,
            "result": {"error": rejection},
            "compacted": {"error": rejection},
            "iteration": iteration,
        } for tc, (_n, tool_args, _e) in zip(tool_calls, parsed_calls)]

    if require_permissions:
        request_id = create_permission_request(session_id, "edit_file", parsed_calls[0][1])
        if emit_progress_fn:
            emit_progress_fn(
                "permission_request",
                "Approve edit_file?",
                request_id=request_id,
                tool="edit_file",
                args=parsed_calls[0][1],
            )
        approved = wait_for_permission(request_id)
        if approved is None:
            err = "Permission request timed out"
            return [{
                "tool_call_id": tc.get("id", ""),
                "tool_name": "edit_file",
                "tool_args": tool_args,
                "result": {"error": err},
                "compacted": {"error": err},
                "iteration": iteration,
            } for tc, (_n, tool_args, _e) in zip(tool_calls, parsed_calls)]
        if not approved:
            err = "User denied permission"
            return [{
                "tool_call_id": tc.get("id", ""),
                "tool_name": "edit_file",
                "tool_args": tool_args,
                "result": {"error": err},
                "compacted": {"error": err},
                "iteration": iteration,
            } for tc, (_n, tool_args, _e) in zip(tool_calls, parsed_calls)]

    file_path = parsed_calls[0][1].get("file_path", "")
    full, err = resolve_safe_path(project_path, file_path)
    if full is None:
        result = {"error": err, "error_kind": "invalid_input"}
        return [{
            "tool_call_id": tc.get("id", ""),
            "tool_name": "edit_file",
            "tool_args": tool_args,
            "result": result,
            "compacted": compact_tool_result_for_llm("edit_file", result),
            "iteration": iteration,
        } for tc, (_n, tool_args, _e) in zip(tool_calls, parsed_calls)]

    safe_rel = os.path.relpath(full, os.path.abspath(os.path.expanduser(project_path))).replace("\\", "/")
    blocked = path_blocked_for_edit(project_path, safe_rel)
    if blocked:
        result = {"error": blocked, "error_kind": "invalid_input"}
        return [{
            "tool_call_id": tc.get("id", ""),
            "tool_name": "edit_file",
            "tool_args": tool_args,
            "result": result,
            "compacted": compact_tool_result_for_llm("edit_file", result),
            "iteration": iteration,
        } for tc, (_n, tool_args, _e) in zip(tool_calls, parsed_calls)]

    read_set = files_read_this_turn or set()
    file_was_read = safe_rel in read_set or f"/{safe_rel}" in read_set

    patches = [
        (
            str(tool_args.get("old_string", "")),
            str(tool_args.get("new_string", "")),
            bool(tool_args.get("replace_all", False)),
        )
        for _n, tool_args, _e in parsed_calls
    ]

    batch_result = apply_search_replace_batch(
        full,
        safe_rel,
        patches,
        create_diff_html_fn,
        file_was_read_this_turn=file_was_read,
    )

    items: list[dict[str, Any]] = []
    if batch_result.get("success"):
        for index, (tc, (_n, tool_args, _e)) in enumerate(zip(tool_calls, parsed_calls)):
            result = dict(batch_result)
            if index < len(tool_calls) - 1:
                result.pop("diff_html", None)
            items.append({
                "tool_call_id": tc.get("id", ""),
                "tool_name": "edit_file",
                "tool_args": tool_args,
                "result": result,
                "compacted": compact_tool_result_for_llm("edit_file", result),
                "iteration": iteration,
            })
        return items

    fail_index = int(batch_result.get("batch_index", 0))
    for index, (tc, (_n, tool_args, _e)) in enumerate(zip(tool_calls, parsed_calls)):
        if index < fail_index:
            result = {
                "error": ERROR_BATCH_EDIT_ABORTED,
                "error_kind": "batch_aborted",
                "recovery_hint": ERROR_BATCH_EDIT_CONFLICT,
            }
        elif index == fail_index:
            result = dict(batch_result)
        else:
            result = {
                "error": ERROR_BATCH_EDIT_SKIPPED,
                "error_kind": "batch_skipped",
                "recovery_hint": ERROR_BATCH_EDIT_CONFLICT,
            }
        items.append({
            "tool_call_id": tc.get("id", ""),
            "tool_name": "edit_file",
            "tool_args": tool_args,
            "result": result,
            "compacted": compact_tool_result_for_llm("edit_file", result),
            "iteration": iteration,
        })
    return items

PLAN_MODE_EDIT_REJECTION = (
    "Plan mode is active — only the approved plan file may be edited. "
    "Cannot modify `{target}`."
)

def _lock_path_for_args(tool_name: str, tool_args: dict) -> str | None:
    if tool_name not in MUTATING_TOOL_NAMES:
        return None
    for key in ("file_path", "path", "target_file"):
        val = tool_args.get(key)
        if val:
            return _normalize_tool_file_path(str(val))
    return None

def plan_mode_edit_gate(
    mode: str,
    tool_name: str,
    tool_args: dict,
    *,
    project_path: str,
    session_id: str,
) -> str | None:
    if normalize_mode(mode) != "plan":
        return None
    if tool_name not in ("edit_file", "write_file", "run_command"):
        return None
    target = _lock_path_for_args(tool_name, tool_args) or ""
    plan_file = get_session_plan_file(project_path, session_id)
    if tool_name == "run_command":
        return mode_rejection_message("plan", tool_name)
    if plan_file and target == plan_file:
        return None
    if target:
        return PLAN_MODE_EDIT_REJECTION.format(target=target)
    return PLAN_MODE_EDIT_REJECTION.format(target=tool_name)

def _group_tool_calls_for_execution(tool_calls: list[dict]) -> list[tuple[str, list[dict]]]:
    groups: list[tuple[str, list[dict]]] = []
    index = 0
    while index < len(tool_calls):
        edit_run = _collect_same_file_edit_run(tool_calls, index)
        if len(edit_run) > 1:
            groups.append(("coalesce", edit_run))
            index += len(edit_run)
        else:
            groups.append(("single", [tool_calls[index]]))
            index += 1
    return groups

def _execute_tool_calls_batch(
    project_path: str,
    tool_calls: list[dict],
    iteration: int,
    *,
    announce_fn,
    **tool_exec_kwargs,
) -> list[dict[str, Any]]:
    if not tool_calls:
        return []
    if len(tool_calls) == 1:
        announce_fn(tool_calls[0])
        return [_execute_one_tool(project_path, tool_calls[0], iteration, **tool_exec_kwargs)]

    groups = _group_tool_calls_for_execution(tool_calls)
    for tc in tool_calls:
        announce_fn(tc)

    write_paths: set[str] = set()
    for kind, calls in groups:
        if kind == "coalesce":
            _, args, _ = _tool_call_edit_args(calls[0])
            fp = _lock_path_for_args("edit_file", args)
            if fp:
                write_paths.add(fp)
        else:
            fn = calls[0].get("function", {})
            name = fn.get("name", "")
            args, _ = parse_livecode_tool_arguments(name, fn.get("arguments") or "{}")
            fp = _lock_path_for_args(name, args)
            if fp:
                write_paths.add(fp)

    file_locks = {fp: threading.Lock() for fp in write_paths if fp}

    def _run_group(group_index: int, kind: str, calls: list[dict]) -> tuple[int, list[dict[str, Any]]]:
        if kind == "coalesce":
            fp = _lock_path_for_args("edit_file", _tool_call_edit_args(calls[0])[1])
            lock = file_locks.get(fp or "")
            if lock:
                with lock:
                    return group_index, _execute_coalesced_edit_file_batch(
                        project_path, calls, iteration, **tool_exec_kwargs,
                    )
            return group_index, _execute_coalesced_edit_file_batch(
                project_path, calls, iteration, **tool_exec_kwargs,
            )
        tc = calls[0]
        fn = tc.get("function", {})
        name = fn.get("name", "")
        args, _ = parse_livecode_tool_arguments(name, fn.get("arguments") or "{}")
        fp = _lock_path_for_args(name, args)
        lock = file_locks.get(fp or "") if fp else None
        if lock:
            with lock:
                return group_index, [_execute_one_tool(project_path, tc, iteration, **tool_exec_kwargs)]
        return group_index, [_execute_one_tool(project_path, tc, iteration, **tool_exec_kwargs)]

    results_by_index: dict[int, list[dict[str, Any]]] = {}
    max_workers = min(len(groups), 8)
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {
            pool.submit(_run_group, idx, kind, calls): idx
            for idx, (kind, calls) in enumerate(groups)
        }
        for future in as_completed(futures):
            try:
                group_index, items = future.result()
                results_by_index[group_index] = items
            except Exception as exc:
                group_index = futures[future]
                tc = groups[group_index][1][0]
                results_by_index[group_index] = [{
                    "tool_call_id": tc.get("id", ""),
                    "tool_name": (tc.get("function") or {}).get("name", "unknown"),
                    "tool_args": {},
                    "result": {"error": str(exc)},
                    "compacted": {"error": str(exc)},
                    "iteration": iteration,
                }]

    executed: list[dict[str, Any]] = []
    for idx in range(len(groups)):
        executed.extend(results_by_index.get(idx, []))
    return executed

def _tail_lines(text: str, window: int = TAIL_REPETITION_WINDOW) -> list[str]:
    lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip()]
    return lines[-window:]

def detect_tail_repetition(text: str, *, threshold: int = TAIL_REPETITION_NUDGE_AFTER) -> bool:
    lines = _tail_lines(text)
    if len(lines) < threshold:
        return False
    tail = lines[-threshold:]
    if len(set(tail)) == 1:
        return True
    if len(lines) >= threshold * 2:
        prev = lines[-threshold * 2:-threshold]
        return prev == tail
    return False

def _verify_goal_completion(
    question: str,
    summary: str,
    edited_files: list[str],
    *,
    call_summarize: Callable | None,
    model: str,
) -> tuple[bool, str]:
    if not call_summarize or not summary.strip():
        return True, ""
    prompt = GOAL_VERIFIER_PROMPT.format(
        question=question[:2000],
        summary=summary[:4000],
        edited_files=", ".join(edited_files) or "(none)",
    )
    try:
        raw = call_summarize(model, [{"role": "user", "content": prompt}])
    except Exception:
        return True, ""
    try:
        data = parse_classifier_json(raw or "")
    except Exception:
        return True, ""
    complete = bool(data.get("complete"))
    reason = str(data.get("reason") or "").strip()
    return complete, reason

def _execute_one_tool(
    project_path: str,
    tc: dict,
    iteration: int,
    *,
    repo_grep_fn,
    repo_read_fn,
    repo_list_fn,
    repo_ast_fn,
    create_diff_html_fn,
    execute_command_pty_fn,
    socketio,
    session_id: str = "",
    socket_id: str = "",
    require_permissions: bool = False,
    emit_progress_fn=None,
    subagent_runner=None,
    mode: str = "agent",
    files_read_this_turn: set[str] | None = None,
) -> dict[str, Any]:
    fn = tc.get("function", {})
    tool_name = fn.get("name", "")
    tool_args, parse_error = parse_livecode_tool_arguments(
        tool_name, fn.get("arguments") or "{}",
    )
    tool_call_id = tc.get("id", "")

    if parse_error:
        return {
            "tool_call_id": tool_call_id,
            "tool_name": tool_name,
            "tool_args": tool_args,
            "result": {"error": parse_error},
            "compacted": {"error": parse_error},
            "iteration": iteration,
        }

    if mode != "agent" and tool_name in MUTATING_TOOL_NAMES:
        rejection = mode_rejection_message(mode, tool_name)
        return {
            "tool_call_id": tool_call_id,
            "tool_name": tool_name,
            "tool_args": tool_args,
            "result": {"error": rejection},
            "compacted": {"error": rejection},
            "iteration": iteration,
        }

    plan_rejection = plan_mode_edit_gate(
        mode,
        tool_name,
        tool_args,
        project_path=project_path,
        session_id=session_id,
    )
    if plan_rejection:
        return {
            "tool_call_id": tool_call_id,
            "tool_name": tool_name,
            "tool_args": tool_args,
            "result": {"error": plan_rejection, "error_kind": "plan_mode"},
            "compacted": {"error": plan_rejection},
            "iteration": iteration,
        }

    needs_permission = require_permissions and tool_name in SENSITIVE_TOOLS
    if tool_name == "run_command" and is_destructive_command(tool_args.get("command", "")):
        needs_permission = True

    if needs_permission:
        request_id = create_permission_request(session_id, tool_name, tool_args)
        if emit_progress_fn:
            emit_progress_fn(
                "permission_request",
                f"Approve {tool_name}?",
                request_id=request_id,
                tool=tool_name,
                args=tool_args,
            )
        approved = wait_for_permission(request_id)
        if approved is None:
            return {
                "tool_call_id": tool_call_id,
                "tool_name": tool_name,
                "tool_args": tool_args,
                "result": {"error": "Permission request timed out"},
                "compacted": {"error": "Permission request timed out"},
                "iteration": iteration,
            }
        if not approved:
            return {
                "tool_call_id": tool_call_id,
                "tool_name": tool_name,
                "tool_args": tool_args,
                "result": {"error": "User denied permission"},
                "compacted": {"error": "User denied permission"},
                "iteration": iteration,
            }

    if tool_name == STRUCTURED_OUTPUT_TOOL:
        valid, err = validate_structured_output(tool_args)
        if valid:
            result = {"valid": True, "data": tool_args}
        else:
            result = {"valid": False, "error": err}
        compacted = compact_tool_result_for_llm(tool_name, result)
        return {
            "tool_call_id": tool_call_id,
            "tool_name": tool_name,
            "tool_args": tool_args,
            "result": result,
            "compacted": compacted,
            "iteration": iteration,
        }

    result = dispatch_tool(
        project_path,
        tool_name,
        tool_args,
        repo_grep_fn=repo_grep_fn,
        repo_read_fn=repo_read_fn,
        repo_list_fn=repo_list_fn,
        repo_ast_fn=repo_ast_fn,
        create_diff_html_fn=create_diff_html_fn,
        execute_command_pty_fn=execute_command_pty_fn,
        socketio=socketio,
        session_id=session_id,
        socket_id=socket_id,
        subagent_runner=subagent_runner,
        files_read_this_turn=files_read_this_turn,
    )
    compacted = compact_tool_result_for_llm(tool_name, result)
    return {
        "tool_call_id": tool_call_id,
        "tool_name": tool_name,
        "tool_args": tool_args,
        "result": result,
        "compacted": compacted,
        "iteration": iteration,
    }

def _approved_plan_block(plan_file: str) -> str:

    try:
        plan = read_plan(plan_file)
    except (FileNotFoundError, ValueError, OSError):
        return ""
    return (
        f"{LIVECODE_PLAN_BUILD_PREFIX}\n\n"
        f'<approved_plan file="{plan["file"]}" title="{plan["title"]}">\n'
        f"{plan['body']}\n"
        "</approved_plan>"
    )

def _prepend_approved_plan(content: str | list, plan_file: str) -> str | list:
    block = _approved_plan_block(plan_file)
    if not block:
        return content
    if isinstance(content, list):
        out: list = []
        merged = False
        for item in content:
            if not merged and isinstance(item, dict) and item.get("type") == "text":
                text = str(item.get("text") or "").strip()
                out.append({
                    "type": "text",
                    "text": f"{block}\n\n{text}" if text else block,
                })
                merged = True
            else:
                out.append(item)
        if not merged:
            out.insert(0, {"type": "text", "text": block})
        return out
    text = str(content or "").strip()
    return f"{block}\n\n{text}" if text else block

def run_livecode_turn(
    project_path: str,
    question: str,
    chat_history: list[dict],
    *,
    user_content: str | list | None = None,
    user_model: str,
    call_with_tools: Callable,
    call_streaming: Callable | None = None,
    call_summarize: Callable[[str, list[dict[str, str]]], str] | None = None,
    is_agent_model: Callable,
    repo_grep_fn: Callable,
    repo_read_fn: Callable,
    repo_list_fn: Callable,
    repo_ast_fn: Callable,
    create_diff_html_fn: Callable,
    execute_command_pty_fn: Callable,
    socketio: Any,
    session_id: str,
    socket_id: str = "",
    logger: Any = None,
    force_reindex: bool = False,
    require_permissions: bool = False,
    enable_mcp_tools: bool = False,
    enable_web_tools: bool | None = None,
    mode: str = "agent",
    plan_file: str | None = None,
    display_payload: dict[str, Any] | None = None,
) -> Generator[str, None, None]:
    del chat_history
    del call_streaming

    if enable_web_tools is None:
        enable_web_tools = False
    if user_requests_web_lookup(question):
        enable_web_tools = True

    mode = normalize_mode(mode)
    effective_user_content: str | list = user_content if user_content is not None else question
    if mode == "agent" and plan_file:
        effective_user_content = _prepend_approved_plan(effective_user_content, plan_file)

    thinking_start: float | None = None
    project_basename = os.path.basename(os.path.abspath(os.path.expanduser(project_path)))
    prompt_cache_key = f"livecode:{session_id[:24]}"
    turn_id = uuid.uuid4().hex
    emit_room = (socket_id or "").strip() or None
    tool_events: list[dict[str, Any]] = []
    progress_seq = 0
    turn_persist: list[dict[str, Any]] = [{"role": "user", "content": effective_user_content}]
    clean_display = _sanitize_display_payload(display_payload)
    if clean_display:
        turn_persist[0]["display"] = clean_display
    context_retried = False
    message_seq_retried = False

    def _persist_msg(msg: dict[str, Any]) -> None:
        turn_persist.append(json.loads(json.dumps(msg, default=str)))

    def _finalize_turn_persist(answer: str) -> list[dict[str, Any]]:
        if answer and answer.strip():
            last = turn_persist[-1] if turn_persist else {}
            if last.get("role") != "assistant" or last.get("content") != answer.strip():
                _persist_msg({"role": "assistant", "content": answer.strip()})
        msgs = list(turn_persist)
        try:
            prior = load_session(project_path, session_id).get("messages") or []
            maybe_autosave_session(project_path, session_id, list(prior) + msgs)
        except Exception:
            if logger:
                _ide_log(logger, "debug", "memory autosave skipped", sid=_log_session_id(session_id), exc_info=True)
        return msgs

    def _thinking_duration_s() -> int:
        nonlocal thinking_start
        if thinking_start is None:
            return 1
        return max(1, round(time.monotonic() - thinking_start))

    def _start_thinking():
        nonlocal thinking_start
        thinking_start = time.monotonic()
        _emit_progress("agent_thinking", "Thinking")

    def _on_thought_delta(text: str) -> None:
        if text:
            _emit_progress("agent_thinking_delta", delta=text)

    def _on_model_retry(attempt: int, max_retries: int, error: BaseException) -> None:
        nonlocal thinking_start
        thinking_start = time.monotonic()
        err_brief = str(error or "").replace("\n", " ")[:120]
        _emit_progress(
            "agent_status",
            "Retrying model connection…",
            attempt=attempt,
            max_retries=max_retries,
            error=err_brief,
        )

    def _emit_progress(progress_type: str, message: str = "", **extra):
        nonlocal progress_seq
        progress_seq += 1
        if logger and progress_type not in {"agent_thinking_delta", "agent_status"}:
            tool_name = extra.get("tool", "") or ""
            short_message = (message or "").replace("\n", " ")[:120]
            if progress_type == "tool_call":
                plain = extra.get("log_message") or describe_tool_start(
                    tool_name, extra.get("args") or {}, short_message
                )
                if plain:
                    _ide_log_plain(logger, "info", plain)
            elif progress_type == "tool_result":
                plain = extra.get("log_message")
                if not plain:
                    plain = describe_tool_result(
                        tool_name,
                        extra.get("args") or {},
                        extra.get("result") if isinstance(extra.get("result"), dict) else None,
                        short_message,
                    )
                level = "warning" if extra.get("error") else "info"
                _ide_log_plain(logger, level, plain)
            elif progress_type == "permission_request":
                _ide_log_plain(logger, "info", f"Waiting for approval: {short_message or tool_name}")
            elif progress_type == "compaction":
                _ide_log_plain(logger, "info", "Compacting conversation history to free context space")
            elif progress_type == "diff_block":
                _ide_log_plain(
                    logger,
                    "info",
                    f"File change ready: {extra.get('file_name') or tool_name}",
                )
            else:
                _ide_log(logger, "debug", progress_type, short_message or None)
        try:
            payload = {
                "session_id": session_id,
                "status": "progress",
                "type": progress_type,
                "message": message,
                "turn_id": turn_id,
                "seq": progress_seq,
                **extra,
            }
            if emit_room:
                socketio.emit("livecode_progress", payload, room=emit_room)
            else:
                socketio.emit("livecode_progress", payload)
        except Exception:
            if logger:
                _ide_log(logger, "debug", "progress emit failed", progress_type, sid=_log_session_id(session_id), exc_info=True)

    def _emit_complete(answer_len: int, turn_summary: str = ""):
        if mode in ("agent", "plan"):
            session_rem = load_session_reminders(project_path, session_id)
            raw_todos = session_rem.get("todos") or []
            todos = [t for t in raw_todos if isinstance(t, dict)]
            cleaned = emit_turn_end_plan_cleanup(todos)
            if cleaned:
                _emit_progress("plan_cleanup", "Turn complete", todos=cleaned)
        if logger:
            _ide_log_plain(
                logger,
                "info",
                describe_turn_complete(
                    answer_len,
                    turn_token_totals,
                    turn_usage_by_model,
                    project_basename,
                ),
            )
        try:
            complete_payload = {
                "session_id": session_id,
                "status": "complete",
                "turn_id": turn_id,
                "seq": progress_seq + 1,
            }
            if emit_room:
                socketio.emit("livecode_progress", complete_payload, room=emit_room)
            else:
                socketio.emit("livecode_progress", complete_payload)
        except Exception:
            if logger:
                _ide_log(logger, "debug", "completion emit failed", sid=_log_session_id(session_id), exc_info=True)

    def _emit_diff(result: dict, tool_call_id: str = ""):
        if not result.get("diff_html"):
            return
        file_name = result.get("file_path", "")
        additions = result.get("additions", 0)
        deletions = result.get("deletions", 0)
        if additions == 0 and deletions == 0:
            return
        absolute_path = result.get("absolute_path", "")
        if logger:
            _ide_log(logger, "info", "diff", file_name, f"+{additions}/-{deletions}")
        try:
            _emit_progress(
                "diff_block",
                result.get("diff_html", ""),
                file_name=file_name,
                additions=additions,
                deletions=deletions,
                absolute_path=absolute_path,
            )
        except Exception:
            if logger:
                _ide_log(logger, "debug", "diff emit failed", file_name, sid=_log_session_id(session_id), exc_info=True)
        try:
            save_diff_record(
                project_path,
                session_id,
                tool_call_id,
                file_name=file_name,
                diff_html=result.get("diff_html", ""),
                additions=additions,
                deletions=deletions,
                absolute_path=absolute_path,
            )
        except Exception:
            if logger:
                _ide_log(logger, "exception", "Failed to persist diff artifact", sid=_log_session_id(session_id), exc_info=True)

    def _estimate_content_chars(messages=None):
        chars = len(question)
        if messages:
            chars = max(chars, estimate_messages_tokens(messages) * 4)
        return chars

    def _maybe_session_compact(*, force: bool = False) -> bool:
        if not call_summarize:
            return False
        compact_model = _pick_iteration_model(
            user_model,
            classification,
            tool_loop=False,
            escalate=False,
            content_chars=_estimate_content_chars(),
        )
        record = maybe_compact_session(
            project_path,
            session_id,
            model=compact_model,
            call_summarize=call_summarize,
            force=force,
        )
        if record:
            record_compaction_ran(project_path, session_id)
            _emit_progress(
                "compaction",
                "Compacted conversation history",
                forced=force,
                boundary_index=record.get("boundary_index"),
                strategy=record.get("strategy", "full_replace"),
            )
            return True
        return False

    def _subagent_runner(proj: str, args: dict, parent_sid: str) -> dict:

        sub_model = _pick_iteration_model(
            user_model,
            classification,
            tool_loop=True,
            escalate=escalate,
            content_chars=_estimate_content_chars(),
        )

        def _mini_turn(project_path: str, question: str, session_id: str, max_iterations: int = 5, **kwargs):
            del kwargs
            child_messages = [
                {
                    "role": "system",
                    "content": (
                        f"{LIVECODE_COMPACT_SYSTEM_PROMPT}\n\n**Project root:** `{project_path}`"
                    ),
                },
                {"role": "user", "content": question},
            ]
            child_tools = get_livecode_tools(
                enable_mcp=enable_mcp_tools,
                enable_web=enable_web_tools,
            )
            answer = ""
            for _ in range(min(max_iterations, 5)):
                child_messages = compact_stale_tool_messages(child_messages)
                try:
                    resp = call_with_tools(sub_model, child_messages, child_tools, prompt_cache_key=prompt_cache_key)
                except TypeError:
                    resp = call_with_tools(sub_model, child_messages, child_tools)
                tcs = resp.get("tool_calls")
                if not tcs:
                    answer = resp.get("content") or answer
                    break
                child_messages.append({
                    "role": "assistant",
                    "content": resp.get("content") or "",
                    "tool_calls": tcs,
                })
                for tc in tcs:
                    item = _execute_one_tool(
                        project_path,
                        tc,
                        1,
                        repo_grep_fn=repo_grep_fn,
                        repo_read_fn=repo_read_fn,
                        repo_list_fn=repo_list_fn,
                        repo_ast_fn=repo_ast_fn,
                        create_diff_html_fn=create_diff_html_fn,
                        execute_command_pty_fn=execute_command_pty_fn,
                        socketio=socketio,
                        session_id=session_id,
                        socket_id=emit_room or "",
                        require_permissions=require_permissions,
                        subagent_runner=None,
                    )
                    child_messages.append({
                        "role": "tool",
                        "tool_call_id": item["tool_call_id"],
                        "content": json.dumps(item["compacted"], default=str),
                    })
                    if item["tool_name"] == "attempt_completion" and item["result"].get("completed"):
                        answer = item["result"].get("result", "")
                        yield f"data: {json.dumps({'answer': answer, 'done': True})}\n\n"
                        return
            yield f"data: {json.dumps({'answer': answer, 'done': True})}\n\n"

        return run_subagent_turn(
            project_path=proj,
            goal=args.get("goal", ""),
            parent_session_id=parent_sid or session_id,
            run_turn_fn=_mini_turn,
            read_only=bool(args.get("read_only", True)),
        )

    def _mode_prompt_block() -> str:
        if mode == "ask":
            return LIVECODE_ASK_MODE_PROMPT
        if mode != "plan":
            return ""
        block = LIVECODE_PLAN_MODE_PROMPT
        if plan_file:

            try:
                existing = read_plan(plan_file)
            except (FileNotFoundError, ValueError, OSError):
                existing = None
            if existing:
                block += "\n\n" + LIVECODE_PLAN_REENTRY_REMINDER_TEMPLATE.format(
                    plan_file=existing["file"],
                    plan_title=existing["title"],
                )
        return block

    def _build_base_messages(brief_summary: str, *, include_layout: bool = True) -> list[dict[str, Any]]:
        rules_reminder = load_rules_reminder(project_path)
        compacted = has_valid_compaction(project_path, session_id)
        reminders = build_reminder_text(project_path, session_id)
        try:
            ensure_index(project_path)
        except Exception:
            if logger:
                _ide_log(logger, "debug", "index refresh failed", sid=_log_session_id(session_id), exc_info=True)
        memory = build_memory_context(project_path, question, min_score=0.0)
        if compacted:
            system_content = (
                f"{LIVECODE_COMPACT_SYSTEM_PROMPT}\n\n**Project root:** `{project_path}`"
            )
            if memory:
                system_content = f"{system_content}\n\n{memory}"
        else:
            system_content = build_system_prompt(
                project_path,
                brief_summary,
                reminders=reminders,
                memory=memory,
                has_project_rules=bool(rules_reminder),
            )
        mode_block = _mode_prompt_block()
        if mode_block:
            system_content = f"{system_content}\n\n{mode_block}"
        projected = get_projected_messages(
            project_path,
            session_id,
            effective_user_content,
            rules_reminder=rules_reminder if compacted else "",
            wrap_query=True,
        )
        clear_compaction_reminder(project_path, session_id)
        messages: list[dict[str, Any]] = [{"role": "system", "content": system_content}]
        if include_layout and not compacted:
            layout = format_project_layout_block(project_path)
            if layout:
                messages.append({"role": "user", "content": layout})
        if rules_reminder and not compacted:
            messages.append({"role": "user", "content": rules_reminder})
        messages.extend(projected)
        return sanitize_messages_for_api(messages)

    if logger:
        _ide_log_plain(
            logger,
            "info",
            describe_turn_start(project_basename, mode, user_model, len(question)),
            sid=_log_session_id(session_id),
        )

    classification, has_prior_turns = _classify_turn(
        user_model,
        question,
        call_with_tools,
        call_summarize,
        project_path=project_path,
        session_id=session_id,
        logger=logger,
    )
    escalate = False
    stationarity = _IdenticalToolCallRun()
    search_scatter = _SearchScatterRun()
    directory_drill = _DirectoryDrillRun()
    exploration_streak = _ExplorationStreakRun()
    edit_no_match = _EditNoMatchRun()
    consecutive_tool_errors = 0
    iteration_budget_nudges_sent: set[int] = set()
    last_edit_iteration: int | None = None
    post_edit_nudged = False
    consecutive_test_failures = 0
    test_failure_nudged = False
    files_read_this_turn: set[str] = set()
    edit_completed_this_turn = False
    edited_files_this_turn: list[str] = []
    run_command_completed_this_turn = False
    turn_token_totals: dict[str, int] = {}
    turn_usage_by_model: dict[str, dict[str, int]] = {}

    if logger:
        _ide_log_plain(
            logger,
            "info",
            f"Intelligent classify: {describe_intelligent_classification(classification)}",
        )
        _ide_log(logger, "debug", "classify detail", classification)

    index = build_workspace_index(project_path, force=force_reindex)
    symbol_mgr = get_codebase_index(project_path)
    symbol_stats = symbol_mgr.stats()
    summary = index_summary_brief(index, symbol_index=symbol_stats)
    file_count = index.get("file_count", 0)
    from_cache = index.get("from_cache", False)
    if logger:
        _ide_log(
            logger,
            "debug" if from_cache else "info",
            "index",
            f"{file_count} files",
            "cache" if from_cache else "built",
        )

    _maybe_session_compact()
    messages = _build_base_messages(summary)
    use_structured_output = wants_structured_json(question)
    tools = filter_tools_for_mode(
        get_livecode_tools(
            enable_mcp=enable_mcp_tools,
            enable_web=enable_web_tools,
            include_structured_output=use_structured_output,
        ),
        mode,
    )
    if use_structured_output and messages:
        messages[0] = {
            "role": "system",
            "content": messages[0].get("content", "") + "\n\n" + LIVECODE_STRUCTURED_OUTPUT_REMINDER,
        }

    full_answer = ""
    completed = False
    codebase_recovery_used = False
    edit_recovery_used = False
    tail_repetition_used = False
    goal_verifier_used = False
    force_tool_choice_required = False
    structured_output_retries = 0
    transient_retry = TransientRetryState(enabled=True)
    length_salvage = LengthSalvageStreak()
    todo_gate_config = TodoGateConfig(
        enabled=os.environ.get("LIVECODE_TODO_GATE", "").strip().lower() in ("1", "true", "yes"),
    )
    todo_gate_fires = 0

    try:
        for iteration in range(1, LIVECODE_MAX_ITERATIONS + 1):
            needs_flagship = needs_flagship_edit(classification)
            edit_pending = (
                needs_code_change(question, classification)
                and bool(files_read_this_turn)
                and not edit_completed_this_turn
            )
            content_chars = _estimate_content_chars(messages)
            iteration_model = _pick_iteration_model(
                user_model,
                classification,
                tool_loop=True,
                escalate=escalate,
                content_chars=content_chars,
                edit_pending=edit_pending,
                edit_completed=edit_completed_this_turn,
                needs_flagship=needs_flagship,
            )
            route_reason = None
            if _is_auto_model(user_model):
                route_reason = _auto_route_reason(
                    classification,
                    tool_loop=True,
                    escalate=escalate,
                    content_chars=content_chars,
                    edit_pending=edit_pending,
                    edit_completed=edit_completed_this_turn,
                    needs_flagship=needs_flagship,
                    model=iteration_model,
                )

            if stationarity.should_hard_stop():
                full_answer = (
                    f"Stopped after {stationarity.run_len} identical calls to "
                    f"`{stationarity.tool_name}` with the same arguments. "
                    "Try a different approach or ask a more specific question."
                )
                if logger:
                    _ide_log(
                        logger,
                        "warning",
                        "nudge stationarity-stop",
                        f"tool={stationarity.tool_name}",
                        f"run={stationarity.run_len}",
                    )
                turn_summary = build_turn_activity_summary(tool_events)
                turn_messages = _finalize_turn_persist(full_answer)
                yield f"data: {json.dumps({'done': True, 'answer': full_answer, 'turn_summary': turn_summary, 'turn_messages': turn_messages})}\n\n"
                _emit_complete(len(full_answer), turn_summary)
                return

            if stationarity.take_nudge():
                nudge_text = STATIONARITY_NUDGE_TEMPLATE.format(
                    tool_name=stationarity.tool_name,
                    run_len=stationarity.run_len,
                )
                nudge = {"role": "user", "content": nudge_text, "internal": True}
                messages.append(nudge)
                _persist_msg(nudge)
                escalate = True
                if logger:
                    _ide_log(
                        logger,
                        "warning",
                        "nudge stationarity",
                        f"tool={stationarity.tool_name}",
                        f"run={stationarity.run_len}",
                    )

            if search_scatter.take_nudge():
                nudge_text = SEARCH_SCATTER_NUDGE_TEMPLATE.format(run_len=search_scatter.run_len)
                nudge = {"role": "user", "content": nudge_text, "internal": True}
                messages.append(nudge)
                _persist_msg(nudge)
                if logger:
                    _ide_log(logger, "warning", "nudge search-scatter", f"run={search_scatter.run_len}")

            if directory_drill.take_nudge():
                nudge_text = DIRECTORY_DRILL_NUDGE_TEMPLATE.format(run_len=directory_drill.run_len)
                nudge = {"role": "user", "content": nudge_text, "internal": True}
                messages.append(nudge)
                _persist_msg(nudge)
                if logger:
                    _ide_log(logger, "warning", "nudge directory-drill", f"run={directory_drill.run_len}")

            if exploration_streak.take_nudge():
                streak_template = (
                    EXPLORATION_STREAK_NUDGE_TEMPLATE if mode == "agent"
                    else EXPLORATION_STREAK_READ_ONLY_NUDGE_TEMPLATE
                )
                nudge_text = streak_template.format(
                    run_len=exploration_streak.run_len,
                )
                nudge = {"role": "user", "content": nudge_text, "internal": True}
                messages.append(nudge)
                _persist_msg(nudge)
                if logger:
                    _ide_log(logger, "warning", "nudge exploration-streak", f"run={exploration_streak.run_len}")

            if edit_no_match.take_nudge():
                nudge_text = EDIT_NO_MATCH_NUDGE_TEMPLATE.format(run_len=edit_no_match.run_len)
                nudge = {"role": "user", "content": nudge_text, "internal": True}
                messages.append(nudge)
                _persist_msg(nudge)
                escalate = True
                if logger:
                    _ide_log(logger, "warning", "nudge edit-no-match", f"run={edit_no_match.run_len}")

            if iteration in ITERATION_BUDGET_NUDGE_AT and iteration not in iteration_budget_nudges_sent:
                remaining = LIVECODE_MAX_ITERATIONS - iteration + 1
                nudge_text = ITERATION_BUDGET_NUDGE_TEMPLATE.format(remaining=remaining)
                nudge = {"role": "user", "content": nudge_text, "internal": True}
                messages.append(nudge)
                _persist_msg(nudge)
                iteration_budget_nudges_sent.add(iteration)
                if logger:
                    _ide_log(
                        logger,
                        "warning",
                        "nudge iteration-budget",
                        f"iter={iteration}",
                        f"remaining={remaining}",
                    )

            if (
                last_edit_iteration is not None
                and not post_edit_nudged
                and iteration - last_edit_iteration >= POST_EDIT_COMPLETION_NUDGE_AFTER
            ):
                nudge = {"role": "user", "content": POST_EDIT_COMPLETION_NUDGE_TEMPLATE, "internal": True}
                messages.append(nudge)
                _persist_msg(nudge)
                post_edit_nudged = True
                if logger:
                    _ide_log(logger, "warning", "nudge post-edit", f"iter={iteration}")

            if consecutive_test_failures >= TEST_FAILURE_NUDGE_AFTER and not test_failure_nudged:
                nudge = {"role": "user", "content": TEST_FAILURE_NUDGE_TEMPLATE, "internal": True}
                messages.append(nudge)
                _persist_msg(nudge)
                test_failure_nudged = True
                if logger:
                    _ide_log(logger, "warning", "nudge test-failure", f"failures={consecutive_test_failures}")

            iteration_tools = tools
            if iteration > LIVECODE_MAX_ITERATIONS - CLOSURE_ITERATIONS:
                iteration_tools = _attempt_completion_only_tools(tools)

            if logger:
                _ide_log_plain(
                    logger,
                    "info",
                    describe_iteration_start(
                        iteration,
                        LIVECODE_MAX_ITERATIONS,
                        iteration_model,
                        user_model if _is_auto_model(user_model) else None,
                        route_reason=route_reason,
                    ),
                )

            _start_thinking()

            if not is_agent_model(iteration_model):
                err = "No LLM provider configured. Open Settings and add an OpenAI or Gemini API key."
                if logger:
                    _ide_log(logger, "warning", "invalid model", iteration_model, sid=_log_session_id(session_id))
                yield f"data: {json.dumps({'error': err})}\n\n"
                return

            messages = compact_stale_tool_messages(
                messages,
                max_input_tokens=int(LIVECODE_CONTEXT_WINDOW * LIVECODE_IN_TURN_COMPACT_RATIO),
            )

            pending = drain_interjections(session_id)
            for interjection, is_interrupt in pending:
                content = format_interrupt(interjection) if is_interrupt else format_interjection(interjection)
                user_msg = {"role": "user", "content": content}
                messages.append(user_msg)
                _persist_msg(user_msg)

            budget = int(LIVECODE_CONTEXT_WINDOW * LIVECODE_IN_TURN_COMPACT_RATIO)
            if estimate_messages_tokens(messages) > budget:
                messages = compact_stale_tool_messages(messages, max_input_tokens=budget)

            messages = sanitize_messages_for_api(messages)

            tool_choice = pick_tool_choice(
                iteration,
                classification,
                question,
                has_prior_turns=has_prior_turns,
                force_required=force_tool_choice_required,
            )
            force_tool_choice_required = False
            if logger and iteration == 1:
                _ide_log(
                    logger,
                    "debug",
                    "tool_choice",
                    tool_choice,
                    "chat_only" if classification.get("chat_only") else None,
                    "needs_evidence" if needs_codebase_evidence(question, has_prior_turns=has_prior_turns) else None,
                )

            def _call_model() -> dict[str, Any]:
                try:
                    return call_with_tools(
                        iteration_model,
                        messages,
                        iteration_tools,
                        tool_choice=tool_choice,
                        prompt_cache_key=prompt_cache_key,
                        on_thought_delta=_on_thought_delta,
                        on_retry=_on_model_retry,
                    )
                except TypeError:
                    try:
                        return call_with_tools(
                            iteration_model,
                            messages,
                            iteration_tools,
                            tool_choice=tool_choice,
                            prompt_cache_key=prompt_cache_key,
                            on_thought_delta=_on_thought_delta,
                        )
                    except TypeError:
                        try:
                            return call_with_tools(
                                iteration_model,
                                messages,
                                iteration_tools,
                                tool_choice=tool_choice,
                                prompt_cache_key=prompt_cache_key,
                            )
                        except TypeError:
                            return call_with_tools(iteration_model, messages, iteration_tools)

            try:
                response = run_with_transient_retry(
                    _call_model,
                    transient_retry,
                    on_retry=_on_model_retry,
                )
            except Exception as api_err:
                err_status = None
                if isinstance(api_err, requests.HTTPError) and api_err.response is not None:
                    err_status = api_err.response.status_code
                err_msg = _format_llm_error_for_user(api_err, provider="gemini", status_code=err_status)
                if logger:
                    _ide_log(
                        logger,
                        "exception",
                        "API error",
                        iteration_model,
                        err_msg[:200],
                        sid=_log_session_id(session_id),
                        exc_info=True,
                    )
                is_tool_seq_err = (
                    "tool_calls" in err_msg.lower()
                    and "role" in err_msg.lower()
                    and "tool" in err_msg.lower()
                )
                if is_tool_seq_err and not message_seq_retried:
                    message_seq_retried = True
                    messages = sanitize_messages_for_api(_build_base_messages(summary))
                    if logger:
                        _ide_log(logger, "warning", "retry tool-message sequencing", sid=_log_session_id(session_id))
                    continue
                if "context_length" in err_msg.lower() and call_summarize and not context_retried:
                    context_retried = True
                    if _maybe_session_compact(force=True):
                        messages = _build_base_messages(summary)
                        continue
                if "context_length" in err_msg.lower():
                    msg = "Query requires too much context. Try a more specific question."
                    yield f"data: {json.dumps({'done': True, 'answer': msg})}\n\n"
                    return
                yield f"data: {json.dumps({'error': err_msg})}\n\n"
                return

            _accumulate_token_usage(turn_token_totals, response)
            accumulate_usage_by_model(turn_usage_by_model, iteration_model, response)
            if logger:
                _ide_log_plain(
                    logger,
                    "info",
                    describe_model_usage(
                        iteration,
                        iteration_model,
                        prompt_tokens=response.get("prompt_tokens"),
                        completion_tokens=response.get("completion_tokens"),
                        cached_tokens=response.get("cached_tokens"),
                    ),
                )

            salvage_action, inject_reminder = handle_length_salvage(length_salvage, response)
            if salvage_action == LengthSalvageAction.EXHAUSTED:
                full_answer = (
                    "Stopped: output exceeded the token limit too many times in a row. "
                    "Try breaking the task into smaller steps."
                )
                turn_summary = build_turn_activity_summary(tool_events)
                turn_messages = _finalize_turn_persist(full_answer)
                yield f"data: {json.dumps({'done': True, 'answer': full_answer, 'turn_summary': turn_summary, 'turn_messages': turn_messages})}\n\n"
                _emit_complete(len(full_answer), turn_summary)
                return
            maybe_inject_output_limit_reminder(messages, inject=inject_reminder)
            if inject_reminder:
                _persist_msg(messages[-1])

            tool_calls = response.get("tool_calls")
            if tool_calls:
                thought_content = _merge_thought_content(response) or _describe_upcoming_tool_calls(tool_calls)
                duration_s = _thinking_duration_s()
                _emit_progress(
                    "agent_thinking_done",
                    f"Thought for {duration_s}s",
                    duration_s=duration_s,
                    thought_content=thought_content,
                )
                brief = _brief_thought_line(thought_content)
                if logger and brief:
                    _ide_log(logger, "info", brief)
                thinking_start = None
                assistant_msg: dict[str, Any] = {
                    "role": "assistant",
                    "content": response.get("content") or "",
                    "tool_calls": tool_calls,
                }
                reasoning = (response.get("reasoning_content") or "").strip()
                if reasoning:
                    assistant_msg["reasoning_content"] = reasoning
                messages.append(assistant_msg)
                _persist_msg(assistant_msg)

                read_only_batch = all(
                    (tc.get("function") or {}).get("name") in _READ_ONLY_TOOLS
                    for tc in tool_calls
                )
                if logger and len(tool_calls) > 1:
                    names = [tc.get("function", {}).get("name") for tc in tool_calls]
                    batch_mode = "parallel" if not read_only_batch else "parallel-read-only"
                    _ide_log(
                        logger,
                        "info",
                        f"tool batch ×{len(tool_calls)} ({batch_mode})",
                        ",".join(str(n) for n in names if n),
                    )

                tool_exec_kwargs = dict(
                    repo_grep_fn=repo_grep_fn,
                    repo_read_fn=repo_read_fn,
                    repo_list_fn=repo_list_fn,
                    repo_ast_fn=repo_ast_fn,
                    create_diff_html_fn=create_diff_html_fn,
                    execute_command_pty_fn=execute_command_pty_fn,
                    socketio=socketio,
                    session_id=session_id,
                    socket_id=emit_room or "",
                    require_permissions=require_permissions,
                    emit_progress_fn=_emit_progress,
                    subagent_runner=_subagent_runner,
                    mode=mode,
                    files_read_this_turn=files_read_this_turn,
                )

                def _announce_tool_call(tc: dict[str, Any]) -> None:
                    fn = tc.get("function", {})
                    tool_name = fn.get("name", "")
                    tool_args, _parse_error = parse_livecode_tool_arguments(
                        tool_name, fn.get("arguments") or "{}",
                    )
                    label = human_tool_label(tool_name, tool_args)
                    detail = ""
                    if tool_name in ("edit_file", "write_file") and tool_args.get("file_path"):
                        detail = str(tool_args.get("file_path"))
                    elif tool_name == "run_command":
                        detail = "exit pending"
                    tool_events.append({"tool": tool_name, "label": label, "detail": detail})
                    if logger:
                        args_preview = json.dumps(tool_args, default=str)[:300]
                        _ide_log(logger, "debug", f"tool args {tool_name}", f"iter={iteration}", args_preview)
                    _emit_progress("tool_call", label, tool=tool_name, args=tool_args)

                def _finish_tool_item(item: dict[str, Any]) -> str:
                    nonlocal last_edit_iteration, full_answer, completed
                    nonlocal structured_output_retries, consecutive_test_failures
                    nonlocal consecutive_tool_errors, escalate, edit_completed_this_turn
                    nonlocal edited_files_this_turn, run_command_completed_this_turn
                    nonlocal goal_verifier_used, edit_recovery_used, force_tool_choice_required

                    tool_name = item["tool_name"]
                    result = item["result"]
                    compacted = item["compacted"]
                    tool_call_id = item["tool_call_id"]
                    tool_args = item.get("tool_args") or {}
                    try:
                        save_tool_artifact(
                            project_path,
                            session_id,
                            tool_call_id,
                            tool_name=tool_name,
                            tool_args=tool_args,
                            result=result,
                            iteration=iteration,
                        )
                    except Exception:
                        if logger:
                            _ide_log(logger, "exception", "Failed to persist tool artifact", sid=_log_session_id(session_id), exc_info=True)

                    stationarity.observe(
                        _tool_call_signature(tool_name, tool_args),
                        tool_name,
                    )
                    search_scatter.observe(tool_name)
                    directory_drill.observe(tool_name, tool_args)
                    edit_no_match.observe(tool_name, result)

                    if tool_name == "read_repo_file" and result.get("success"):
                        read_fp = result.get("file") or tool_args.get("file_path")
                        if read_fp:
                            files_read_this_turn.add(str(read_fp).replace("\\", "/").lstrip("/"))

                    if tool_name in ("write_file", "edit_file") and result.get("success"):
                        last_edit_iteration = iteration
                        edit_completed_this_turn = True
                        fp = result.get("file_path") or tool_args.get("file_path")
                        if fp:
                            fp_str = str(fp).replace("\\", "/").lstrip("/")
                            record_file_edited(project_path, session_id, fp_str)
                            if fp_str not in edited_files_this_turn:
                                edited_files_this_turn.append(fp_str)
                            pre = result.get("pre_content")
                            post = result.get("post_content")
                            if isinstance(pre, str) and isinstance(post, str):
                                record_edit_snapshot(
                                    project_path,
                                    session_id,
                                    fp_str,
                                    pre,
                                    post,
                                    turn_id=session_id,
                                )
                        _emit_diff(result, tool_call_id)

                    if tool_name == "run_command" and not result.get("error"):
                        exit_code = result.get("exit_code")
                        if exit_code in (0, None):
                            run_command_completed_this_turn = True

                    if tool_name == "create_plan" and result.get("success"):
                        plan_fp = result.get("plan_file") or ""
                        if plan_fp:
                            record_session_plan_file(project_path, session_id, str(plan_fp))
                        _emit_progress(
                            "plan_created",
                            result.get("title") or "Plan",
                            tool=tool_name,
                            plan_file=result.get("plan_file") or "",
                            plan_title=result.get("title") or "Plan",
                        )

                    if tool_name == "attempt_completion" and result.get("completed"):
                        summary_text = str(result.get("result") or "")
                        if (
                            needs_code_change(question, classification)
                            and not edit_completed_this_turn
                            and not run_command_completed_this_turn
                        ):
                            reject = {
                                "completed": False,
                                "error": LIVECODE_GOAL_NOT_MET_PROMPT,
                                "error_kind": "goal_not_met",
                            }
                            compacted = compact_tool_result_for_llm(tool_name, reject)
                            _emit_progress(
                                "tool_result",
                                "Completion rejected — no edits applied",
                                tool=tool_name,
                                error=True,
                                success=False,
                                args=tool_args,
                                result=reject,
                            )
                            tool_msg = {
                                "role": "tool",
                                "tool_call_id": tool_call_id,
                                "content": json.dumps(compacted, default=str),
                            }
                            messages.append(tool_msg)
                            _persist_msg(tool_msg)
                            recovery = {
                                "role": "user",
                                "content": LIVECODE_GOAL_NOT_MET_PROMPT,
                                "internal": True,
                            }
                            messages.append(recovery)
                            _persist_msg(recovery)
                            edit_recovery_used = True
                            force_tool_choice_required = True
                            return "continue"

                        if (
                            edit_completed_this_turn
                            and not goal_verifier_used
                            and call_summarize
                            and summary_text.strip()
                        ):
                            goal_verifier_used = True
                            verify_model = _pick_iteration_model(
                                user_model,
                                classification,
                                tool_loop=False,
                                escalate=False,
                                content_chars=_estimate_content_chars(messages),
                            )
                            ok, reason = _verify_goal_completion(
                                question,
                                summary_text,
                                edited_files_this_turn,
                                call_summarize=call_summarize,
                                model=verify_model,
                            )
                            _emit_progress(
                                "goal_check",
                                reason or ("Verified" if ok else "Incomplete"),
                                complete=ok,
                                reason=reason,
                            )
                            if not ok:
                                reject = {
                                    "completed": False,
                                    "error": reason or "Goal verification failed",
                                    "error_kind": "goal_verify_failed",
                                }
                                compacted = compact_tool_result_for_llm(tool_name, reject)
                                tool_msg = {
                                    "role": "tool",
                                    "tool_call_id": tool_call_id,
                                    "content": json.dumps(compacted, default=str),
                                }
                                messages.append(tool_msg)
                                _persist_msg(tool_msg)
                                force_tool_choice_required = True
                                return "continue"

                        full_answer = summary_text
                        completed = True
                        _emit_progress(
                            "tool_result",
                            "Task complete",
                            tool=tool_name,
                            success=True,
                            args=tool_args,
                            result=result,
                        )
                        tool_msg = {
                            "role": "tool",
                            "tool_call_id": tool_call_id,
                            "content": json.dumps(compacted),
                        }
                        messages.append(tool_msg)
                        _persist_msg(tool_msg)
                        return "break"

                    if tool_name == STRUCTURED_OUTPUT_TOOL:
                        if result.get("valid"):
                            full_answer = format_structured_output_answer(result.get("data") or {})
                            completed = True
                            _emit_progress(
                                "tool_result",
                                "Structured JSON ready",
                                tool=tool_name,
                                success=True,
                                args=tool_args,
                                result=result,
                            )
                        else:
                            structured_output_retries += 1
                            err_text = result.get("error") or "Invalid JSON structure"
                            if structured_output_retries >= STRUCTURED_OUTPUT_MAX_RETRIES:
                                full_answer = (
                                    f"Could not produce valid JSON after "
                                    f"{STRUCTURED_OUTPUT_MAX_RETRIES} attempts: {err_text}"
                                )
                                completed = True
                            _emit_progress(
                                "tool_result",
                                err_text[:120],
                                tool=tool_name,
                                error=not result.get("valid"),
                                success=bool(result.get("valid")),
                                args=tool_args,
                                result=result,
                            )
                        tool_msg = {
                            "role": "tool",
                            "tool_call_id": tool_call_id,
                            "content": json.dumps(compacted, default=str),
                        }
                        messages.append(tool_msg)
                        _persist_msg(tool_msg)
                        return "break" if completed else "continue"

                    summary_msg, is_error = _tool_summary(tool_name, result)
                    if tool_name == "run_command":
                        cmd = str(tool_args.get("command") or "")
                        exit_code = result.get("exit_code")
                        if _is_test_command(cmd):
                            if exit_code not in (0, None) and not result.get("error"):
                                consecutive_test_failures += 1
                            else:
                                consecutive_test_failures = 0
                    if is_error:
                        consecutive_tool_errors += 1
                        if consecutive_tool_errors >= 2:
                            escalate = True
                    else:
                        consecutive_tool_errors = 0
                    if logger:
                        _ide_log(
                            logger,
                            "debug",
                            f"tool result {tool_name}",
                            "ok" if not is_error else "error",
                            (summary_msg or "")[:120],
                        )
                    emit_kwargs = {
                        "tool": tool_name,
                        "error": is_error,
                        "success": not is_error,
                        "error_kind": result.get("error_kind") if is_error else None,
                        "args": tool_args,
                        "result": result,
                    }
                    if is_error and result.get("error"):
                        emit_kwargs["error_full"] = str(result["error"])
                    if result.get("edits") is not None and tool_name == "edit_file":
                        emit_kwargs["edit_count"] = len(result.get("edits") or [])
                    hide_from_activity = is_error and (
                        (
                            tool_name in ("read_repo_file", "ast_symbols")
                            and str(result.get("error") or "").startswith("File not found:")
                        )
                        or (
                            tool_name == "run_command"
                            and str(result.get("error") or "")
                            == "Use the git_log tool for commit history instead of run_command git log."
                        )
                    )
                    if not hide_from_activity:
                        _emit_progress(
                            "tool_result",
                            summary_msg,
                            **emit_kwargs,
                        )
                    tool_msg = {
                        "role": "tool",
                        "tool_call_id": tool_call_id,
                        "content": json.dumps(compacted, default=str),
                    }
                    messages.append(tool_msg)
                    _persist_msg(tool_msg)
                    return ""

                executed = _execute_tool_calls_batch(
                    project_path,
                    tool_calls,
                    iteration,
                    announce_fn=_announce_tool_call,
                    **tool_exec_kwargs,
                )
                for item in executed:
                    action = _finish_tool_item(item)
                    if action == "break":
                        break

                exploration_streak.observe_iteration(
                    [item.get("tool_name") or "" for item in executed],
                )

                if completed:
                    turn_summary = build_turn_activity_summary(tool_events)
                    turn_messages = _finalize_turn_persist(full_answer)
                    yield f"data: {json.dumps({'done': True, 'answer': full_answer, 'turn_summary': turn_summary, 'turn_messages': turn_messages})}\n\n"
                    _emit_complete(len(full_answer), turn_summary)
                    return
                continue

            duration_s = _thinking_duration_s()
            content = response.get("content") or ""
            reasoning_only = (response.get("reasoning_content") or "").strip()
            _emit_progress(
                "agent_thinking_done",
                f"Thought for {duration_s}s",
                duration_s=duration_s,
                thought_content=reasoning_only,
            )
            thinking_start = None

            if (
                iteration == 1
                and not codebase_recovery_used
                and content
                and needs_codebase_evidence(question, has_prior_turns=has_prior_turns)
                and not classification.get("is_meta")
                and not classification.get("chat_only")
            ):
                recovery = {"role": "user", "content": LIVECODE_CODEBASE_RECOVERY_PROMPT, "internal": True}
                messages.append(recovery)
                _persist_msg(recovery)
                codebase_recovery_used = True
                force_tool_choice_required = True
                if logger:
                    _ide_log(logger, "info", "codebase recovery", f"q={len(question)}")
                continue

            if (
                not edit_recovery_used
                and (content or reasoning_only)
                and looks_like_file_edit(question)
                and bool(files_read_this_turn)
                and not edit_completed_this_turn
            ):
                recovery = {"role": "user", "content": LIVECODE_EDIT_RECOVERY_PROMPT, "internal": True}
                messages.append(recovery)
                _persist_msg(recovery)
                edit_recovery_used = True
                force_tool_choice_required = True
                if logger:
                    _ide_log(logger, "info", "edit recovery", f"files={len(files_read_this_turn)}")
                continue

            combined_text = f"{content}\n{reasoning_only}".strip()
            if (
                not tail_repetition_used
                and combined_text
                and detect_tail_repetition(combined_text)
                and not edit_completed_this_turn
            ):
                nudge = {"role": "user", "content": TAIL_REPETITION_NUDGE_TEMPLATE, "internal": True}
                messages.append(nudge)
                _persist_msg(nudge)
                tail_repetition_used = True
                force_tool_choice_required = True
                if logger:
                    _ide_log(logger, "info", "tail repetition recovery")
                continue

            final_model = _pick_iteration_model(
                user_model,
                classification,
                tool_loop=False,
                escalate=escalate,
                content_chars=_estimate_content_chars(messages),
            )
            if _is_auto_model(user_model) and final_model != user_model:
                if logger:
                    _ide_log(logger, "info", "final answer", final_model)

            if (
                todo_gate_active(todo_gate_config)
                and todo_gate_fires < todo_gate_config.max_fires_per_prompt
            ):
                session_rem = load_session_reminders(project_path, session_id)
                session_todos = [
                    (str(i), str(t.get("content") or ""), str(t.get("status") or "pending"))
                    for i, t in enumerate(session_rem.get("todos") or [])
                    if isinstance(t, dict)
                ]
                gate_input = collect_todo_gate_input_from_session(session_todos)
                gate_result = evaluate_todo_gate(gate_input)
                if gate_result.decision == TodoGateDecision.NUDGE:
                    todo_gate_fires += 1
                    nudge = {"role": "user", "content": gate_result.reminder, "internal": True}
                    messages.append(nudge)
                    _persist_msg(nudge)
                    force_tool_choice_required = True
                    if logger:
                        _ide_log(logger, "info", "todo gate nudge", f"fire={todo_gate_fires}")
                    continue

            if content:
                full_answer = content
            else:
                full_answer = _complete_text_non_streaming(
                    final_model,
                    messages,
                    call_summarize=call_summarize,
                    call_with_tools=call_with_tools,
                    logger=logger,
                    session_id=session_id,
                    log_label="final answer",
                )
            turn_summary = build_turn_activity_summary(tool_events)
            turn_messages = _finalize_turn_persist(full_answer)
            yield f"data: {json.dumps({'done': True, 'answer': full_answer, 'turn_summary': turn_summary, 'turn_messages': turn_messages})}\n\n"
            _emit_complete(len(full_answer), turn_summary)
            return

        summarize_model = _pick_iteration_model(
            user_model,
            classification,
            tool_loop=False,
            escalate=escalate,
            content_chars=_estimate_content_chars(messages),
        )
        _start_thinking()
        _emit_progress("agent_thinking", "Summarizing findings")
        full_answer = _run_exhaustion_summarize(
            summarize_model=summarize_model,
            messages=messages,
            call_summarize=call_summarize,
            call_with_tools=call_with_tools,
            tool_events=tool_events,
            logger=logger,
            session_id=session_id,
        )
        turn_summary = build_turn_activity_summary(tool_events)
        turn_messages = _finalize_turn_persist(full_answer)
        yield f"data: {json.dumps({'done': True, 'answer': full_answer, 'turn_summary': turn_summary, 'turn_messages': turn_messages})}\n\n"
        _emit_complete(len(full_answer), turn_summary)

    except Exception as e:
        if logger:
            _ide_log(logger, "exception", "Harness error", sid=_log_session_id(session_id), exc_info=True)
        yield f"data: {json.dumps({'error': str(e)})}\n\n"

# ============================================================================
