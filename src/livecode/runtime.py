"""LLM runtime adapters for the LiveCode agent harness."""
from __future__ import annotations

import json
import time
import uuid
from typing import Any, Callable

import requests

CREDENTIALS_FILE = ""

_GEMINI_API = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
_GEMINI_STREAM_API = "https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent"
_OPENAI_API = "https://api.openai.com/v1/chat/completions"
_GEMINI_RETRY_ATTEMPTS = 3
_GEMINI_RETRY_BACKOFF_S = 1.5


def load_agent_settings() -> dict[str, Any]:
    try:
        from livecode.llm_providers import load_settings

        settings = load_settings()
        return {
            "livecode": {
                "openai_api_key": settings.get("openai_api_key") or "",
                "gemini_api_key": settings.get("gemini_api_key") or "",
            }
        }
    except Exception:
        return {}


def _load_settings() -> dict[str, Any]:
    from livecode.llm_providers import load_settings

    return load_settings()


def _is_auto(user_model: str) -> bool:
    return (user_model or "").strip().lower() in ("", "auto")


def resolve_agent_model(user_model: str | None) -> str:
    from livecode.llm_providers import (
        GEMINI_FAST_MODEL,
        OPENAI_FAST_MODEL,
        _resolve_auto_provider_and_model,
        _resolve_provider_and_model,
    )

    selected = (user_model or "auto").strip() or "auto"
    settings = _load_settings()
    if _is_auto(selected):
        provider, model = _resolve_auto_provider_and_model(settings, "")
        return model or GEMINI_FAST_MODEL
    provider, model = _resolve_provider_and_model(settings, "", selected)
    if model:
        return model
    return GEMINI_FAST_MODEL if settings.get("gemini_api_key") else OPENAI_FAST_MODEL


def pick_fast_model(*, task: str = "fast") -> str:
    from livecode.llm_providers import GEMINI_FAST_MODEL, GEMINI_LITE_MODEL, OPENAI_FAST_MODEL

    settings = _load_settings()
    if settings.get("gemini_api_key"):
        return GEMINI_LITE_MODEL if task == "fast" else GEMINI_FAST_MODEL
    if settings.get("openai_api_key"):
        return OPENAI_FAST_MODEL
    return resolve_agent_model("auto")


def pick_livecode_auto_model(
    classification: dict[str, Any],
    *,
    tool_loop: bool,
    escalate: bool,
    content_chars: int = 0,
    edit_pending: bool = False,
    edit_completed: bool = False,
    needs_flagship: bool = False,
    needs_flagship_edit: bool = False,
    code_edit: bool = False,
) -> str:
    del tool_loop, edit_pending, edit_completed
    from livecode.llm_providers import GEMINI_FAST_MODEL, GEMINI_LITE_MODEL, GEMINI_STRONG_MODEL, OPENAI_FAST_MODEL, OPENAI_STRONG_MODEL

    settings = _load_settings()
    complexity = str(classification.get("complexity") or "medium")
    want_strong = (
        escalate
        or needs_flagship
        or needs_flagship_edit
        or code_edit
        or complexity == "complex"
        or content_chars > 80_000
    )

    if settings.get("gemini_api_key"):
        if want_strong:
            return GEMINI_STRONG_MODEL
        return GEMINI_FAST_MODEL

    if settings.get("openai_api_key"):
        return OPENAI_STRONG_MODEL if want_strong else OPENAI_FAST_MODEL

    return resolve_agent_model("auto")


def livecode_auto_model_route_reason(
    classification: dict[str, Any],
    *,
    tool_loop: bool,
    escalate: bool,
    content_chars: int,
    edit_pending: bool,
    edit_completed: bool,
    needs_flagship: bool,
    needs_flagship_edit: bool = False,
    model: str,
) -> str:
    del tool_loop, edit_pending, edit_completed, model
    parts: list[str] = []
    if escalate:
        parts.append("escalated")
    if needs_flagship or needs_flagship_edit:
        parts.append("flagship edit")
    complexity = str(classification.get("complexity") or "medium")
    if complexity != "medium":
        parts.append(f"complexity={complexity}")
    if content_chars > 80_000:
        parts.append("large context")
    return ", ".join(parts) if parts else "default route"


