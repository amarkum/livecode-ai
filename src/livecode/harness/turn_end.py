"""Turn-end concerns — TodoGate and plan cleanup."""
from __future__ import annotations

from livecode.harness.types import (
    TodoGateConfig,
    TodoGateDecision,
    TodoGateInput,
    TodoGateResult,
)


def build_todo_gate_reminder(pending: list[str], unbacked_in_progress: list[str]) -> str:
    buf = "You have outstanding todos but ended your turn without a tool call.\n\n"
    if unbacked_in_progress:
        buf += "In-progress (no backing background task):\n"
        for item in unbacked_in_progress:
            buf += f"- {item}\n"
        buf += "\n"
    if pending:
        buf += "Pending:\n"
        for item in pending:
            buf += f"- {item}\n"
        buf += "\n"
    buf += (
        "Per <task_completion_discipline>, advance the next pending todo "
        "with the appropriate tool call NOW. If you have a genuine external "
        "blocker (missing credential, denied permission, network unreachable), "
        "state it explicitly AND mark the affected todos `cancelled` via "
        "create_plan with a reason in the same turn."
    )
    return buf


def evaluate_todo_gate(input_: TodoGateInput) -> TodoGateResult:
    if not input_.pending and not input_.in_progress_unbacked:
        return TodoGateResult(decision=TodoGateDecision.CONTINUE)
    return TodoGateResult(
        decision=TodoGateDecision.NUDGE,
        reminder=build_todo_gate_reminder(input_.pending, input_.in_progress_unbacked),
    )


def todo_gate_active(config: TodoGateConfig, *, goal_loop_active: bool = False) -> bool:
    if not config.enabled:
        return False
    if goal_loop_active:
        return False
    return True


def collect_todo_gate_input_from_session(
    session_todos: list[tuple[str, str, str]] | None,
    *,
    backing_task_count: int = 0,
) -> TodoGateInput:
    """Build gate input from (id, content, status) tuples."""
    pending: list[str] = []
    in_progress: list[str] = []
    for _id, content, status in session_todos or []:
        status_l = (status or "").lower()
        if status_l == "pending":
            pending.append(content)
        elif status_l in ("in_progress", "in progress"):
            in_progress.append(content)
    backed_count = min(len(in_progress), backing_task_count)
    return TodoGateInput(
        pending=pending,
        in_progress_backed=in_progress[:backed_count],
        in_progress_unbacked=in_progress[backed_count:],
        backing_task_count=backing_task_count,
    )


def emit_turn_end_plan_cleanup(todos: list[dict[str, str]]) -> list[dict[str, str]]:
    """Cosmetic cleanup: show in_progress as completed for UI spinners."""
    if not todos:
        return []
    stale = [t for t in todos if (t.get("status") or "").lower() in ("in_progress", "in progress")]
    if not stale:
        return []
    entries = []
    for item in todos:
        entry = dict(item)
        if (entry.get("status") or "").lower() in ("in_progress", "in progress"):
            entry = {**entry, "status": "completed", "_display_only": True}
        entries.append(entry)
    return entries
