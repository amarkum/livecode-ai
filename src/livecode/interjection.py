"""LiveCode — interjection."""
from __future__ import annotations

from livecode._deps import load_prior
load_prior('livecode.interjection', globals())

import threading
from collections import defaultdict

_interjection_lock = threading.Lock()
_queues: dict[str, list[str]] = defaultdict(list)
_interrupt_flags: dict[str, bool] = defaultdict(bool)

def _key(session_id: str) -> str:
    return (session_id or "").strip()

def enqueue_interjection(session_id: str, message: str, *, interrupt: bool = False) -> None:
    text = (message or "").strip()
    if not text or not session_id:
        return
    with _interjection_lock:
        key = _key(session_id)
        _queues[key].append(text)
        if interrupt:
            _interrupt_flags[key] = True

def drain_interjections(session_id: str) -> list[tuple[str, bool]]:
    """Return (message, is_interrupt) pairs."""
    with _interjection_lock:
        key = _key(session_id)
        items = list(_queues.get(key) or [])
        _queues[key] = []
        interrupt = _interrupt_flags.pop(key, False)
        if not items:
            return []
        if interrupt and len(items) == 1:
            return [(items[0], True)]
        return [(msg, False) for msg in items]

def has_pending_interjection(session_id: str) -> bool:
    with _interjection_lock:
        return bool(_queues.get(_key(session_id)))

# ============================================================================
