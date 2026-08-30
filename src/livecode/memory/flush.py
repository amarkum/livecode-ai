"""LiveCode — memory — flush."""
from __future__ import annotations

from livecode._deps import load_prior
load_prior('livecode.memory.flush', globals())

import hashlib
from datetime import datetime, timezone
from typing import Any, Callable


MAX_FLUSH_WRITE_CHARS = 8000

FLUSH_SYSTEM_PROMPT = (
    "You are a memory assistant. Extract ALL useful information from this conversation "
    "that would help you be more effective in future sessions with this user. "
    "Write a concise markdown summary with ## headers covering:\n\n"
    "- **Decisions & rationale** — what was chosen and why\n"
    "- **Technical context** — architecture, APIs, patterns, tools, file paths discussed\n"
    "- **Debugging techniques & tools** — external APIs, CLI commands, query patterns, "
    "investigation workflows, or services discovered or used during debugging\n"
    "- **Problems & solutions** — bugs found, how they were fixed, workarounds\n\n"
    "Omit any section where there is nothing substantive to report. "
    "Do NOT include user preferences like OS, shell, or editor — these belong in global memory. "
    "Do NOT include an ephemeral progress section — transient status is not useful for future sessions.\n\n"
    "Respond with NO_REPLY if nothing genuinely useful was learned — a routine task "
    "that followed standard patterns, brief Q&A, or sessions with no novel decisions "
    "or discoveries are not worth persisting. Only write content that a future session "
    "would concretely benefit from."
)

def has_markdown_headers(text: str) -> bool:
    return any(line.startswith("## ") for line in (text or "").splitlines())

def is_no_reply(text: str) -> bool:
    stripped = (text or "").strip()
    if not stripped:
        return True
    upper = stripped.upper()
    return upper == "NO_REPLY" or upper.startswith("NO_REPLY\n")

def process_flush_response(raw: str, *, max_chars: int = MAX_FLUSH_WRITE_CHARS) -> str | None:
    text = (raw or "").strip()
    if is_no_reply(text):
        return None
    if not has_markdown_headers(text):
        return None
    if len(text) > max_chars:
        text = text[:max_chars].rstrip() + "\n"
    return text

def _content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()

def run_memory_flush(
    project_path: str,
    session_id: str,
    messages: list[dict[str, Any]],
    *,
    model: str,
    call_summarize: Callable[[str, list[dict[str, str]]], str],
    last_flush_hash: str | None = None,
) -> dict[str, Any]:
    window = _flush_window(messages)
    if len(window) < 2:
        return {"status": "skipped", "reason": "too_short"}
    prompt_messages: list[dict[str, str]] = [
        {"role": "system", "content": FLUSH_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": _format_conversation_for_flush(window),
        },
    ]
    try:
        raw = call_summarize(model, prompt_messages) or ""
    except Exception as exc:
        return {"status": "failed", "error": str(exc)}
    accepted = process_flush_response(raw)
    if not accepted:
        return {"status": "skipped", "reason": "quality_gate"}
    h = _content_hash(accepted)
    if last_flush_hash and h == last_flush_hash:
        return {"status": "skipped", "reason": "duplicate"}

    real = extract_real_user_queries(messages)
    topic = _memory_slugify(real[0], 30) if real else "flush"
    topic = topic or "flush"
    date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    path = write_session_log(
        project_path,
        date=date,
        topic_slug=topic,
        session_id=session_id,
        content=accepted,
        append=True,
    )
    if path:
        reindex_file(project_path, path, "session")
        embed_missing_chunks(project_path)
    return {"status": "written", "path": path, "hash": h, "chars": len(accepted)}

def _flush_window(messages: list[dict[str, Any]], limit: int = 40) -> list[dict[str, Any]]:
    filtered = [m for m in (messages or []) if m.get("role") in {"user", "assistant", "tool"}]
    return filtered[-limit:]

def _format_conversation_for_flush(messages: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for msg in messages:
        role = msg.get("role", "")
        content = msg.get("content") or ""
        if isinstance(content, list):
            content = str(content)
        if len(content) > 4000:
            content = content[:4000] + "…"
        parts.append(f"### {role}\n{content}")
    return "\n\n".join(parts)

# ============================================================================
