"""LiveCode — llm providers."""
from __future__ import annotations

from livecode._deps import load_prior
load_prior('livecode.llm_providers', globals())

import fnmatch
import json
import os
import re
from pathlib import Path

import requests

DEFAULT_SETTINGS = {
    "provider": "auto",
    "openai_api_key": "",
    "openai_model": "",
    "gemini_api_key": "",
    "gemini_model": "",
}

OPENAI_FAST_MODEL = "gpt-4o-mini"
OPENAI_STRONG_MODEL = "gpt-4o"
# Agentic coding tiers (newest first; _gemini_models_to_try falls back on API errors).
GEMINI_FAST_MODEL = "gemini-3.7-flash"
GEMINI_FAST_FALLBACK = "gemini-3.6-flash"
GEMINI_STRONG_MODEL = "gemini-3.1-pro-preview"
GEMINI_LITE_MODEL = "gemini-3.1-flash-lite"

TOOL_DEFS = [
    {
        "name": "list_dir",
        "description": "List files and folders in a directory of the project.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Directory path relative to the project root. Use \"\" for the root."},
            },
            "required": ["path"],
        },
    },
    {
        "name": "read_file",
        "description": "Read a text file from the project, optionally a line range.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "File path relative to the project root."},
                "start_line": {"type": "integer"},
                "end_line": {"type": "integer"},
            },
            "required": ["path"],
        },
    },
    {
        "name": "grep",
        "description": "Search for a regex pattern across text files in the project.",
        "parameters": {
            "type": "object",
            "properties": {
                "pattern": {"type": "string"},
                "glob": {"type": "string", "description": "Optional filename glob filter, e.g. \"*.py\"."},
            },
            "required": ["pattern"],
        },
    },
]

_SKIP_DIRS = {".git", "__pycache__", "node_modules", ".venv", "venv", ".DS_Store"}


