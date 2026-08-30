"""LiveCode — memory —   init  ."""
from __future__ import annotations

from livecode._deps import load_prior
load_prior('livecode.memory.__init__', globals())

MAX_MEMORY_CHARS = 2048

def load_project_memory(project_path: str) -> str:
    text = read_memory_md(project_path)
    if len(text) > MAX_MEMORY_CHARS:
        return text[-MAX_MEMORY_CHARS:]
    return text

def append_project_memory(project_path: str, note: str) -> str:
    combined = append_memory_md(project_path, note)

    path = memory_md_path(project_path, create=True)
    reindex_file(project_path, path, "workspace", "MEMORY.md")
    embed_missing_chunks(project_path)
    return combined[-MAX_MEMORY_CHARS:] if len(combined) > MAX_MEMORY_CHARS else combined

# ============================================================================
