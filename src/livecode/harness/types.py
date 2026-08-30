"""Harness turn types for the agent loop."""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum


MAX_OUTPUT_TOKEN_LIMIT_RETRIES = 5
MAX_TRANSIENT_TURN_RETRIES = 3
MAX_TRANSIENT_RETRIES_PER_PROMPT = 10
MAX_TRANSIENT_RETRY_WINDOW_S = 10 * 60

TRANSIENT_TURN_RETRY_BACKOFF_S = (2, 10, 30)

OUTPUT_TOKEN_LIMIT_REMINDER = (
    "Your response was cut off because it exceeded the output token limit. "
    "Please break your work into smaller pieces. Continue from where you left off."
)


@dataclass
class TransientRetryState:
    step_attempts: int = 0
    prompt_attempts: int = 0
    episode_start: float | None = None
    enabled: bool = True

    def budget_remaining(self) -> bool:
        if not self.enabled:
            return False
        if self.step_attempts >= MAX_TRANSIENT_TURN_RETRIES:
            return False
        if self.prompt_attempts >= MAX_TRANSIENT_RETRIES_PER_PROMPT:
            return False
        if self.episode_start is not None:
            if time.monotonic() - self.episode_start >= MAX_TRANSIENT_RETRY_WINDOW_S:
                return False
        return True

    def on_failure(self) -> None:
        self.step_attempts += 1
        self.prompt_attempts += 1
        if self.episode_start is None:
            self.episode_start = time.monotonic()

    def on_success(self) -> None:
        self.step_attempts = 0
        self.episode_start = None


def transient_display_ceiling(step_attempts: int, prompt_attempts: int) -> int:
    step_remaining = MAX_TRANSIENT_TURN_RETRIES - step_attempts
    prompt_remaining = MAX_TRANSIENT_RETRIES_PER_PROMPT - prompt_attempts
    return step_attempts + max(0, min(step_remaining, prompt_remaining))


def transient_backoff_delay_s(attempts_used: int) -> float:
    idx = min(attempts_used, len(TRANSIENT_TURN_RETRY_BACKOFF_S) - 1)
    return float(TRANSIENT_TURN_RETRY_BACKOFF_S[idx])


class LengthSalvageAction(str, Enum):
    NOT_SALVAGE = "not_salvage"
    PROCEED = "proceed"
    EXHAUSTED = "exhausted"


@dataclass
class LengthSalvageStreak:
    consecutive: int = 0

    def on_sample(self, length_with_tool_calls: bool) -> tuple[LengthSalvageAction, bool]:
        """Return (action, inject_reminder)."""
        if not length_with_tool_calls:
            self.consecutive = 0
            return LengthSalvageAction.NOT_SALVAGE, False
        self.consecutive += 1
        if self.consecutive > MAX_OUTPUT_TOKEN_LIMIT_RETRIES:
            return LengthSalvageAction.EXHAUSTED, False
        return LengthSalvageAction.PROCEED, self.consecutive == 1


@dataclass
class TodoGateConfig:
    enabled: bool = False
    max_fires_per_prompt: int = 2


@dataclass
class TodoGateInput:
    pending: list[str] = field(default_factory=list)
    in_progress_unbacked: list[str] = field(default_factory=list)
    in_progress_backed: list[str] = field(default_factory=list)
    backing_task_count: int = 0


class TodoGateDecision(str, Enum):
    CONTINUE = "continue"
    NUDGE = "nudge"


@dataclass
class TodoGateResult:
    decision: TodoGateDecision
    reminder: str = ""
