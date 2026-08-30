"""Load prior modules into a namespace, including private names."""
from __future__ import annotations

import importlib
from typing import Any

MODULE_ORDER = [
    "livecode.project_store",
    "livecode.model_pricing",
    "livecode.prompts",
    "livecode.rules",
    "livecode.search_replace",
    "livecode.permissions",
    "livecode.web_tools",
    "livecode.subagent",
    "livecode.memory.chunker",
    "livecode.memory.embed",
    "livecode.workspace",
    "livecode.plan_store",
    "livecode.session",
    "livecode.codebase_index",
    "livecode.context_attachments",
    "livecode.activity_log",
    "livecode.routing",
    "livecode.interjection",
    "livecode.intelligent_classifier",
    "livecode.reminders",
    "livecode.memory.storage",
    "livecode.memory.index",
    "livecode.memory.autosave",
    "livecode.memory.flush",
    "livecode.memory.inject",
    "livecode.memory.__init__",
    "livecode.compaction.full_replace",
    "livecode.compaction.intra",
    "livecode.compaction.inter",
    "livecode.context",
    "livecode.tools",
    "livecode.llm_providers",
    "livecode.harness.types",
    "livecode.harness.interjection_format",
    "livecode.harness.sampler",
    "livecode.harness.turn_end",
    "livecode.harness.turn",
    "livecode.server",
]


def load_prior(module_name: str, target: dict[str, Any]) -> None:
    """Import all modules before ``module_name`` into ``target``."""
    try:
        idx = MODULE_ORDER.index(module_name)
    except ValueError:
        return
    for name in MODULE_ORDER[:idx]:
        mod = importlib.import_module(name)
        for key, value in vars(mod).items():
            if key.startswith("__"):
                continue
            target.setdefault(key, value)
