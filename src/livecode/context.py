"""LiveCode — context."""
from __future__ import annotations

from livecode._deps import load_prior
load_prior('livecode.context', globals())

from typing import Any, Callable



def maybe_compact_session(
    project_path: str,
    session_id: str,
    *,
    model: str,
    call_summarize: Callable[[str, list[dict[str, str]]], str],
    context_window: int = LIVECODE_CONTEXT_WINDOW,
    threshold_ratio: float = LIVECODE_AUTO_COMPACT_RATIO,
    force: bool = False,
) -> dict[str, Any] | None:
    session = load_session(project_path, session_id)
    messages = session.get("messages") or []
    if len(messages) < 4 and not force:
        return None

    token_est = estimate_messages_tokens(messages)
    threshold = int(context_window * threshold_ratio)
    if not force and token_est < threshold:
        if not force:
            inter = maybe_inter_turn_compact(
                project_path,
                session_id,
                model=model,
                call_summarize=call_summarize,
                context_window=context_window,
            )
            if inter:
                return inter
        return None

    try:
        run_memory_flush(
            project_path,
            session_id,
            messages,
            model=model,
            call_summarize=call_summarize,
        )
    except Exception:
        pass

    try:
        summary, boundary, attempts = apply_full_replace_compaction(
            messages,
            call_summarize=call_summarize,
            model=model,
        )
    except ValueError:
        return None

    return save_compaction(
        project_path,
        session_id,
        boundary_index=boundary,
        summary=summary,
        messages=messages,
        strategy="full_replace",
        attempts=attempts,
    )

def build_turn_activity_summary(tool_events: list[dict[str, Any]]) -> str:
    if not tool_events:
        return ""
    lines: list[str] = []
    for ev in tool_events[-20:]:
        tool = ev.get("tool", "")
        label = ev.get("label", "")
        detail = ev.get("detail", "")
        if tool and label:
            line = f"- {tool}: {label}"
            if detail:
                line += f" ({detail})"
            lines.append(line)
    return "\n".join(lines)

# ============================================================================