def _infer_provider(model: str, settings: dict[str, Any]) -> str:
    from livecode.llm_providers import _infer_provider_for_model

    provider = _infer_provider_for_model(settings, model)
    if provider:
        return provider
    if settings.get("gemini_api_key"):
        return "gemini"
    if settings.get("openai_api_key"):
        return "openai"
    return ""


def is_agent_model(model: str) -> bool:
    """True when a configured Gemini or OpenAI provider is available."""
    del model
    settings = _load_settings()
    return bool(settings.get("gemini_api_key") or settings.get("openai_api_key"))


def _normalize_tool_choice(tool_choice: Any) -> str | dict | None:
    if tool_choice is None:
        return None
    if isinstance(tool_choice, (str, dict)):
        return tool_choice
    return "auto"


def _openai_tools_payload(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for tool in tools or []:
        if tool.get("type") == "function" and tool.get("function"):
            out.append(tool)
        elif tool.get("name"):
            out.append({"type": "function", "function": tool})
    return out


def _gemini_declarations(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    decls: list[dict[str, Any]] = []
    for tool in _openai_tools_payload(tools):
        fn = tool.get("function") or {}
        name = fn.get("name")
        if not name:
            continue
        decls.append({
            "name": name,
            "description": fn.get("description") or "",
            "parameters": fn.get("parameters") or {"type": "object", "properties": {}},
        })
    return decls


def _extract_thought_signature(part: dict[str, Any]) -> str | None:
    for key in ("thought_signature", "thoughtSignature"):
        value = part.get(key)
        if value:
            return str(value)
    return None


def _message_text(content: Any) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, dict):
                if block.get("type") == "text":
                    parts.append(str(block.get("text") or ""))
                elif "text" in block:
                    parts.append(str(block.get("text") or ""))
            else:
                parts.append(str(block))
        return "\n".join(p for p in parts if p)
    return str(content)


def _gemini_contents(messages: list[dict[str, Any]]) -> tuple[str, list[dict[str, Any]]]:
    system_parts: list[str] = []
    contents: list[dict[str, Any]] = []
    tool_names_by_id: dict[str, str] = {}

    for msg in messages:
        role = msg.get("role")
        if role == "system":
            system_parts.append(_message_text(msg.get("content")))
            continue
        if role == "tool":
            tool_id = str(msg.get("tool_call_id") or "")
            fn_name = str(msg.get("name") or tool_names_by_id.get(tool_id) or "tool")
            contents.append({
                "role": "user",
                "parts": [{
                    "functionResponse": {
                        "name": fn_name,
                        "response": _parse_tool_result_content(msg.get("content")),
                    }
                }],
            })
            continue
        if role == "assistant":
            parts: list[dict[str, Any]] = []
            text = _message_text(msg.get("content"))
            if text.strip():
                parts.append({"text": text})
            for tc in msg.get("tool_calls") or []:
                fn = tc.get("function") or {}
                tc_id = str(tc.get("id") or "")
                fn_name = str(fn.get("name") or "")
                if tc_id and fn_name:
                    tool_names_by_id[tc_id] = fn_name
                raw_args = fn.get("arguments") or "{}"
                try:
                    args = json.loads(raw_args) if isinstance(raw_args, str) else dict(raw_args or {})
                except json.JSONDecodeError:
                    args = {}
                part: dict[str, Any] = {"functionCall": {"name": fn_name, "args": args}}
                sig = tc.get("thought_signature") or tc.get("thoughtSignature")
                if sig:
                    part["thought_signature"] = sig
                parts.append(part)
            if parts:
                contents.append({"role": "model", "parts": parts})
            continue
        if role == "user":
            text = _message_text(msg.get("content"))
            if text.strip():
                contents.append({"role": "user", "parts": [{"text": text}]})

    return "\n\n".join(system_parts).strip(), contents


def _parse_tool_result_content(content: Any) -> dict[str, Any]:
    if isinstance(content, dict):
        return content
    raw = str(content or "")
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass
    return {"result": raw}


def _iter_sse_json_payloads(response: requests.Response) -> Any:
    for raw_line in response.iter_lines(decode_unicode=True):
        if not raw_line:
            continue
        line = raw_line.strip()
        if not line.startswith("data:"):
            continue
        payload = line[5:].strip()
        if payload == "[DONE]":
            break
        try:
            yield json.loads(payload)
        except json.JSONDecodeError:
            continue


def _openai_build_payload(
    model: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    *,
    tool_choice: Any = "auto",
    stream: bool = False,
) -> dict[str, Any]:
    payload: dict[str, Any] = {"model": model, "messages": messages}
    if stream:
        payload["stream"] = True
    tool_payload = _openai_tools_payload(tools)
    if tool_payload:
        payload["tools"] = tool_payload
        tc = _normalize_tool_choice(tool_choice)
        if tc == "required":
            payload["tool_choice"] = "required"
        elif isinstance(tc, dict):
            payload["tool_choice"] = tc
    return payload


def _parse_openai_response(message: dict[str, Any]) -> dict[str, Any]:
    tool_calls = []
    for tc in message.get("tool_calls") or []:
        fn = tc.get("function") or {}
        tool_calls.append({
            "id": tc.get("id") or f"call_{uuid.uuid4().hex[:12]}",
            "type": "function",
            "function": {
                "name": fn.get("name", ""),
                "arguments": fn.get("arguments") or "{}",
            },
        })
    return {
        "content": message.get("content") or "",
        "tool_calls": tool_calls or None,
        "reasoning_content": message.get("reasoning_content") or "",
    }


def _accumulate_gemini_parts(
    parts: list[dict[str, Any]],
    *,
    text_parts: list[str],
    thought_parts: list[str],
    tool_calls: list[dict[str, Any]],
    on_thought_delta: Callable[[str], None] | None = None,
) -> None:
    for part in parts:
        if "functionCall" in part:
            fc = part["functionCall"]
            tool_call: dict[str, Any] = {
                "id": f"call_{uuid.uuid4().hex[:12]}",
                "type": "function",
                "function": {
                    "name": fc.get("name", ""),
                    "arguments": json.dumps(fc.get("args") or {}),
                },
            }
            sig = _extract_thought_signature(part)
            if sig:
                tool_call["thought_signature"] = sig
            tool_calls.append(tool_call)
            continue
        if "text" not in part:
            continue
        text = str(part["text"] or "")
        if not text:
            continue
        if part.get("thought"):
            thought_parts.append(text)
            if on_thought_delta:
                on_thought_delta(text)
        else:
            text_parts.append(text)


def _parse_gemini_response(data: dict[str, Any]) -> dict[str, Any]:
    candidates = data.get("candidates") or []
    if not candidates:
        return {"content": "No response from model.", "tool_calls": None, "reasoning_content": ""}
    parts = candidates[0].get("content", {}).get("parts") or []
    text_parts: list[str] = []
    thought_parts: list[str] = []
    tool_calls: list[dict[str, Any]] = []
    _accumulate_gemini_parts(
        parts,
        text_parts=text_parts,
        thought_parts=thought_parts,
        tool_calls=tool_calls,
    )
    return {
        "content": "\n".join(text_parts).strip(),
        "tool_calls": tool_calls or None,
        "reasoning_content": "\n".join(thought_parts).strip(),
    }


def _openai_call_streaming(
    model: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    *,
    api_key: str,
    tool_choice: Any = "auto",
    on_thought_delta: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    payload = _openai_build_payload(
        model,
        messages,
        tools,
        tool_choice=tool_choice,
        stream=True,
    )
    resp = requests.post(
        _OPENAI_API,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json=payload,
        stream=True,
        timeout=120,
    )
    resp.raise_for_status()

    content_parts: list[str] = []
    reasoning_parts: list[str] = []
    tool_calls_by_index: dict[int, dict[str, Any]] = {}
    saw_tool_call_delta = False

    for chunk in _iter_sse_json_payloads(resp):
        choice = (chunk.get("choices") or [{}])[0]
        delta = choice.get("delta") or {}
        reasoning = delta.get("reasoning_content") or ""
        if reasoning:
            reasoning_parts.append(reasoning)
            if on_thought_delta:
                on_thought_delta(reasoning)
        content = delta.get("content") or ""
        if content:
            content_parts.append(content)
            if on_thought_delta and not saw_tool_call_delta and not reasoning:
                on_thought_delta(content)
        for tc_delta in delta.get("tool_calls") or []:
            saw_tool_call_delta = True
            idx = int(tc_delta.get("index", 0))
            if idx not in tool_calls_by_index:
                tool_calls_by_index[idx] = {
                    "id": tc_delta.get("id") or f"call_{uuid.uuid4().hex[:12]}",
                    "type": "function",
                    "function": {"name": "", "arguments": ""},
                }
            entry = tool_calls_by_index[idx]
            if tc_delta.get("id"):
                entry["id"] = tc_delta["id"]
            fn = tc_delta.get("function") or {}
            if fn.get("name"):
                entry["function"]["name"] += fn["name"]
            if fn.get("arguments"):
                entry["function"]["arguments"] += fn["arguments"]

    tool_calls = [tool_calls_by_index[i] for i in sorted(tool_calls_by_index)]
    message = {
        "content": "".join(content_parts),
        "reasoning_content": "".join(reasoning_parts),
        "tool_calls": tool_calls or None,
    }
    return _parse_openai_response(message)


def _openai_call(
    model: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    *,
    api_key: str,
    tool_choice: Any = "auto",
    on_thought_delta: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    if on_thought_delta:
        return _openai_call_streaming(
            model,
            messages,
            tools,
            api_key=api_key,
            tool_choice=tool_choice,
            on_thought_delta=on_thought_delta,
        )
    payload = _openai_build_payload(model, messages, tools, tool_choice=tool_choice)
    resp = requests.post(
        _OPENAI_API,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json=payload,
        timeout=120,
    )
    resp.raise_for_status()
    message = resp.json()["choices"][0]["message"]
    return _parse_openai_response(message)


def _gemini_build_payload(
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    *,
    tool_choice: Any = "auto",
) -> dict[str, Any]:
    system_text, contents = _gemini_contents(messages)
    payload: dict[str, Any] = {"contents": contents or [{"role": "user", "parts": [{"text": "Continue."}]}]}
    if system_text:
        payload["systemInstruction"] = {"parts": [{"text": system_text}]}
    decls = _gemini_declarations(tools)
    if decls:
        payload["tools"] = [{"functionDeclarations": decls}]
        tc = _normalize_tool_choice(tool_choice)
        if tc == "required":
            payload["toolConfig"] = {"functionCallingConfig": {"mode": "ANY"}}
    return payload


def _gemini_call_streaming(
    model: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    *,
    api_key: str,
    tool_choice: Any = "auto",
    on_thought_delta: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    payload = _gemini_build_payload(messages, tools, tool_choice=tool_choice)
    resp = requests.post(
        _GEMINI_STREAM_API.format(model=model),
        params={"key": api_key, "alt": "sse"},
        json=payload,
        stream=True,
        timeout=120,
    )
    resp.raise_for_status()

    text_parts: list[str] = []
    thought_parts: list[str] = []
    tool_calls: list[dict[str, Any]] = []

    for chunk in _iter_sse_json_payloads(resp):
        candidates = chunk.get("candidates") or []
        if not candidates:
            continue
        parts = candidates[0].get("content", {}).get("parts") or []
        _accumulate_gemini_parts(
            parts,
            text_parts=text_parts,
            thought_parts=thought_parts,
            tool_calls=tool_calls,
            on_thought_delta=on_thought_delta,
        )

    return {
        "content": "\n".join(text_parts).strip(),
        "tool_calls": tool_calls or None,
        "reasoning_content": "\n".join(thought_parts).strip(),
    }


def _gemini_call(
    model: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    *,
    api_key: str,
    tool_choice: Any = "auto",
    on_thought_delta: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    if on_thought_delta:
        return _gemini_call_streaming(
            model,
            messages,
            tools,
            api_key=api_key,
            tool_choice=tool_choice,
            on_thought_delta=on_thought_delta,
        )
    payload = _gemini_build_payload(messages, tools, tool_choice=tool_choice)
    resp = requests.post(
        _GEMINI_API.format(model=model),
        params={"key": api_key},
        json=payload,
        timeout=120,
    )
    resp.raise_for_status()
    return _parse_gemini_response(resp.json())


def call_with_tools(
    model: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    *,
    tool_choice: Any = "auto",
    prompt_cache_key: str | None = None,
    on_thought_delta: Callable[[str], None] | None = None,
    on_retry: Callable[..., None] | None = None,
) -> dict[str, Any]:
    del prompt_cache_key
    settings = _load_settings()
    resolved = resolve_agent_model(model)
    provider = _infer_provider(resolved, settings)
    if not provider:
        raise RuntimeError("No LLM provider configured. Add an OpenAI or Gemini API key in Settings.")

    from livecode.llm_providers import (
        OPENAI_FAST_MODEL,
        _extract_gemini_error,
        _format_llm_error_for_user,
        _gemini_models_to_try,
        _is_gemini_transient_error,
    )

    models_to_try = [resolved]
    if provider == "gemini":
        models_to_try = _gemini_models_to_try(resolved)

    last_error: Exception | None = None
    last_status: int | None = None

    def _http_detail(exc: requests.HTTPError) -> str:
        try:
            return exc.response.json().get("error", {}).get("message", "")
        except Exception:
            return exc.response.text[:200] if exc.response is not None else str(exc)

    def _attempt_call(active_provider: str, attempt_model: str, api_key: str) -> dict[str, Any]:
        if active_provider == "openai":
            return _openai_call(
                attempt_model,
                messages,
                tools,
                api_key=api_key,
                tool_choice=tool_choice,
                on_thought_delta=on_thought_delta,
            )
        return _gemini_call(
            attempt_model,
            messages,
            tools,
            api_key=api_key,
            tool_choice=tool_choice,
            on_thought_delta=on_thought_delta,
        )

    active_provider = provider
    for attempt_model in models_to_try:
        for retry_idx in range(_GEMINI_RETRY_ATTEMPTS):
            try:
                api_key = settings[f"{active_provider}_api_key"]
                return _attempt_call(active_provider, attempt_model, api_key)
            except requests.HTTPError as exc:
                last_error = exc
                status = exc.response.status_code if exc.response is not None else None
                last_status = status
                detail = _extract_gemini_error(exc.response) if exc.response is not None else _http_detail(exc)
                transient = _is_gemini_transient_error(detail, status_code=status)
                if transient and retry_idx < _GEMINI_RETRY_ATTEMPTS - 1:
                    if on_retry:
                        on_retry(retry_idx + 1, _GEMINI_RETRY_ATTEMPTS, exc)
                    time.sleep(_GEMINI_RETRY_BACKOFF_S * (retry_idx + 1))
                    continue
                if active_provider == "gemini" and transient:
                    break
                raise RuntimeError(
                    _format_llm_error_for_user(detail or str(exc), provider=active_provider, status_code=status)
                ) from exc
            except requests.RequestException as exc:
                last_error = exc
                raise RuntimeError(_format_llm_error_for_user(exc, provider=active_provider)) from exc

    if active_provider == "gemini" and settings.get("openai_api_key"):
        fallback_model = settings.get("openai_model") or OPENAI_FAST_MODEL
        try:
            if on_retry:
                on_retry(1, 1, last_error or RuntimeError("Gemini unavailable"))
            return _attempt_call("openai", fallback_model, settings["openai_api_key"])
        except requests.HTTPError as exc:
            status = exc.response.status_code if exc.response is not None else None
            detail = _http_detail(exc)
            raise RuntimeError(
                _format_llm_error_for_user(detail or str(exc), provider="openai", status_code=status)
            ) from exc
        except requests.RequestException as exc:
            raise RuntimeError(_format_llm_error_for_user(exc, provider="openai")) from exc

    if last_error:
        raise RuntimeError(
            _format_llm_error_for_user(last_error, provider=active_provider, status_code=last_status)
        )
    raise RuntimeError("Model call failed")


def call_summarize(model: str, messages: list[dict[str, str]]) -> str:
    resp = call_with_tools(model, messages, [])
    return str(resp.get("content") or "")


def call_streaming(model: str, messages: list[dict[str, Any]], timeout: int = 180) -> Any:
    del timeout
    resp = call_with_tools(model, messages, [])
    content = resp.get("content") or ""
    yield content
