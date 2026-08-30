"""LiveCode — compaction — intra."""
from __future__ import annotations

from livecode._deps import load_prior
load_prior('livecode.compaction.intra', globals())

import json
from typing import Any


def estimate_messages_tokens(messages: list[dict[str, Any]]) -> int:
    parts: list[str] = []
    for msg in messages:
        content = msg.get("content")
        if isinstance(content, str):
            parts.append(content)
        elif isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and block.get("text"):
                    parts.append(str(block["text"]))
        tool_calls = msg.get("tool_calls")
        if tool_calls:
            parts.append(json.dumps(tool_calls, default=str))
    return sum(len(p) for p in parts) // 4

def compact_tool_payload(raw: str, *, tier: str = "fitted") -> str:
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        if tier == "lossy":
            return raw[:200] + "...[compacted]" if len(raw) > 200 else raw
        if len(raw) > 500:
            return raw[:500] + "...[compacted]"
        return raw

    if not isinstance(parsed, dict):
        limit = 200 if tier == "lossy" else 500
        return raw[:limit] + "...[compacted]" if len(raw) > limit else raw

    if parsed.get("error"):
        err_len = 120 if tier == "lossy" else 300
        return json.dumps({"_compacted": True, "error": str(parsed["error"])[:err_len]}, default=str)

    if tier == "lossy":
        if "match_count" in parsed:
            return json.dumps({"_compacted": True, "match_count": parsed.get("match_count")}, default=str)
        if parsed.get("file_path"):
            return json.dumps({
                "_compacted": True,
                "file_path": parsed.get("file_path"),
                "action": parsed.get("action"),
            }, default=str)
        return json.dumps({"_compacted": True}, default=str)

    if "match_count" in parsed and "matches" in parsed:
        return json.dumps({
            "_compacted": True,
            "match_count": parsed.get("match_count"),
            "pattern": (parsed.get("pattern") or parsed.get("query") or "")[:80],
        }, default=str)

    if parsed.get("files") and isinstance(parsed.get("files"), list):
        return json.dumps({
            "_compacted": True,
            "file_count": parsed.get("file_count", parsed.get("match_count", len(parsed.get("files") or []))),
            "query": (parsed.get("query") or parsed.get("pattern") or "")[:80],
        }, default=str)

    if parsed.get("results") and isinstance(parsed.get("results"), list):
        return json.dumps({
            "_compacted": True,
            "result_count": parsed.get("result_count", len(parsed.get("results") or [])),
            "query": (parsed.get("query") or "")[:80],
        }, default=str)

    if parsed.get("final_url") or (parsed.get("url") and parsed.get("content") is not None):
        return json.dumps({
            "_compacted": True,
            "url": (parsed.get("final_url") or parsed.get("url") or "")[:120],
            "summary": f"fetched {len(str(parsed.get('content') or ''))} chars",
        }, default=str)

    if "entries" in parsed:
        return json.dumps({
            "_compacted": True,
            "entry_count": len(parsed.get("entries") or []),
        }, default=str)

    if parsed.get("file_path") or parsed.get("content"):
        fp = parsed.get("file_path", "")
        content = parsed.get("content", "")
        preview_len = 80 if tier == "lossy" else 200
        preview = str(content)[:preview_len] if content else ""
        return json.dumps({
            "_compacted": True,
            "file_path": fp,
            "summary": f"read {len(str(content))} chars" if content else "read file",
            "preview": preview,
        }, default=str)

    if "command" in parsed or "exit_code" in parsed:
        output = str(parsed.get("output") or "")
        out_len = 100 if tier == "lossy" else 300
        return json.dumps({
            "_compacted": True,
            "command": (parsed.get("command") or "")[:120],
            "exit_code": parsed.get("exit_code"),
            "output_preview": output[:out_len],
        }, default=str)

    if parsed.get("success") is not None or parsed.get("completed"):
        return json.dumps({
            "_compacted": True,
            "success": parsed.get("success"),
            "file_path": parsed.get("file_path"),
            "action": parsed.get("action"),
        }, default=str)

    slim = {k: parsed[k] for k in list(parsed.keys())[:6]}
    slim["_compacted"] = True
    limit = 300 if tier == "lossy" else 800
    return json.dumps(slim, default=str)[:limit]

