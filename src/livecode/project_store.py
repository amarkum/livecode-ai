"""LiveCode — project store."""
from __future__ import annotations

import json
import os
import re
import shutil
import tempfile
import time
from typing import Any

LIVECODE_ROOT = os.path.expanduser(os.environ.get("LIVECODE_HOME", "~/livecode"))
PROJECTS_ROOT = os.path.join(LIVECODE_ROOT, "projects")
SETTINGS_PATH = os.path.join(LIVECODE_ROOT, "settings.json")
PROJECT_META_FILE = "project.json"

def ensure_livecode_home_migrated() -> None:
    """Ensure ~/livecode exists with required subdirectories."""
    os.makedirs(LIVECODE_ROOT, exist_ok=True)
    os.makedirs(PROJECTS_ROOT, exist_ok=True)
    os.makedirs(os.path.join(LIVECODE_ROOT, "plans"), exist_ok=True)

_EPHEMERAL_PATH_MARKERS = (
    "/pytest-",
    "/pytest/",
    "/pytest_of_",
    "/pytest-of-",
    "/var/folders/",
    "/private/var/folders/",
    "/tmp/",
    "/private/tmp/",
)

def normalize_project_path(project_path: str) -> str:
    expanded = os.path.abspath(os.path.expanduser(project_path or ""))
    try:
        return os.path.realpath(expanded)
    except OSError:
        return expanded

def path_to_project_slug(abs_path: str) -> str:
    encoded = abs_path or ""
    for ch in ("/", "\\", ":", ".", "_", " "):
        encoded = encoded.replace(ch, "-")
    return encoded.lstrip("-") or "project"

def project_key(project_path: str) -> str:
    return path_to_project_slug(normalize_project_path(project_path))

def is_ephemeral_project_path(project_path: str) -> bool:
    root = normalize_project_path(project_path).replace("\\", "/")
    lower = root.lower()
    if any(marker in lower for marker in _EPHEMERAL_PATH_MARKERS):
        return True
    try:
        tmp = os.path.realpath(tempfile.gettempdir()).replace("\\", "/").lower()
        if tmp and (lower == tmp or lower.startswith(tmp.rstrip("/") + "/")):
            return True
    except OSError:
        pass
    return bool(re.search(r"/t(?:emp)?(?:/|$)", lower) and "/var/folders/" in lower)

def project_dir(project_path: str) -> str:
    root = normalize_project_path(project_path)
    key = project_key(root)
    path = os.path.join(PROJECTS_ROOT, key)
    os.makedirs(path, exist_ok=True)
    _write_project_metadata(path, key, root)
    return path

def project_file(project_path: str, *parts: str, create: bool = True) -> str:
    base = project_dir(project_path) if create else existing_project_dir(project_path)
    return os.path.join(base, *parts)

def existing_project_dir(project_path: str) -> str:
    root = normalize_project_path(project_path)
    key = project_key(root)
    return os.path.join(PROJECTS_ROOT, key)

def project_exists(project_path: str) -> bool:
    return os.path.isdir(existing_project_dir(project_path))

def delete_project_storage(project_path: str) -> bool:
    path = existing_project_dir(project_path)
    if not os.path.isdir(path):
        return False
    shutil.rmtree(path)
    return True

def prune_ephemeral_project_dirs(projects_root: str | None = None) -> int:
    root = projects_root or PROJECTS_ROOT
    if not os.path.isdir(root):
        return 0
    removed = 0
    for name in os.listdir(root):
        path = os.path.join(root, name)
        if not os.path.isdir(path):
            continue
        meta_path = os.path.join(path, PROJECT_META_FILE)
        project_path = ""
        if os.path.isfile(meta_path):
            try:
                with open(meta_path, "r", encoding="utf-8") as f:
                    meta = json.load(f)
                if isinstance(meta, dict):
                    project_path = str(meta.get("project_path") or "")
            except (json.JSONDecodeError, OSError):
                project_path = ""
        if project_path and is_ephemeral_project_path(project_path):
            try:
                shutil.rmtree(path)
                removed += 1
            except OSError:
                pass
    return removed

def _write_project_metadata(path: str, key: str, root: str) -> None:
    meta_path = os.path.join(path, PROJECT_META_FILE)
    payload: dict[str, Any] = {
        "project_key": key,
        "project_path": root,
        "project_name": os.path.basename(root.rstrip(os.sep)) or root,
        "updated_at": time.time(),
    }
    if os.path.isfile(meta_path):
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                existing = json.load(f)
            if isinstance(existing, dict):
                payload["created_at"] = (
                    existing.get("created_at")
                    or existing.get("updated_at")
                    or payload["updated_at"]
                )
        except (json.JSONDecodeError, OSError):
            pass
    payload.setdefault("created_at", payload["updated_at"])
    try:
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)
    except OSError:
        pass

# ============================================================================
