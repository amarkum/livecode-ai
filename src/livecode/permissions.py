"""LiveCode — permissions."""
from __future__ import annotations

from livecode._deps import load_prior
load_prior('livecode.permissions', globals())

import re
import threading
import time
import uuid
from typing import Any

_PERMISSIONS: dict[str, dict[str, Any]] = {}
_LOCK = threading.Lock()
_DEFAULT_TIMEOUT_S = 120

SENSITIVE_TOOLS = frozenset({"write_file", "edit_file", "run_command"})

_DESTRUCTIVE_COMMAND_PATTERNS = [
    re.compile(r"\bgit\s+reset\s+--hard\b"),
    re.compile(r"\bgit\s+clean\s+.*-[a-z]*f"),
    re.compile(r"\bgit\s+checkout\s+.*--\s+\S"),
    re.compile(r"\bgit\s+push\s+.*--force"),
    re.compile(r"\bgit\s+branch\s+.*-D\b"),
    re.compile(r"\brm\s+-[a-z]*r[a-z]*f[a-z]*\b|\brm\s+-[a-z]*f[a-z]*r[a-z]*\b"),
]

def is_destructive_command(command: str) -> bool:
    if not command:
        return False
    return any(p.search(command) for p in _DESTRUCTIVE_COMMAND_PATTERNS)

def create_permission_request(
    session_id: str,
    tool_name: str,
    tool_args: dict,
    *,
    timeout_s: int = _DEFAULT_TIMEOUT_S,
) -> str:
    request_id = f"perm_{uuid.uuid4().hex[:16]}"
    event = threading.Event()
    with _LOCK:
        _PERMISSIONS[request_id] = {
            "session_id": session_id,
            "tool_name": tool_name,
            "tool_args": tool_args,
            "event": event,
            "approved": None,
            "created_at": time.time(),
            "timeout_s": timeout_s,
        }
    return request_id

def resolve_permission(request_id: str, approved: bool) -> bool:
    with _LOCK:
        entry = _PERMISSIONS.get(request_id)
        if not entry:
            return False
        entry["approved"] = approved
        entry["event"].set()
        return True

def wait_for_permission(request_id: str) -> bool | None:
    with _LOCK:
        entry = _PERMISSIONS.get(request_id)
        if not entry:
            return None
        event = entry["event"]
        timeout_s = int(entry.get("timeout_s") or _DEFAULT_TIMEOUT_S)
    if not event.wait(timeout=timeout_s):
        with _LOCK:
            _PERMISSIONS.pop(request_id, None)
        return None
    with _LOCK:
        entry = _PERMISSIONS.pop(request_id, None)
    if not entry:
        return None
    return bool(entry.get("approved"))

def cleanup_stale_permissions(max_age_s: int = 300) -> None:
    cutoff = time.time() - max_age_s
    with _LOCK:
        stale = [rid for rid, e in _PERMISSIONS.items() if e.get("created_at", 0) < cutoff]
        for rid in stale:
            entry = _PERMISSIONS.pop(rid, None)
            if entry and entry.get("event"):
                entry["event"].set()

# ============================================================================
