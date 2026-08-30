"""LiveCode — compaction — inter."""
from __future__ import annotations

from livecode._deps import load_prior
load_prior('livecode.compaction.inter', globals())

from typing import Any, Callable


def maybe_inter_turn_compact(
    project_path: str,
    session_id: str,
    *,
    model: str,
    call_summarize: Callable[[str, list[dict[str, str]]], str],
    context_window: int = LIVECODE_CONTEXT_WINDOW,
    threshold_ratio: float = LIVECODE_INTER_COMPACT_RATIO,
) -> dict[str, Any] | None:
    session = load_session(project_path, session_id)
    messages = session.get("messages") or []
    if len(messages) < 10:
        return None

    token_est = estimate_messages_tokens(messages)
    threshold = int(context_window * threshold_ratio)
    full_threshold = int(context_window * 0.85)
    if token_est < threshold or token_est >= full_threshold:
        return None

    mid = len(messages) // 2
    if mid < 2:
        return None

    try:
        summary, boundary, attempts = apply_full_replace_compaction(
            messages,
            call_summarize=call_summarize,
            model=model,
            keep_recent=len(messages) - mid,
        )
    except ValueError:
        return None

    record = save_compaction(
        project_path,
        session_id,
        boundary_index=boundary,
        summary=summary,
        messages=messages,
        strategy="inter_turn",
        attempts=attempts,
    )
    return record

# ============================================================================
