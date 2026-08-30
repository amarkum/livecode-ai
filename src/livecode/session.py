"""LiveCode — session."""
from __future__ import annotations

from livecode._deps import load_prior
load_prior('livecode.session', globals())

import hashlib
import json
import os
import shutil
import time
from typing import Any


CHAT_HISTORY_FILE = "chat_history.jsonl"
SUMMARY_FILE = "summary.json"
COMPACTION_FILE = "compaction.json"
CHECKPOINTS_DIR = "compaction_checkpoints"
DIFFS_FILE = "diffs.jsonl"
TOOL_ARTIFACTS_FILE = "tool_artifacts.jsonl"

def session_dir(project_path: str, session_id: str, *, create: bool = True) -> str:
    safe_id = "".join(c for c in (session_id or "") if c.isalnum() or c in ("_", "-"))[:128]
    if not safe_id:
        raise ValueError("session_id required")
    path = project_file(project_path, "sessions", safe_id, create=create)
    if create:
        os.makedirs(path, exist_ok=True)
    return path

def _chat_history_path(project_path: str, session_id: str) -> str:
    return os.path.join(session_dir(project_path, session_id), CHAT_HISTORY_FILE)

def _summary_path(project_path: str, session_id: str) -> str:
    return os.path.join(session_dir(project_path, session_id), SUMMARY_FILE)

def _compaction_path(project_path: str, session_id: str) -> str:
    return os.path.join(session_dir(project_path, session_id), COMPACTION_FILE)

def _read_jsonl(path: str) -> list[dict[str, Any]]:
    if not os.path.isfile(path):
        return []
    messages: list[dict[str, Any]] = []
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                messages.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return messages

def _count_jsonl_lines(path: str) -> int:
    if not os.path.isfile(path):
        return 0
    count = 0
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                if line.strip():
                    count += 1
    except OSError:
        return 0
    return count

def _append_jsonl(path: str, record: dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(record, default=str) + "\n")

def _canonical_prefix_hash(messages: list[dict[str, Any]], boundary_index: int) -> str:
    prefix = messages[:boundary_index]
    payload = json.dumps(prefix, sort_keys=True, default=str)
    return hashlib.sha256(payload.encode()).hexdigest()

def load_session(project_path: str, session_id: str) -> dict[str, Any]:
    sdir = session_dir(project_path, session_id, create=False)
    summary_path = os.path.join(sdir, SUMMARY_FILE)
    summary: dict[str, Any] = {}
    if os.path.isfile(summary_path):
        try:
            with open(summary_path, "r", encoding="utf-8") as f:
                summary = json.load(f)
        except (json.JSONDecodeError, OSError):
            summary = {}

    messages = _read_jsonl(os.path.join(sdir, CHAT_HISTORY_FILE))
    compaction: dict[str, Any] | None = None
    cpath = os.path.join(sdir, COMPACTION_FILE)
    if os.path.isfile(cpath):
        try:
            with open(cpath, "r", encoding="utf-8") as f:
                compaction = json.load(f)
        except (json.JSONDecodeError, OSError):
            compaction = None

    return {
        "session_id": session_id,
        "project_path": project_path,
        "session_dir": sdir,
        "summary": summary,
        "messages": messages,
        "compaction": compaction,
    }

def save_diff_record(
    project_path: str,
    session_id: str,
    tool_call_id: str,
    *,
    file_name: str,
    diff_html: str,
    additions: int = 0,
    deletions: int = 0,
    absolute_path: str = "",
) -> None:
    if not tool_call_id or not diff_html:
        return
    path = os.path.join(session_dir(project_path, session_id), DIFFS_FILE)
    _append_jsonl(path, {
        "tool_call_id": tool_call_id,
        "file_name": file_name,
        "diff_html": diff_html,
        "additions": additions,
        "deletions": deletions,
        "absolute_path": absolute_path,
    })

def load_diff_records(project_path: str, session_id: str) -> dict[str, dict[str, Any]]:
    path = os.path.join(session_dir(project_path, session_id, create=False), DIFFS_FILE)
    records = _read_jsonl(path)
    return {r["tool_call_id"]: r for r in records if r.get("tool_call_id")}

