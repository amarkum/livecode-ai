"""LiveCode — reminders."""
from __future__ import annotations

from livecode._deps import load_prior
load_prior('livecode.reminders', globals())

import json
import os
import time
from typing import Any


def _reminders_key() -> str:
    return "session_reminders"

def load_session_reminders(project_path: str, session_id: str) -> dict[str, Any]:
    path = _summary_path(project_path, session_id)
    if not os.path.isfile(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            meta = json.load(f)
        return dict(meta.get(_reminders_key()) or {})
    except (json.JSONDecodeError, OSError):
        return {}

def save_session_reminders(project_path: str, session_id: str, reminders: dict[str, Any]) -> None:
    path = _summary_path(project_path, session_id)
    meta: dict[str, Any] = {}
    if os.path.isfile(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                meta = json.load(f)
        except (json.JSONDecodeError, OSError):
            meta = {}
    meta[_reminders_key()] = reminders
    meta["reminders_updated_at"] = time.time()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)

def record_file_edited(project_path: str, session_id: str, file_path: str) -> None:
    rem = load_session_reminders(project_path, session_id)
    edited = list(rem.get("files_edited") or [])
    if file_path and file_path not in edited:
        edited.append(file_path)
    rem["files_edited"] = edited[-20:]
    save_session_reminders(project_path, session_id, rem)

def record_session_plan_file(project_path: str, session_id: str, plan_file: str) -> None:
    if not plan_file:
        return
    rem = load_session_reminders(project_path, session_id)
    rem["active_plan_file"] = str(plan_file).replace("\\", "/").lstrip("/")
    save_session_reminders(project_path, session_id, rem)

def get_session_plan_file(project_path: str, session_id: str) -> str:
    rem = load_session_reminders(project_path, session_id)
    return str(rem.get("active_plan_file") or "").replace("\\", "/").lstrip("/")

def record_edit_snapshot(
    project_path: str,
    session_id: str,
    file_path: str,
    pre_content: str,
    post_content: str,
    *,
    turn_id: str = "",
) -> None:
    if not file_path or not session_id:
        return
    if len(pre_content.encode("utf-8", errors="replace")) > EDIT_SNAPSHOT_MAX_BYTES:
        pre_store = None
    else:
        pre_store = pre_content
    if len(post_content.encode("utf-8", errors="replace")) > EDIT_SNAPSHOT_MAX_BYTES:
        post_store = None
    else:
        post_store = post_content
    rem = load_session_reminders(project_path, session_id)
    snapshots = list(rem.get("edit_snapshots") or [])
    snapshots.append({
        "path": str(file_path).replace("\\", "/").lstrip("/"),
        "pre_content": pre_store,
        "post_content": post_store,
        "turn_id": turn_id,
        "ts": time.time(),
    })
    rem["edit_snapshots"] = snapshots[-50:]
    save_session_reminders(project_path, session_id, rem)

def list_edit_snapshots(project_path: str, session_id: str) -> list[dict[str, Any]]:
    rem = load_session_reminders(project_path, session_id)
    out: list[dict[str, Any]] = []
    for snap in rem.get("edit_snapshots") or []:
        if not isinstance(snap, dict):
            continue
        out.append({
            "path": snap.get("path"),
            "turn_id": snap.get("turn_id"),
            "ts": snap.get("ts"),
            "rewindable": bool(snap.get("pre_content")),
        })
    return out

def rewind_file_from_snapshot(project_path: str, session_id: str, file_path: str) -> dict[str, Any]:
    safe = str(file_path or "").replace("\\", "/").lstrip("/")
    rem = load_session_reminders(project_path, session_id)
    snapshots = list(rem.get("edit_snapshots") or [])
    for snap in reversed(snapshots):
        if not isinstance(snap, dict):
            continue
        if str(snap.get("path") or "") != safe:
            continue
        pre = snap.get("pre_content")
        if pre is None:
            return {"error": "Snapshot too large to rewind"}
        full, err = resolve_safe_path(project_path, safe)
        if full is None:
            return {"error": err}
        try:
            _write_file_with_retry(full, str(pre))
        except OSError as exc:
            return {"error": str(exc)}
        return {"success": True, "file_path": safe, "rewound": True}
    return {"error": f"No rewind snapshot for {safe}"}

def record_compaction_ran(project_path: str, session_id: str) -> None:
    rem = load_session_reminders(project_path, session_id)
    rem["compaction_ran"] = True
    rem["compaction_at"] = time.time()
    save_session_reminders(project_path, session_id, rem)

def clear_compaction_reminder(project_path: str, session_id: str) -> None:
    rem = load_session_reminders(project_path, session_id)
    rem.pop("compaction_ran", None)
    save_session_reminders(project_path, session_id, rem)

def build_reminder_text(project_path: str, session_id: str) -> str:
    rem = load_session_reminders(project_path, session_id)
    lines: list[str] = []
    edited = rem.get("files_edited") or []
    if edited:
        lines.append(f"Files edited this session: {', '.join(edited[-8:])}")
    if rem.get("compaction_ran"):
        lines.append("Conversation was compacted — rely on the summary prefix for older context.")
    if rem.get("pending_permission"):
        lines.append("A tool permission may be pending user approval.")
    return "\n".join(lines)

# ============================================================================