def load_settings() -> dict:
    ensure_livecode_home_migrated()
    try:
        with open(SETTINGS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        data = {}
    merged = dict(DEFAULT_SETTINGS)
    merged.update({k: v for k, v in data.items() if k in DEFAULT_SETTINGS})
    return merged


def save_settings(update: dict) -> dict:
    ensure_livecode_home_migrated()
    current = load_settings()
    secret_keys = {"openai_api_key", "gemini_api_key"}
    for key in DEFAULT_SETTINGS:
        if key not in update:
            continue
        val = update[key]
        if val is None:
            continue
        if isinstance(val, str):
            val = val.strip()
        if key in secret_keys:
            if not val:
                continue
            current[key] = val
            continue
        if key == "provider":
            current[key] = val or "auto"
            continue
        if key.endswith("_model"):
            current[key] = val
            continue
        if val:
            current[key] = val
    os.makedirs(os.path.dirname(SETTINGS_PATH), exist_ok=True)
    with open(SETTINGS_PATH, "w", encoding="utf-8") as f:
        json.dump(current, f, indent=2)
    try:
        os.chmod(SETTINGS_PATH, 0o600)
    except OSError:
        pass
    return current


def mask_key(key: str) -> str:
    key = key or ""
    if len(key) <= 6:
        return "*" * len(key)
    return key[:3] + "..." + key[-4:]


def _validate_openai_api_key(api_key: str) -> str | None:
    try:
        resp = requests.get(
            "https://api.openai.com/v1/models",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=15,
        )
        if resp.status_code == 200:
            return None
        try:
            payload = resp.json()
            return payload.get("error", {}).get("message") or resp.text[:200]
        except Exception:
            return resp.text[:200] or f"OpenAI API returned HTTP {resp.status_code}"
    except requests.RequestException as exc:
        return str(exc)


def _validate_gemini_api_key(api_key: str) -> str | None:
    try:
        resp = requests.get(
            "https://generativelanguage.googleapis.com/v1beta/models",
            params={"key": api_key},
            timeout=15,
        )
        if resp.status_code == 200:
            return None
        try:
            payload = resp.json()
            return payload.get("error", {}).get("message") or resp.text[:200]
        except Exception:
            return resp.text[:200] or f"Gemini API returned HTTP {resp.status_code}"
    except requests.RequestException as exc:
        return str(exc)


def _validate_settings_update(update: dict, current: dict | None = None) -> str | None:
    current = current or load_settings()
    openai_key = (update.get("openai_api_key") or "").strip()
    gemini_key = (update.get("gemini_api_key") or "").strip()
    if openai_key:
        err = _validate_openai_api_key(openai_key)
        if err:
            return f"OpenAI key invalid: {err}"
    if gemini_key:
        err = _validate_gemini_api_key(gemini_key)
        if err:
            return f"Gemini key invalid: {err}"
    return None


def _configured_llm_providers(settings: dict) -> list[str]:
    providers: list[str] = []
    if settings.get("openai_api_key"):
        providers.append("openai")
    if settings.get("gemini_api_key"):
        providers.append("gemini")
    return providers


def _question_is_complex(question: str) -> bool:
    return len(question) > 220 or question.count("\n") > 3


def model_options_for_settings(settings: dict) -> list[dict[str, str]]:
    options: list[dict[str, str]] = [{"value": "auto", "label": "Auto"}]
    seen = {"auto"}

    def _add(value: str, label: str) -> None:
        key = (value or "").strip()
        if not key or key in seen:
            return
        seen.add(key)
        options.append({"value": key, "label": label or key})

    if settings.get("openai_api_key"):
        _add(OPENAI_FAST_MODEL, "GPT-4o Mini")
        _add(OPENAI_STRONG_MODEL, "GPT-4o")
        custom = (settings.get("openai_model") or "").strip()
        if custom:
            _add(custom, custom)

    if settings.get("gemini_api_key"):
        _add(GEMINI_FAST_MODEL, "Gemini 3.7 Flash")
        _add(GEMINI_FAST_FALLBACK, "Gemini 3.6 Flash")
        _add(GEMINI_STRONG_MODEL, "Gemini 3.1 Pro")
        _add(GEMINI_LITE_MODEL, "Gemini 3.1 Flash Lite")
        custom = (settings.get("gemini_model") or "").strip()
        if custom:
            _add(custom, custom)

    return options


def settings_for_display(settings: dict, *, validate_keys: bool = False) -> dict:
    display = {
        "provider": settings.get("provider") or "auto",
        "openai_api_key_set": bool(settings.get("openai_api_key")),
        "openai_api_key": settings.get("openai_api_key") or "",
        "openai_api_key_masked": mask_key(settings.get("openai_api_key", "")),
        "openai_model": settings.get("openai_model") or "",
        "gemini_api_key_set": bool(settings.get("gemini_api_key")),
        "gemini_api_key": settings.get("gemini_api_key") or "",
        "gemini_api_key_masked": mask_key(settings.get("gemini_api_key", "")),
        "gemini_model": settings.get("gemini_model") or "",
        "model_options": model_options_for_settings(settings),
        "configured_providers": _configured_llm_providers(settings),
    }
    if validate_keys and settings.get("openai_api_key"):
        openai_err = _validate_openai_api_key(settings["openai_api_key"])
        if openai_err:
            display["openai_api_key_error"] = openai_err
    if validate_keys and settings.get("gemini_api_key"):
        gemini_err = _validate_gemini_api_key(settings["gemini_api_key"])
        if gemini_err:
            display["gemini_api_key_error"] = gemini_err
    return display


def _resolve_provider(settings: dict) -> str:
    provider = settings.get("provider") or "auto"
    if provider == "auto":
        configured = _configured_llm_providers(settings)
        return configured[0] if configured else ""
    if provider in {"openai", "gemini"} and not settings.get(f"{provider}_api_key"):
        configured = _configured_llm_providers(settings)
        return configured[0] if configured else ""
    return provider


def _resolve_model(provider: str, settings: dict, question: str) -> str:
    complex_q = _question_is_complex(question)
    if provider == "openai":
        return settings.get("openai_model") or (OPENAI_STRONG_MODEL if complex_q else OPENAI_FAST_MODEL)
    if provider == "gemini":
        return settings.get("gemini_model") or (GEMINI_STRONG_MODEL if complex_q else GEMINI_FAST_MODEL)
    return ""


def _resolve_auto_provider_and_model(settings: dict, question: str) -> tuple[str, str]:
    configured = _configured_llm_providers(settings)
    if not configured:
        return "", ""
    if len(configured) == 1:
        provider = configured[0]
        return provider, _resolve_model(provider, settings, question)

    # Prefer Gemini for agentic coding: Pro on complex prompts, Flash otherwise.
    if "gemini" in configured:
        return "gemini", _resolve_model("gemini", settings, question)
    provider = configured[0]
    return provider, _resolve_model(provider, settings, question)


def _infer_provider_for_model(settings: dict, model: str) -> str:
    model_key = (model or "").strip().lower()
    if not model_key:
        return ""
    if model_key.startswith("gemini") or "gemini" in model_key:
        return "gemini" if settings.get("gemini_api_key") else ""
    if model_key.startswith("gpt") or model_key.startswith("o1") or model_key.startswith("o3") or model_key.startswith("o4"):
        return "openai" if settings.get("openai_api_key") else ""
    if settings.get("openai_api_key"):
        return "openai"
    if settings.get("gemini_api_key"):
        return "gemini"
    return ""


def _resolve_provider_and_model(settings: dict, question: str, user_model: str = "auto") -> tuple[str, str]:
    selected = (user_model or "auto").strip()
    if not selected or selected.lower() == "auto":
        return _resolve_auto_provider_and_model(settings, question)

    provider = _infer_provider_for_model(settings, selected)
    if not provider:
        return "", ""
    allowed = {opt["value"] for opt in model_options_for_settings(settings)}
    if selected not in allowed:
        return _resolve_auto_provider_and_model(settings, question)
    return provider, selected


def _safe_path(project_path: str, rel_path: str) -> str:
    base = os.path.abspath(project_path)
    target = os.path.abspath(os.path.join(base, rel_path or ""))
    if target != base and not target.startswith(base + os.sep):
        raise ValueError("path escapes project root")
    return target


def _tool_list_dir(project_path: str, path: str = "") -> dict:
    target = _safe_path(project_path, path)
    if not os.path.isdir(target):
        return {"error": f"not a directory: {path}"}
    entries = []
    for name in sorted(os.listdir(target)):
        if name in _SKIP_DIRS or name.startswith("."):
            continue
        full = os.path.join(target, name)
        entries.append({"name": name, "type": "folder" if os.path.isdir(full) else "file"})
    return {"entries": entries}


def _tool_read_file(project_path: str, path: str, start_line: int | None = None, end_line: int | None = None) -> dict:
    target = _safe_path(project_path, path)
    if not os.path.isfile(target):
        return {"error": f"not a file: {path}"}
    try:
        with open(target, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
    except OSError as e:
        return {"error": str(e)}
    start = max((start_line or 1) - 1, 0)
    end = min(end_line or len(lines), len(lines))
    content = "".join(lines[start:end])
    if len(content) > 20000:
        content = content[:20000] + "\n...(truncated)"
    return {"content": content, "total_lines": len(lines)}


def _tool_grep(project_path: str, pattern: str, glob: str | None = None) -> dict:
    try:
        regex = re.compile(pattern)
    except re.error as e:
        return {"error": f"invalid pattern: {e}"}
    matches = []
    base = os.path.abspath(project_path)
    for root, dirs, files in os.walk(base):
        dirs[:] = [d for d in dirs if d not in _SKIP_DIRS and not d.startswith(".")]
        for name in files:
            if glob and not fnmatch.fnmatch(name, glob):
                continue
            full = os.path.join(root, name)
            try:
                with open(full, "r", encoding="utf-8", errors="ignore") as f:
                    for i, line in enumerate(f, 1):
                        if regex.search(line):
                            rel = os.path.relpath(full, base)
                            matches.append({"path": rel, "line": i, "text": line.strip()[:200]})
                            if len(matches) >= 60:
                                return {"matches": matches, "truncated": True}
            except OSError:
                continue
    return {"matches": matches}


def _run_tool(project_path: str, name: str, args: dict) -> dict:
    try:
        if name == "list_dir":
            return _tool_list_dir(project_path, args.get("path", ""))
        if name == "read_file":
            return _tool_read_file(project_path, args.get("path", ""), args.get("start_line"), args.get("end_line"))
        if name == "grep":
            return _tool_grep(project_path, args.get("pattern", ""), args.get("glob"))
        return {"error": f"unknown tool: {name}"}
    except ValueError as e:
        return {"error": str(e)}


_SYSTEM_PROMPT = (
    "You are LiveCode, a coding assistant for the open project folder. "
    "Always explore the codebase with list_dir, read_file, and grep before answering. "
    "Never ask the user to describe the project or its files — inspect them yourself. "
    "Give a direct, helpful answer and cite file paths you read. "
    "You cannot edit files or run shell commands."
)


def _bootstrap_project_context(project_path: str) -> str:
    chunks: list[str] = []
    listing = _tool_list_dir(project_path, "")
    entries = listing.get("entries") or []
    if entries:
        summary = ", ".join(
            f"{item['name']}/" if item.get("type") == "folder" else item["name"]
            for item in entries[:50]
        )
        chunks.append(f"Root listing ({len(entries)} items): {summary}")
    for candidate in ("README.md", "readme.md", "README", "package.json", "pyproject.toml", "main.py", "index.html"):
        result = _tool_read_file(project_path, candidate, 1, 80)
        if result.get("content"):
            chunks.append(f"--- {candidate} ---\n{result['content'][:3000]}")
            if candidate.lower().startswith("readme"):
                break
    return "\n\n".join(chunks) if chunks else "No README or root listing available."


def _project_question(question: str) -> bool:
    q = (question or "").lower()
    hints = (
        "what is", "what's", "about", "overview", "describe", "explain",
        "purpose", "project", "repo", "codebase", "tell me", "all about",
    )
    return any(h in q for h in hints)


def _lazy_without_tools(answer: str) -> bool:
    text = (answer or "").lower()
    return any(
        phrase in text
        for phrase in (
            "what can you tell me",
            "need to know what",
            "please share",
            "could you describe",
            "tell me about the files",
            "what files and directories",
            "i don't have access",
            "i do not have access",
        )
    )


def _agent_system_prompt(has_images: bool = False) -> str:
    prompt = _SYSTEM_PROMPT
    if has_images:
        prompt += (
            " The user may attach images in the message. "
            "Analyze attached images visually and describe what you see."
        )
    return prompt


def _build_agent_user_message(project_path: str, question: str, has_images: bool = False) -> str:
    if has_images and not _project_question(question):
        return (question or "").strip() or "Please analyze the attached image(s)."
    bootstrap = _bootstrap_project_context(project_path)
    return (
        f"Project path: {project_path}\n\n"
        f"Initial project snapshot:\n{bootstrap}\n\n"
        f"User question: {question}\n\n"
        "Use tools for anything missing from the snapshot, then answer directly."
    )


def _call_openai(api_key: str, model: str, messages: list) -> dict:
    resp = requests.post(
        "https://api.openai.com/v1/chat/completions",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={
            "model": model,
            "messages": messages,
            "tools": [{"type": "function", "function": t} for t in TOOL_DEFS],
        },
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()


def _parse_image_data_url(data_url: str) -> tuple[str, str]:
    raw = (data_url or "").strip()
    if not raw.startswith("data:"):
        return "image/png", raw
    header, _, payload = raw.partition(",")
    mime = header.split(";")[0].replace("data:", "").strip() or "image/png"
    return mime, payload


def _prepare_agent_input(
    project_path: str,
    question: str,
    attachments: list[dict] | None,
) -> tuple[str, list[dict]]:
    expanded = expand_repo_context_attachments(project_path, attachments or [])
    text_sections: list[str] = []
    if (question or "").strip():
        text_sections.append(question.strip())

    image_parts: list[dict] = []
    for att in expanded:
        if not isinstance(att, dict):
            continue
        att_type = str(att.get("type") or "")
        name = str(att.get("name") or "file")
        if att_type == "image" and att.get("data"):
            mime, payload = _parse_image_data_url(str(att["data"]))
            if payload:
                image_parts.append({"inlineData": {"mimeType": mime, "data": payload}})
            continue
        if att.get("content") is not None:
            content = str(att.get("content") or "")
            header = f"--- File: {name} ---"
            if att.get("truncated"):
                header += " (truncated)"
            text_sections.append(f"{header}\n{content}\n--- End of {name} ---")
            continue
        if att_type == "binary":
            size_kb = int(att.get("size") or 0) // 1024
            suffix = f" ({size_kb} KB)" if size_kb else ""
            text_sections.append(f"Attached binary file: {name}{suffix}")

    if not text_sections and image_parts:
        text_sections.append("Please analyze the attached image(s).")
    elif not text_sections:
        text_sections.append("Please help with the attached context.")

    return "\n\n".join(text_sections), image_parts


def _openai_user_content(text: str, image_parts: list[dict]) -> list[dict]:
    content: list[dict] = [{"type": "text", "text": text}]
    for part in image_parts:
        inline = part.get("inlineData") or {}
        mime = inline.get("mimeType") or "image/png"
        data = inline.get("data") or ""
        if not data:
            continue
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:{mime};base64,{data}"},
        })
    return content


def _run_openai_turn(project_path: str, question: str, api_key: str, model: str, image_parts: list | None = None) -> str:
    has_images = bool(image_parts)
    user_message = _build_agent_user_message(project_path, question, has_images=has_images)
    messages = [
        {"role": "system", "content": _agent_system_prompt(has_images)},
        {"role": "user", "content": _openai_user_content(user_message, image_parts or [])},
    ]
    for turn in range(5):
        data = _call_openai(api_key, model, messages)
        choice = data["choices"][0]
        msg = choice["message"]
        tool_calls = msg.get("tool_calls") or []
        if not tool_calls:
            answer = (msg.get("content") or "").strip()
            if turn == 0 and _project_question(question) and _lazy_without_tools(answer):
                listing = _run_tool(project_path, "list_dir", {"path": ""})
                readme = _run_tool(project_path, "read_file", {"path": "README.md", "start_line": 1, "end_line": 120})
                messages.append({"role": "assistant", "content": answer})
                messages.append({
                    "role": "user",
                    "content": (
                        "Tool results:\n"
                        f"list_dir: {json.dumps(listing)[:4000]}\n"
                        f"read_file README.md: {json.dumps(readme)[:4000]}\n"
                        "Now answer the original question directly."
                    ),
                })
                continue
            return answer
        messages.append(msg)
        for call in tool_calls:
            fn = call["function"]
            try:
                args = json.loads(fn.get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {}
            result = _run_tool(project_path, fn["name"], args)
            messages.append({
                "role": "tool",
                "tool_call_id": call["id"],
                "content": json.dumps(result)[:8000],
            })
    return "I wasn't able to finish within the tool-call limit."


def _extract_gemini_error(resp: requests.Response | None) -> str:
    if resp is None:
        return ""
    try:
        payload = resp.json()
        return payload.get("error", {}).get("message", "") or resp.text[:300]
    except Exception:
        return resp.text[:300] if resp.text else f"HTTP {resp.status_code}"


def _sanitize_api_error_message(message: str) -> str:
    s = str(message or "").strip()
    if not s:
        return ""
    s = re.sub(r"([?&]key=)[^&\s\"']+", r"\1***", s, flags=re.IGNORECASE)
    s = re.sub(r"Bearer\s+\S+", "Bearer ***", s, flags=re.IGNORECASE)
    return s[:500]


def _format_llm_error_for_user(
    error: BaseException | str,
    *,
    provider: str = "",
    status_code: int | None = None,
) -> str:
    raw = _sanitize_api_error_message(str(error))
    lowered = raw.lower()
    if status_code == 429 or "too many requests" in lowered or "rate limit" in lowered or "quota" in lowered:
        hints = ["Gemini rate limit hit — wait ~60s and try again."]
        if provider == "gemini":
            hints.append("Try switching model to Flash in the composer, or add an OpenAI key in Settings for automatic fallback.")
        return " ".join(hints)
    if status_code in {500, 502, 503, 504} or "high demand" in lowered or "overloaded" in lowered:
        return "The model provider is temporarily overloaded. Wait a moment and retry."
    if raw:
        return raw
    return "Model request failed. Check your API key in Settings and try again."


def _is_gemini_transient_error(detail: str, *, status_code: int | None = None) -> bool:
    if status_code in {429, 500, 502, 503, 504}:
        return True
    lowered = (detail or "").lower()
    return any(
        phrase in lowered
        for phrase in (
            "high demand",
            "rate limit",
            "too many requests",
            "quota",
            "try again",
            "overloaded",
            "resource exhausted",
            "temporarily unavailable",
        )
    )


def _gemini_models_to_try(primary: str) -> list[str]:
    primary = (primary or GEMINI_FAST_MODEL).strip()
    ordered: list[str] = []

    def add(model_name: str) -> None:
        model_name = (model_name or "").strip()
        if model_name and model_name not in ordered:
            ordered.append(model_name)

    alias_defaults = {
        "gemini-flash-latest": GEMINI_FAST_MODEL,
        "gemini-pro-latest": GEMINI_STRONG_MODEL,
        "gemini-flash-lite-latest": GEMINI_LITE_MODEL,
    }
    add(alias_defaults.get(primary, primary))
    if primary in alias_defaults:
        add(primary)

    pro_like = (
        primary == GEMINI_STRONG_MODEL
        or "pro" in primary.lower()
    )
    if pro_like:
        for model_name in (
            GEMINI_STRONG_MODEL,
            GEMINI_FAST_MODEL,
            GEMINI_FAST_FALLBACK,
            GEMINI_LITE_MODEL,
        ):
            add(model_name)
    else:
        for model_name in (
            GEMINI_FAST_MODEL,
            GEMINI_FAST_FALLBACK,
            GEMINI_LITE_MODEL,
            GEMINI_STRONG_MODEL,
        ):
            add(model_name)
    return ordered


def _call_gemini(
    api_key: str,
    model: str,
    contents: list,
    *,
    has_images: bool = False,
    with_tools: bool = True,
) -> dict:
    payload: dict = {
        "systemInstruction": {"parts": [{"text": _agent_system_prompt(has_images)}]},
        "contents": contents,
    }
    if with_tools:
        payload["tools"] = [{"functionDeclarations": TOOL_DEFS}]
    resp = requests.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        params={"key": api_key},
        json=payload,
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()


def _run_gemini_turn_single(
    project_path: str,
    question: str,
    api_key: str,
    model: str,
    image_parts: list | None = None,
) -> str:
    has_images = bool(image_parts)
    user_message = _build_agent_user_message(project_path, question, has_images=has_images)
    user_parts: list[dict] = []
    user_parts.extend(image_parts or [])
    user_parts.append({"text": user_message})
    contents = [{"role": "user", "parts": user_parts}]
    use_tools = not (has_images and not _project_question(question))
    for turn in range(5):
        data = _call_gemini(
            api_key,
            model,
            contents,
            has_images=has_images,
            with_tools=use_tools,
        )
        candidates = data.get("candidates") or []
        if not candidates:
            return "No response from Gemini."
        parts = candidates[0].get("content", {}).get("parts", [])
        function_calls = [p["functionCall"] for p in parts if "functionCall" in p]
        text_parts = [p["text"] for p in parts if "text" in p]
        if not function_calls:
            answer = "\n".join(text_parts).strip()
            if turn == 0 and _project_question(question) and _lazy_without_tools(answer):
                listing = _run_tool(project_path, "list_dir", {"path": ""})
                readme = _run_tool(project_path, "read_file", {"path": "README.md", "start_line": 1, "end_line": 120})
                contents.append({"role": "model", "parts": parts or [{"text": answer}]})
                contents.append({
                    "role": "user",
                    "parts": [
                        {"functionResponse": {"name": "list_dir", "response": listing}},
                        {"functionResponse": {"name": "read_file", "response": readme}},
                        {"text": "Use these tool results and answer the user's question directly."},
                    ],
                })
                continue
            return answer
        contents.append({"role": "model", "parts": parts})
        response_parts = []
        for fc in function_calls:
            result = _run_tool(project_path, fc["name"], fc.get("args") or {})
            function_response = {"name": fc["name"], "response": result}
            if fc.get("id"):
                function_response["id"] = fc["id"]
            response_parts.append({"functionResponse": function_response})
        contents.append({"role": "user", "parts": response_parts})
    return "I wasn't able to finish within the tool-call limit."


def _run_gemini_turn(
    project_path: str,
    question: str,
    api_key: str,
    model: str,
    image_parts: list | None = None,
) -> tuple[str, str]:
    models = _gemini_models_to_try(model)
    last_detail = ""
    for attempt_model in models:
        try:
            answer = _run_gemini_turn_single(
                project_path, question, api_key, attempt_model, image_parts=image_parts
            )
            return answer, attempt_model
        except requests.HTTPError as exc:
            last_detail = _extract_gemini_error(exc.response)
            if _is_gemini_transient_error(last_detail, status_code=getattr(exc.response, "status_code", None)):
                continue
            raise
    tried = ", ".join(models)
    raise RuntimeError(
        f"All Gemini models unavailable (tried: {tried}). Last error: {last_detail or 'unknown error'}"
    )


def run_agent_turn(
    project_path: str,
    question: str,
    settings: dict,
    user_model: str = "auto",
    image_parts: list | None = None,
) -> dict:
    provider, model = _resolve_provider_and_model(settings, question, user_model)
    if not provider or not model:
        return {"success": False, "error": "No LLM provider configured. Open Settings and add an OpenAI or Gemini API key."}
    try:
        if provider == "openai":
            answer = _run_openai_turn(
                project_path, question, settings["openai_api_key"], model, image_parts=image_parts
            )
        elif provider == "gemini":
            answer, model = _run_gemini_turn(
                project_path, question, settings["gemini_api_key"], model, image_parts=image_parts
            )
        else:
            return {"success": False, "error": f"Unknown provider: {provider}"}
    except RuntimeError as e:
        return {
            "success": False,
            "error": _format_llm_error_for_user(e, provider=provider),
            "provider": provider,
            "model": model,
        }
    except requests.HTTPError as e:
        status = e.response.status_code if e.response is not None else None
        detail = _extract_gemini_error(e.response) if provider == "gemini" and e.response is not None else ""
        if not detail:
            try:
                detail = e.response.json().get("error", {}).get("message", "")
            except Exception:
                detail = e.response.text[:300] if e.response is not None else ""
        return {
            "success": False,
            "error": _format_llm_error_for_user(detail or e, provider=provider, status_code=status),
            "provider": provider,
            "model": model,
        }
    except requests.RequestException as e:
        return {
            "success": False,
            "error": _format_llm_error_for_user(e, provider=provider),
            "provider": provider,
            "model": model,
        }
    return {"success": True, "answer": answer, "provider": provider, "model": model}

# ============================================================================
