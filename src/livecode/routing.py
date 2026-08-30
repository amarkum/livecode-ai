"""LiveCode — routing."""
from __future__ import annotations

from livecode._deps import load_prior
load_prior('livecode.routing', globals())

import re
from typing import Any


_CODEBASE_EVIDENCE_RE = re.compile(
    r"\b(api|json|response|payload|schema|endpoint|typescript|interface|"
    r"request\s+body|workorder|work\s*order)\b",
    re.IGNORECASE,
)
_FOLLOW_UP_RE = re.compile(
    r"\b(for this|for that|this one|that one|above|those|these|the same|it)\b",
    re.IGNORECASE,
)
_STRUCTURED_JSON_RE = re.compile(
    r"(json\s+response|api\s+response|sample\s+response|response\s+structure|"
    r"proper\s+api|response\s+example|example\s+response|payload)",
    re.IGNORECASE,
)
_STRUCTURE_DISCUSSION_RE = re.compile(
    r"\b(structured_output|structured\s+output|sse|event\s+stream|payload)\b",
    re.IGNORECASE,
)
_FILE_DISCOVERY_RE = re.compile(
    r"\b(where is|find file|which file|locate|list.*files|file named|files? (?:for|named|called|matching))\b",
    re.IGNORECASE,
)
_USER_WEB_REQUEST_RE = re.compile(
    r"\b(search the (?:web|internet)|look (?:it )?up online|google (?:this|for)|"
    r"search online|check online|web search|from the internet|browse (?:to|this url)|"
    r"fetch (?:this )?url|read (?:this )?url|open (?:this )?link)\b|https?://",
    re.IGNORECASE,
)

_GREETING_RE = re.compile(
    r"^\s*(hi|hello|hey|thanks|thank you|ok|okay|yo)\b",
    re.IGNORECASE,
)
_META_RE = re.compile(
    r"\b(what can you do|your capabilities|how do you work|who are you)\b",
    re.IGNORECASE,
)
_CODE_CHANGE_RE = re.compile(
    r"\b(fix|bug|patch|implement|add test|write test|unit tests?|"
    r"exception|error handling|logging|refactor|update code|change code|bump|"
    r"update|updated|edit|modify|change|clean|cleaner|rewrite|simplify|improve|polish)\b",
    re.IGNORECASE,
)
_FILE_PATH_RE = re.compile(
    r"(?:[\w.-]+/)*[\w.-]+\.(?:html?|css|jsx?|tsx?|py|md|json|xml|ya?ml|vue|svelte|txt|sql|sh|toml|ini|cfg)\b",
    re.IGNORECASE,
)
_FILE_EDIT_VERB_RE = re.compile(
    r"\b(update|updated|edit|change|modify|clean|cleaner|rewrite|simplify|"
    r"refactor|fix|improve|polish|streamline|restyle|make\s+(?:it\s+)?(?:clean(?:er)?|better|nicer))\b",
    re.IGNORECASE,
)
_VERSION_BUMP_RE = re.compile(
    r"\b(bump|update|change|set|increment)\b.*\bversion\b|\bversion\b.*\b(to|=\s*['\"]?\d)",
    re.IGNORECASE,
)

def _intelligent_defaults(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "goal_kind": "analysis",
        "edit_scope": "none",
        "needs_flagship_model": False,
    }
    base.update(overrides)
    return base

def looks_like_file_edit(question: str) -> bool:
    q = (question or "").strip()
    if not q:
        return False
    if _FILE_PATH_RE.search(q) and _FILE_EDIT_VERB_RE.search(q):
        return True
    if _FILE_PATH_RE.search(q) and _CODE_CHANGE_RE.search(q):
        return True
    return False

def _file_edit_classification() -> dict[str, Any]:
    return _intelligent_defaults(
        is_meta=False,
        is_actionable=True,
        needs_local_save=False,
        expects_bulk_work=False,
        needs_code_execution=False,
        needs_shell=False,
        chat_only=False,
        expects_multi_step=True,
        complexity="simple",
        is_follow_up=False,
        prior_context_hint="",
        goal_kind="code_change",
        edit_scope="single_file",
        needs_flagship_model=False,
    )

