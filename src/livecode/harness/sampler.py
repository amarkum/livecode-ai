"""Sampler-turn recovery — transient retry and length salvage."""
from __future__ import annotations

import time
from typing import Any, Callable

from livecode.harness.types import (
    OUTPUT_TOKEN_LIMIT_REMINDER,
    LengthSalvageAction,
    LengthSalvageStreak,
    TransientRetryState,
    transient_backoff_delay_s,
    transient_display_ceiling,
)


def transient_retry_eligible(error: BaseException | str, *, status_code: int | None = None) -> bool:
    msg = str(error or "").lower()
    if "context_length" in msg or "context length" in msg:
        return False
    if "invalid" in msg and "image" in msg:
        return False
    if status_code == 429:
        return False
    if status_code is not None and 400 <= status_code < 500 and status_code != 408:
        return False
    if any(k in msg for k in ("idle", "timeout", "connection", "temporarily", "503", "502", "504")):
        return True
    if status_code is not None and status_code >= 500:
        return True
    return False


def is_auth_tool_error(error: str | dict[str, Any]) -> bool:
    if isinstance(error, dict):
        status = error.get("status_code") or error.get("http_status")
        if status == 401:
            return True
        error = str(error.get("error") or error.get("message") or "")
    lower = str(error or "").lower()
    return any(
        token in lower
        for token in ("unauthorized", "invalid api key", "invalid_token", "authentication")
    )


def is_max_tokens_truncation(response: dict[str, Any] | None) -> bool:
    if not isinstance(response, dict):
        return False
    finish = str(response.get("finish_reason") or response.get("stop_reason") or "").lower()
    if finish in ("length", "max_tokens"):
        return True
    if response.get("truncated"):
        return True
    content = response.get("content") or ""
    tool_calls = response.get("tool_calls")
    if tool_calls and not content.strip():
        # Length-salvaged tool-call sample heuristic
        return bool(response.get("length_truncated"))
    return False


def handle_length_salvage(
    streak: LengthSalvageStreak,
    response: dict[str, Any],
) -> tuple[LengthSalvageAction, bool]:
    tool_calls = response.get("tool_calls")
    length_with_tool_calls = bool(tool_calls) and is_max_tokens_truncation(response)
    action, inject = streak.on_sample(length_with_tool_calls)
    return action, inject


def maybe_inject_output_limit_reminder(
    messages: list[dict[str, Any]],
    *,
    inject: bool,
) -> None:
    if not inject:
        return
    messages.append({"role": "user", "content": OUTPUT_TOKEN_LIMIT_REMINDER, "internal": True})


def run_with_transient_retry(
    call_fn: Callable[[], dict[str, Any]],
    state: TransientRetryState,
    *,
    on_retry: Callable[[int, int, BaseException], None] | None = None,
    sleep_fn: Callable[[float], None] = time.sleep,
) -> dict[str, Any]:
    while True:
        try:
            result = call_fn()
            state.on_success()
            return result
        except Exception as exc:
            if not state.budget_remaining() or not transient_retry_eligible(exc):
                raise
            state.on_failure()
            ceiling = transient_display_ceiling(state.step_attempts, state.prompt_attempts)
            if on_retry:
                on_retry(state.step_attempts, ceiling, exc)
            delay = transient_backoff_delay_s(state.step_attempts - 1)
            sleep_fn(delay)
