"""LiveCode — subagent."""
from __future__ import annotations

from livecode._deps import load_prior
load_prior('livecode.subagent', globals())

import json
import uuid
from typing import Any, Callable

def run_subagent_turn(
    *,
    project_path: str,
    goal: str,
    parent_session_id: str,
    run_turn_fn: Callable[..., Any],
    read_only: bool = True,
    max_iterations: int = 5,
    **turn_kwargs: Any,
) -> dict[str, Any]:
    child_session = f"{parent_session_id}_sub_{uuid.uuid4().hex[:8]}"
    question = (
        f"[Subagent task — read_only={read_only}, max_iterations={max_iterations}]\n"
        f"{goal}\n\n"
        "Complete this focused task and call attempt_completion with your findings."
    )
    answer_parts: list[str] = []
    error = ""
    try:
        for chunk in run_turn_fn(
            project_path,
            question,
            session_id=child_session,
            max_iterations=max_iterations,
            **turn_kwargs,
        ):
            if isinstance(chunk, str) and chunk.startswith("data: "):
                try:
                    payload = json.loads(chunk[6:].strip())
                    if payload.get("token"):
                        answer_parts.append(payload["token"])
                    if payload.get("answer"):
                        answer_parts.append(payload["answer"])
                    if payload.get("error"):
                        error = str(payload["error"])
                except json.JSONDecodeError:
                    continue
    except Exception as exc:
        error = str(exc)

    result = "".join(answer_parts).strip()
    return {
        "success": not error,
        "goal": goal,
        "read_only": read_only,
        "child_session_id": child_session,
        "result": result or error or "Subagent completed with no output",
        "error": error or None,
    }

# ============================================================================