def heuristic_classification(question: str, *, has_prior_turns: bool) -> dict[str, Any] | None:
    q = (question or "").strip()
    if not q:
        return None
    if _META_RE.search(q):
        return _intelligent_defaults(
            is_meta=True,
            is_actionable=False,
            needs_local_save=False,
            expects_bulk_work=False,
            needs_code_execution=False,
            needs_shell=False,
            chat_only=True,
            expects_multi_step=False,
            complexity="simple",
            is_follow_up=False,
            prior_context_hint="",
            goal_kind="meta",
            edit_scope="none",
            needs_flagship_model=False,
        )
    if not has_prior_turns and len(q) < 80 and _GREETING_RE.match(q):
        return _intelligent_defaults(
            is_meta=False,
            is_actionable=False,
            needs_local_save=False,
            expects_bulk_work=False,
            needs_code_execution=False,
            needs_shell=False,
            chat_only=True,
            expects_multi_step=False,
            complexity="simple",
            is_follow_up=False,
            prior_context_hint="",
            goal_kind="meta",
        )
    if _VERSION_BUMP_RE.search(q):
        return _intelligent_defaults(
            is_meta=False,
            is_actionable=True,
            needs_local_save=False,
            expects_bulk_work=False,
            needs_code_execution=False,
            needs_shell=False,
            chat_only=False,
            expects_multi_step=True,
            complexity="medium",
            is_follow_up=bool(has_prior_turns and _FOLLOW_UP_RE.search(q)),
            prior_context_hint="",
            goal_kind="code_change",
            edit_scope="single_line",
            needs_flagship_model=False,
        )
    if looks_like_file_edit(q):
        return _file_edit_classification()
    if needs_codebase_evidence(q, has_prior_turns=has_prior_turns):
        return _intelligent_defaults(
            is_meta=False,
            is_actionable=True,
            needs_local_save=False,
            expects_bulk_work=False,
            needs_code_execution=False,
            needs_shell=False,
            chat_only=False,
            expects_multi_step=True,
            complexity="medium",
            is_follow_up=bool(has_prior_turns and _FOLLOW_UP_RE.search(q)),
            prior_context_hint="",
            goal_kind="research",
        )
    if not has_prior_turns and len(q) < 48 and not _CODEBASE_EVIDENCE_RE.search(q):
        return _intelligent_defaults(
            is_meta=False,
            is_actionable=False,
            needs_local_save=False,
            expects_bulk_work=False,
            needs_code_execution=False,
            needs_shell=False,
            chat_only=True,
            expects_multi_step=False,
            complexity="simple",
            is_follow_up=False,
            prior_context_hint="",
            goal_kind="meta",
        )
    return None

def get_session_chat_history_for_classify(
    project_path: str,
    session_id: str,
    current_question: str,
) -> list[dict[str, Any]]:
    projected = get_projected_messages(
        project_path, session_id, current_question, wrap_query=False,
    )
    if not projected:
        return []
    last = projected[-1]
    if last.get("role") == "user" and last.get("content") == current_question:
        return projected[:-1]
    return projected

def needs_codebase_evidence(question: str, *, has_prior_turns: bool = False) -> bool:
    q = (question or "").strip()
    if not q:
        return False
    if _CODEBASE_EVIDENCE_RE.search(q):
        return True
    return bool(has_prior_turns and _FOLLOW_UP_RE.search(q))

def wants_structured_json(question: str) -> bool:
    q = question or ""
    if not _STRUCTURED_JSON_RE.search(q):
        return False
    if _STRUCTURE_DISCUSSION_RE.search(q) and re.search(
        r"\b(what\s+happened|why|fix\s+it|improv|debug|aborted|sudden|this)\b",
        q,
        re.IGNORECASE,
    ):
        return False
    return True

def needs_file_discovery(question: str) -> bool:
    return bool(_FILE_DISCOVERY_RE.search(question or ""))

def user_requests_web_lookup(question: str) -> bool:
    return bool(_USER_WEB_REQUEST_RE.search(question or ""))

def needs_code_change(question: str, classification: dict[str, Any] | None) -> bool:
    if looks_like_file_edit(question):
        return True
    cls = classification or {}
    if str(cls.get("goal_kind") or "").lower() == "code_change":
        return True
    if cls.get("needs_code_execution") or cls.get("needs_local_save"):
        return True
    if cls.get("expects_bulk_work"):
        return True
    if cls.get("is_actionable") and not cls.get("chat_only"):
        if _CODE_CHANGE_RE.search(question or ""):
            return True
    return False

def needs_flagship_edit(classification: dict[str, Any] | None) -> bool:
    cls = classification or {}
    if cls.get("needs_flagship_model"):
        return True
    scope = str(cls.get("edit_scope") or "").lower()
    if scope in ("multi_file", "bulk"):
        return True
    if cls.get("expects_bulk_work"):
        return True
    if str(cls.get("complexity") or "").lower() == "complex" and str(cls.get("goal_kind") or "") == "code_change":
        return True
    return False

def normalize_livecode_classification(
    question: str,
    classification: dict[str, Any],
    *,
    has_prior_turns: bool,
) -> dict[str, Any]:
    out = dict(classification)
    if looks_like_file_edit(question):
        out["chat_only"] = False
        out["is_meta"] = False
        out["is_actionable"] = True
        out["goal_kind"] = "code_change"
        if str(out.get("edit_scope") or "none") == "none":
            out["edit_scope"] = "single_file"
        out["expects_multi_step"] = True
    if not needs_codebase_evidence(question, has_prior_turns=has_prior_turns):
        return out
    out["chat_only"] = False
    out["is_actionable"] = True
    out["is_meta"] = False
    if out.get("complexity") == "simple":
        out["complexity"] = "medium"
    out["expects_multi_step"] = True
    return out

def pick_tool_choice(
    iteration: int,
    classification: dict[str, Any],
    question: str,
    *,
    has_prior_turns: bool = False,
    force_required: bool = False,
) -> str:
    if force_required:
        return "required"
    if iteration != 1:
        return "auto"
    if looks_like_file_edit(question):
        return "required"
    if not classification.get("is_actionable"):
        return "auto"
    if classification.get("is_meta") or classification.get("chat_only"):
        return "auto"
    if (
        classification.get("needs_shell")
        or classification.get("needs_local_save")
        or classification.get("expects_bulk_work")
    ):
        return "required"
    if classification.get("expects_multi_step") or classification.get("complexity") == "complex":
        return "required"
    if needs_codebase_evidence(question, has_prior_turns=has_prior_turns):
        return "required"
    if needs_file_discovery(question):
        return "required"
    return "auto"

# ============================================================================
