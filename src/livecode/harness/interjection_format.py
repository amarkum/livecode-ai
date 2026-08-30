"""Interjection framing for mid-turn user messages."""
from __future__ import annotations

LARGE_PROMPT_THRESHOLD = 25_000

INTERJECTION_NOTE = "The user sent a message while you were working:"
INTERRUPT_NOTE = "The user interrupted the previous turn:"
UNFINISHED_TASKS_REMINDER = "Make sure to complete any unfinished tasks from previous turns."


def user_query(user_message: str) -> str:
    return f"<user_query>\n{user_message}\n</user_query>"


def frame_user_turn(note: str, assembled: str) -> str:
    return f"{note}\n{assembled}\n{UNFINISHED_TASKS_REMINDER}"


def _truncate_text(text: str) -> str:
    if len(text) <= LARGE_PROMPT_THRESHOLD:
        return text
    truncated = text[:LARGE_PROMPT_THRESHOLD]
    while truncated and len(truncated.encode("utf-8")) > LARGE_PROMPT_THRESHOLD:
        truncated = truncated[:-1]
    return f"{truncated}... [truncated]"


def format_interjection(text: str) -> str:
    return frame_user_turn(INTERJECTION_NOTE, user_query(_truncate_text(text)))


def format_interrupt(text: str) -> str:
    return frame_user_turn(INTERRUPT_NOTE, user_query(_truncate_text(text)))