def _compact_artifact_result(tool_name: str, result: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(result, dict):
        return {"summary": str(result)[:2000]}
    if tool_name in ("write_file", "edit_file"):
        return {
            "success": result.get("success"),
            "error": result.get("error"),
            "file_path": result.get("file_path"),
            "action": result.get("action") or tool_name,
            "diff_html": result.get("diff_html", ""),
            "additions": result.get("additions", 0),
            "deletions": result.get("deletions", 0),
            "absolute_path": result.get("absolute_path", ""),
        }
    if tool_name == "run_command":
        output = str(result.get("output") or "")
        return {
            "success": result.get("success"),
            "error": result.get("error"),
            "command": result.get("command"),
            "exit_code": result.get("exit_code"),
            "output": output[:24000] + ("\n... [truncated]" if len(output) > 24000 else ""),
            "hint": result.get("hint"),
        }
    return {
        "success": result.get("success"),
        "error": result.get("error"),
        "summary": str(result.get("summary") or result.get("message") or "")[:2000],
    }

def save_tool_artifact(
    project_path: str,
    session_id: str,
    tool_call_id: str,
    *,
    tool_name: str,
    tool_args: dict[str, Any] | None = None,
    result: dict[str, Any] | None = None,
    iteration: int | None = None,
) -> None:
    if not tool_call_id or not tool_name:
        return
    result = result or {}
    should_store = tool_name in ("run_command", "write_file", "edit_file") or bool(result.get("error"))
    if not should_store:
        return
    path = os.path.join(session_dir(project_path, session_id), TOOL_ARTIFACTS_FILE)
    _append_jsonl(path, {
        "tool_call_id": tool_call_id,
        "tool_name": tool_name,
        "tool_args": tool_args or {},
        "result": _compact_artifact_result(tool_name, result),
        "iteration": iteration,
        "created_at": time.time(),
    })

def load_tool_artifacts(project_path: str, session_id: str) -> dict[str, dict[str, Any]]:
    path = os.path.join(session_dir(project_path, session_id, create=False), TOOL_ARTIFACTS_FILE)
    records = _read_jsonl(path)
    return {r["tool_call_id"]: r for r in records if r.get("tool_call_id")}

def _load_compaction(project_path: str, session_id: str) -> dict[str, Any] | None:
    path = _compaction_path(project_path, session_id)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None

def _strip_display_metadata(msg: dict[str, Any]) -> dict[str, Any]:
    drop = {"display", "reasoning_content", "internal"}
    if not any(k in msg for k in drop):
        return msg
    return {k: v for k, v in msg.items() if k not in drop}

def _sanitize_display_payload(display: dict[str, Any] | None) -> dict[str, Any] | None:
    if not display or not isinstance(display, dict):
        return None
    out: dict[str, Any] = {
        "text": str(display.get("text") or ""),
        "segments": list(display.get("segments") or []),
        "attachments": [],
    }
    for att in (display.get("attachments") or [])[:10]:
        if not isinstance(att, dict):
            continue
        clean: dict[str, Any] = {
            "id": str(att.get("id") or ""),
            "name": str(att.get("name") or ""),
            "type": str(att.get("type") or "file"),
        }
        if att.get("size") is not None:
            clean["size"] = att.get("size")
        if clean["type"] in ("repo_file", "repo_folder") and att.get("repo_path"):
            clean["repo_path"] = str(att.get("repo_path") or "")
        data = att.get("data")
        if clean["type"] == "image" and isinstance(data, str) and data.startswith("data:"):
            if len(data) <= 500_000:
                clean["data"] = data
        out["attachments"].append(clean)
    return out

def sanitize_messages_for_api(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    i = 0
    n = len(messages)

    while i < n:
        msg = messages[i]
        role = msg.get("role")

        if role == "tool":
            prev = out[-1] if out else None
            if not prev or prev.get("role") != "assistant" or not prev.get("tool_calls"):
                i += 1
                continue
            expected_ids = {tc.get("id") for tc in prev.get("tool_calls") or []}
            if msg.get("tool_call_id") not in expected_ids:
                i += 1
                continue
            out.append(_strip_display_metadata(msg))
            i += 1
            continue

        if role == "assistant" and msg.get("tool_calls"):
            tool_calls = msg.get("tool_calls") or []
            expected_ids = {tc.get("id") for tc in tool_calls}
            j = i + 1
            matched: list[dict[str, Any]] = []
            while j < n and messages[j].get("role") == "tool":
                tid = messages[j].get("tool_call_id")
                if tid in expected_ids:
                    matched.append(_strip_display_metadata(messages[j]))
                j += 1
            if not matched:
                slim = _strip_display_metadata({k: v for k, v in msg.items() if k != "tool_calls"})
                if slim.get("content") or slim.get("role"):
                    out.append(slim)
            else:
                out.append(_strip_display_metadata(msg))
                out.extend(matched)
            i = j
            continue

        out.append(_strip_display_metadata(msg))
        i += 1

    return out

def _valid_compaction(messages: list[dict], compaction: dict[str, Any] | None) -> bool:
    if not compaction or not compaction.get("summary"):
        return False
    boundary = int(compaction.get("boundary_index", 0))
    if boundary < 0 or boundary > len(messages):
        return False
    expected = compaction.get("prefix_hash")
    if not expected:
        return False
    return _canonical_prefix_hash(messages, boundary) == expected

def has_valid_compaction(project_path: str, session_id: str) -> bool:
    session = load_session(project_path, session_id)
    messages = session.get("messages") or []
    return _valid_compaction(messages, session.get("compaction"))

def get_projected_messages(
    project_path: str,
    session_id: str,
    current_question: str | list,
    *,
    rules_reminder: str = "",
    wrap_query: bool = True,
) -> list[dict[str, Any]]:

    session = load_session(project_path, session_id)
    messages = list(session.get("messages") or [])
    compaction = session.get("compaction")

    projected: list[dict[str, Any]] = []
    if _valid_compaction(messages, compaction):
        summary = str(compaction.get("summary", "")).strip()
        boundary = int(compaction["boundary_index"])
        if summary:
            projected.append({
                "role": "user",
                "content": (
                    "[Previous conversation summary — continue from this context]\n\n"
                    + summary
                ),
            })
        if rules_reminder:
            projected.append({"role": "user", "content": rules_reminder})
        projected.extend(sanitize_messages_for_api(messages[boundary:]))
    else:
        projected.extend(sanitize_messages_for_api(messages))

    question_content = wrap_user_content(current_question) if wrap_query else current_question
    projected.append({"role": "user", "content": question_content})
    return projected

def _message_content_text(raw: Any) -> str:
    if raw is None:
        return ""
    if isinstance(raw, str):
        return raw.strip()
    if isinstance(raw, list):
        parts: list[str] = []
        for block in raw:
            if isinstance(block, dict):
                if block.get("type") == "text":
                    parts.append(str(block.get("text") or ""))
            elif isinstance(block, str):
                parts.append(block)
        return "\n".join(p.strip() for p in parts if p and str(p).strip()).strip()
    return str(raw).strip()

def _first_user_title(messages: list[dict[str, Any]] | None) -> str | None:
    for msg in messages or []:
        if msg.get("role") != "user":
            continue
        display = msg.get("display") or {}
        display_text = str(display.get("text") or "").strip()
        text = display_text or strip_attached_file_blocks(_message_content_text(msg.get("content")))
        if not text:
            continue
        if text.startswith("[Turn activity summary]") or text.startswith("[Previous conversation summary"):
            continue
        return text[:120]
    return None

def append_messages(
    project_path: str,
    session_id: str,
    new_messages: list[dict[str, Any]],
    *,
    model: str | None = None,
    title: str | None = None,
) -> None:
    if not new_messages:
        return
    path = _chat_history_path(project_path, session_id)
    for msg in new_messages:
        _append_jsonl(path, msg)

    summary_path = _summary_path(project_path, session_id)
    summary: dict[str, Any] = {}
    if os.path.isfile(summary_path):
        try:
            with open(summary_path, "r", encoding="utf-8") as f:
                summary = json.load(f)
        except (json.JSONDecodeError, OSError):
            summary = {}

    now = time.time()
    if not summary.get("created_at"):
        summary["created_at"] = now
    summary["updated_at"] = now
    summary["session_id"] = session_id
    summary["project_path"] = os.path.abspath(os.path.expanduser(project_path))
    summary["message_count"] = len(_read_jsonl(path))
    if model:
        summary["model"] = model
    effective_title = (title or "").strip()
    if not effective_title and not summary.get("title"):
        effective_title = (_first_user_title(new_messages) or "").strip()
    if effective_title and not summary.get("title"):
        summary["title"] = effective_title[:200]

    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

def save_compaction(
    project_path: str,
    session_id: str,
    *,
    boundary_index: int,
    summary: str,
    messages: list[dict[str, Any]] | None = None,
    strategy: str = "full_replace",
    attempts: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    if messages is None:
        messages = _read_jsonl(_chat_history_path(project_path, session_id))

    record: dict[str, Any] = {
        "boundary_index": boundary_index,
        "summary": summary.strip(),
        "prefix_hash": _canonical_prefix_hash(messages, boundary_index),
        "compacted_at": time.time(),
        "strategy": strategy,
    }
    if attempts:
        record["attempts"] = attempts

    sdir = session_dir(project_path, session_id)
    cpath = os.path.join(sdir, COMPACTION_FILE)
    with open(cpath, "w", encoding="utf-8") as f:
        json.dump(record, f, indent=2)

    checkpoints = os.path.join(sdir, CHECKPOINTS_DIR)
    os.makedirs(checkpoints, exist_ok=True)
    ts = int(time.time() * 1000)
    checkpoint_path = os.path.join(checkpoints, f"{ts}.json")
    with open(checkpoint_path, "w", encoding="utf-8") as f:
        json.dump({"compaction": record, "message_count": len(messages)}, f, indent=2)

    summary_path = _summary_path(project_path, session_id)
    meta: dict[str, Any] = {}
    if os.path.isfile(summary_path):
        try:
            with open(summary_path, "r", encoding="utf-8") as f:
                meta = json.load(f)
        except (json.JSONDecodeError, OSError):
            meta = {}
    meta["compaction_count"] = int(meta.get("compaction_count", 0)) + 1
    meta["last_compacted_at"] = record["compacted_at"]
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)

    return record

def append_turn_summary(
    project_path: str,
    session_id: str,
    question: str,
    answer: str,
    turn_summary: str | None = None,
    *,
    model: str | None = None,
    title: str | None = None,
    display: dict[str, Any] | None = None,
) -> None:
    user_msg: dict[str, Any] = {"role": "user", "content": question}
    clean_display = _sanitize_display_payload(display)
    if clean_display:
        user_msg["display"] = clean_display
    to_append: list[dict[str, Any]] = [
        user_msg,
    ]
    if turn_summary and turn_summary.strip():
        to_append.append({
            "role": "user",
            "content": f"[Turn activity summary]\n{turn_summary.strip()}",
        })
    if answer and answer.strip():
        to_append.append({"role": "assistant", "content": answer.strip()})
    append_messages(
        project_path,
        session_id,
        to_append,
        model=model,
        title=(title or question[:120]),
    )

def append_turn_messages(
    project_path: str,
    session_id: str,
    turn_messages: list[dict[str, Any]],
    *,
    model: str | None = None,
    title: str | None = None,
) -> None:
    if not turn_messages:
        return
    append_messages(
        project_path,
        session_id,
        turn_messages,
        model=model,
        title=(title or _first_user_title(turn_messages) or "")[:200] or None,
    )

def _user_interjection_body(content: str) -> str | None:
    prefix = "[User interjection]"
    if not content.startswith(prefix):
        return None
    body = content[len(prefix):].lstrip("\n").strip()
    return body

def _is_legacy_internal_user_content(content: str) -> bool:
    if not content:
        return False
    markers = (
        "with the exact same arguments",
        "narrow search calls in a row",
        "steps exploring (search/read only)",
        "steps exploring without producing an answer",
        "steps left this turn — wrap up soon",
        "directories in a row by drilling",
        "If verification is blocked, call attempt_completion",
        "Test commands failed twice in a row",
        "You must read the codebase before answering",
    )
    return any(marker in content for marker in markers)

def format_messages_for_display(
    messages: list[dict[str, Any]],
    diffs: dict[str, dict[str, Any]] | None = None,
    tool_artifacts: dict[str, dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    diffs = diffs or {}
    tool_artifacts = tool_artifacts or {}
    display: list[dict[str, Any]] = []
    consumed_artifacts: set[str] = set()
    consumed_diffs: set[str] = set()

    def _artifact_needs_diff_fallback(artifact: dict[str, Any], tc_id: str) -> bool:
        if tc_id not in diffs:
            return False
        tool_name = str(artifact.get("tool_name") or "")
        if tool_name not in ("write_file", "edit_file"):
            return False
        result = artifact.get("result") or {}
        return not str(result.get("diff_html") or "").strip()

    def _append_tool_artifact_for_display(artifact: dict[str, Any], tc_id: str) -> None:
        tool_name = str(artifact.get("tool_name") or "")
        result = artifact.get("result") or {}
        diff_html = str(result.get("diff_html") or "").strip()
        if tool_name in ("write_file", "edit_file") and diff_html:
            tool_args = artifact.get("tool_args") or {}
            display.append({
                "role": "diff",
                "file_name": result.get("file_path") or tool_args.get("file_path") or "",
                "diff_html": diff_html,
                "additions": result.get("additions", 0),
                "deletions": result.get("deletions", 0),
                "absolute_path": result.get("absolute_path", ""),
            })
            consumed_diffs.add(tc_id)
        else:
            display.append({"role": "tool_artifact", **artifact})
        consumed_artifacts.add(tc_id)
        if _artifact_needs_diff_fallback(artifact, tc_id):
            display.append({"role": "diff", **diffs[tc_id]})
            consumed_diffs.add(tc_id)

    for msg in messages or []:
        role = msg.get("role")
        content = _message_content_text(msg.get("content"))
        tool_calls = msg.get("tool_calls")

        if role == "user":
            if not content and not msg.get("display"):
                continue
            if content.startswith("[Turn activity summary]"):
                display.append({
                    "role": "activity",
                    "content": content.replace("[Turn activity summary]\n", "", 1),
                })
                continue
            if content.startswith("[Previous conversation summary"):
                continue
            if msg.get("internal") or _is_legacy_internal_user_content(content):
                continue
            interjection = _user_interjection_body(content)
            if interjection is not None:
                if not interjection:
                    continue
                display.append({"role": "user", "content": interjection})
                continue
            clean_content = strip_attached_file_blocks(content) if content else ""
            entry: dict[str, Any] = {"role": "user", "content": clean_content or str(msg.get("content") or "")}
            if msg.get("display"):
                entry["display"] = msg["display"]
            elif clean_content:
                entry["display"] = {"text": clean_content, "segments": [], "attachments": []}
            display.append(entry)
        elif role == "assistant":
            if tool_calls:
                reasoning = str(msg.get("reasoning_content") or "").strip()
                thought_parts = [p for p in [reasoning, content.strip()] if p]
                thought_text = "\n".join(thought_parts)
                for idx, tc in enumerate(tool_calls):
                    if idx == 0 and thought_text:
                        display.append({
                            "role": "activity",
                            "content": thought_text,
                            "thought_only": True,
                            "thought_content": thought_text,
                        })
                    fn = tc.get("function") or {}
                    name = fn.get("name", "tool")
                    display.append({
                        "role": "activity",
                        "content": name,
                        "tool_calls": [tc],
                    })
                    tc_id = tc.get("id") or ""
                    if not tc_id:
                        continue
                    artifact = tool_artifacts.get(tc_id)
                    if artifact:
                        _append_tool_artifact_for_display(artifact, tc_id)
                    elif tc_id in diffs:
                        display.append({"role": "diff", **diffs[tc_id]})
                        consumed_diffs.add(tc_id)
            elif content:
                display.append({"role": "assistant", "content": content})
        elif role == "tool":
            tc_id = msg.get("tool_call_id") or ""
            if tc_id and tc_id in tool_artifacts and tc_id not in consumed_artifacts:
                _append_tool_artifact_for_display(tool_artifacts[tc_id], tc_id)
                continue
            if tc_id and tc_id in consumed_artifacts:
                continue
            if tc_id and tc_id in diffs and tc_id not in consumed_diffs:
                display.append({"role": "diff", **diffs[tc_id]})
                consumed_diffs.add(tc_id)
                continue
            if content:
                display.append({
                    "role": "tool",
                    "content": content[:500],
                    "tool_call_id": tc_id,
                })

    for tc_id, artifact in sorted(
        tool_artifacts.items(),
        key=lambda item: float((item[1] or {}).get("created_at") or 0),
    ):
        if tc_id in consumed_artifacts:
            continue
        _append_tool_artifact_for_display(artifact, tc_id)

    for tc_id, diff in diffs.items():
        if tc_id in consumed_diffs:
            continue
        display.append({"role": "diff", **diff})

    return display

def set_session_title(
    project_path: str,
    session_id: str,
    title: str,
    *,
    overwrite: bool = False,
) -> None:
    clean = (title or "").strip()[:200]
    if not clean:
        return
    sdir = session_dir(project_path, session_id)
    summary_path = _summary_path(project_path, session_id)
    summary: dict[str, Any] = {}
    if os.path.isfile(summary_path):
        try:
            with open(summary_path, "r", encoding="utf-8") as f:
                summary = json.load(f)
        except (json.JSONDecodeError, OSError):
            summary = {}
    if summary.get("title") and not overwrite:
        return
    now = time.time()
    if not summary.get("created_at"):
        summary["created_at"] = now
    summary["updated_at"] = now
    summary["session_id"] = session_id
    summary["project_path"] = os.path.abspath(os.path.expanduser(project_path))
    summary["title"] = clean
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

def list_sessions(project_path: str, *, limit: int = 30) -> list[dict[str, Any]]:
    base = project_file(project_path, "sessions", create=False)
    if not os.path.isdir(base):
        return []

    sessions: list[dict[str, Any]] = []
    for name in os.listdir(base):
        try:
            sdir = os.path.join(base, name)
            if not os.path.isdir(sdir):
                continue
            history_path = os.path.join(sdir, CHAT_HISTORY_FILE)
            summary_path = os.path.join(sdir, SUMMARY_FILE)
            meta: dict[str, Any] = {"session_id": name}
            if os.path.isfile(summary_path):
                try:
                    with open(summary_path, "r", encoding="utf-8") as f:
                        meta.update(json.load(f))
                except (json.JSONDecodeError, OSError):
                    pass
            meta.setdefault("updated_at", os.path.getmtime(sdir))
            message_count = _count_jsonl_lines(history_path)
            meta["message_count"] = message_count
            if not message_count and not meta.get("title"):
                continue
            if not meta.get("title"):
                preview = _first_user_title(_read_jsonl(history_path))
                if preview:
                    meta["first_user_preview"] = preview[:120]
            sessions.append(meta)
        except Exception:
            continue

    sessions.sort(key=lambda s: float(s.get("updated_at") or 0), reverse=True)
    return sessions[:limit]

def delete_session(project_path: str, session_id: str) -> bool:
    safe_id = "".join(c for c in (session_id or "") if c.isalnum() or c in ("_", "-"))[:128]
    if not safe_id:
        return False
    path = project_file(project_path, "sessions", safe_id, create=False)
    if not os.path.isdir(path):
        return False
    shutil.rmtree(path)
    return True

def rename_session(project_path: str, session_id: str, title: str) -> bool:
    clean_title = (title or "").strip()[:200]
    if not clean_title:
        raise ValueError("title required")
    sdir = session_dir(project_path, session_id)
    if not os.path.isdir(sdir):
        return False
    summary_path = _summary_path(project_path, session_id)
    summary: dict[str, Any] = {}
    if os.path.isfile(summary_path):
        try:
            with open(summary_path, "r", encoding="utf-8") as f:
                summary = json.load(f)
        except (json.JSONDecodeError, OSError):
            summary = {}
    summary["title"] = clean_title
    summary["session_id"] = session_id
    summary["updated_at"] = time.time()
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)
    return True

def fork_session(project_path: str, session_id: str, new_session_id: str) -> dict[str, Any]:
    import shutil
    src = session_dir(project_path, session_id)
    dst = session_dir(project_path, new_session_id)
    if os.path.isdir(dst) and os.listdir(dst):
        raise ValueError(f"Target session already exists: {new_session_id}")
    os.makedirs(dst, exist_ok=True)
    for name in os.listdir(src):
        sp = os.path.join(src, name)
        if os.path.isfile(sp):
            shutil.copy2(sp, os.path.join(dst, name))
    return load_session(project_path, new_session_id)

def rewind_to_message(
    project_path: str,
    session_id: str,
    message_index: int,
) -> list[dict[str, Any]]:
    path = _chat_history_path(project_path, session_id)
    messages = _read_jsonl(path)
    if message_index < 0 or message_index > len(messages):
        raise ValueError(f"message_index out of range: {message_index}")
    kept = messages[:message_index]
    with open(path, "w", encoding="utf-8") as f:
        for msg in kept:
            f.write(json.dumps(msg, default=str) + "\n")
    cpath = _compaction_path(project_path, session_id)
    if os.path.isfile(cpath):
        try:
            os.remove(cpath)
        except OSError:
            pass
    return kept

# ============================================================================