def dedupe_stale_file_reads(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = list(messages)
    latest_by_path: dict[str, int] = {}

    for i, msg in enumerate(out):
        if msg.get("role") != "tool":
            continue
        raw = msg.get("content") or ""
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            continue
        fp = parsed.get("file_path")
        if fp and ("content" in parsed or parsed.get("action") == "read_repo_file"):
            latest_by_path[str(fp)] = i

    for i, msg in enumerate(out):
        if msg.get("role") != "tool" or i in latest_by_path.values():
            continue
        raw = msg.get("content") or ""
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            continue
        fp = parsed.get("file_path")
        if fp and fp in latest_by_path and latest_by_path[fp] != i:
            out[i] = {**msg, "content": compact_tool_payload(raw, tier="fitted")}

    return out

def dedupe_stale_grep_results(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = list(messages)
    latest_by_key: dict[str, int] = {}

    for i, msg in enumerate(out):
        if msg.get("role") != "tool":
            continue
        raw = msg.get("content") or ""
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if "match_count" not in parsed and "matches" not in parsed:
            continue
        key = f"{parsed.get('pattern', '')}|{parsed.get('glob_filter', '')}"
        if key.strip("|"):
            latest_by_key[key] = i

    for i, msg in enumerate(out):
        if msg.get("role") != "tool" or i in latest_by_key.values():
            continue
        raw = msg.get("content") or ""
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            continue
        key = f"{parsed.get('pattern', '')}|{parsed.get('glob_filter', '')}"
        if key.strip("|") and key in latest_by_key and latest_by_key[key] != i:
            out[i] = {**msg, "content": compact_tool_payload(raw, tier="fitted")}

    return out

def _apply_fitted_ladder(
    messages: list[dict[str, Any]],
    budget: int,
    keep_recent_tool_messages: int,
) -> list[dict[str, Any]]:
    out = list(messages)
    tool_indices = [i for i, msg in enumerate(out) if msg.get("role") == "tool"]
    if len(tool_indices) <= keep_recent_tool_messages:
        return out

    stale = tool_indices[:-keep_recent_tool_messages]
    for tier in ("fitted", "lossy"):
        for idx in stale:
            raw = out[idx].get("content") or ""
            out[idx] = {**out[idx], "content": compact_tool_payload(raw, tier=tier)}
        if estimate_messages_tokens(out) <= budget:
            return out
    return out

def compact_stale_tool_messages(
    messages: list[dict[str, Any]],
    *,
    max_input_tokens: int | None = None,
    keep_recent_tool_messages: int = LIVECODE_KEEP_RECENT_TOOL_MSGS,
) -> list[dict[str, Any]]:
    budget = max_input_tokens or int(LIVECODE_CONTEXT_WINDOW * LIVECODE_IN_TURN_COMPACT_RATIO)
    out = dedupe_stale_grep_results(dedupe_stale_file_reads(messages))
    if estimate_messages_tokens(out) <= budget:
        return out

    tool_indices = [i for i, msg in enumerate(out) if msg.get("role") == "tool"]
    if len(tool_indices) <= keep_recent_tool_messages:
        return _apply_fitted_ladder(out, budget, keep_recent_tool_messages)

    stale_indices = tool_indices[:-keep_recent_tool_messages]
    for idx in stale_indices:
        raw = out[idx].get("content") or ""
        out[idx] = {**out[idx], "content": compact_tool_payload(raw, tier="fitted")}

    if estimate_messages_tokens(out) > budget:
        out = _apply_fitted_ladder(out, budget, keep_recent_tool_messages)
    return out

# ============================================================================
