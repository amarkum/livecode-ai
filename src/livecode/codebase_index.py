"""LiveCode — codebase index."""
from __future__ import annotations

from livecode._deps import load_prior
load_prior('livecode.codebase_index', globals())

import ast
import json
import os
import re
import subprocess
import threading
import time
import warnings
from typing import Any


MAX_INDEXABLE_SIZE = 2 * 1024 * 1024

_managers: dict[str, "CodebaseIndexManager"] = {}
_codebase_index_lock = threading.Lock()

JS_SYMBOL_RE = re.compile(
    r"^\s*(?:export\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+(\w+)",
    re.MULTILINE,
)

def _project_hash(project_path: str) -> str:
    return project_key(project_path)

def _symbol_cache_path(project_path: str) -> str:
    path = project_file(project_path, "symbols", "symbols.json")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    return path

def _git_head(project_path: str) -> str | None:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=project_path,
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    return result.stdout.strip() or None

def _parse_python_symbols(content: str, rel_path: str) -> list[dict[str, Any]]:
    symbols: list[dict[str, Any]] = []
    try:
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", category=SyntaxWarning)
            tree = ast.parse(content, filename=rel_path)
    except SyntaxError:
        return symbols
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            symbols.append({
                "name": node.name,
                "kind": "class",
                "file": rel_path,
                "start_line": node.lineno,
                "end_line": getattr(node, "end_lineno", node.lineno),
                "parent_scope": "",
            })
        elif isinstance(node, ast.FunctionDef):
            symbols.append({
                "name": node.name,
                "kind": "function",
                "file": rel_path,
                "start_line": node.lineno,
                "end_line": getattr(node, "end_lineno", node.lineno),
                "parent_scope": "",
            })
        elif isinstance(node, ast.AsyncFunctionDef):
            symbols.append({
                "name": node.name,
                "kind": "async_function",
                "file": rel_path,
                "start_line": node.lineno,
                "end_line": getattr(node, "end_lineno", node.lineno),
                "parent_scope": "",
            })
    return symbols

def _parse_js_symbols(content: str, rel_path: str) -> list[dict[str, Any]]:
    symbols: list[dict[str, Any]] = []
    for i, line in enumerate(content.splitlines(), 1):
        m = JS_SYMBOL_RE.match(line)
        if m:
            kind = "function" if "function" in line else "class" if "class" in line else "symbol"
            symbols.append({
                "name": m.group(1),
                "kind": kind,
                "file": rel_path,
                "start_line": i,
                "end_line": i,
                "parent_scope": "",
            })
    return symbols

def _parse_file_symbols(rel_path: str, content: str) -> list[dict[str, Any]]:
    ext = os.path.splitext(rel_path)[1].lower()
    if ext == ".py":
        return _parse_python_symbols(content, rel_path)
    if ext in (".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"):
        return _parse_js_symbols(content, rel_path)
    return []

class CodebaseIndexManager:

    def __init__(self, project_path: str) -> None:
        self.project_path = os.path.abspath(os.path.expanduser(project_path))
        self.symbols: list[dict[str, Any]] = []
        self.file_mtimes: dict[str, float] = {}
        self.indexed_at = 0.0
        self.git_head: str | None = None
        self._watch_started = False
        self._mutate_lock = threading.RLock()

    def build(self, *, force: bool = False) -> dict[str, Any]:
        with self._mutate_lock:
            return self._build_locked(force=force)

    def _build_locked(self, *, force: bool) -> dict[str, Any]:
        cache_path = _symbol_cache_path(self.project_path)
        current_head = _git_head(self.project_path)
        if not force and self.symbols and (current_head is None or self.git_head == current_head):
            return self.stats()
        if not force and os.path.isfile(cache_path):
            try:
                with open(cache_path, "r", encoding="utf-8") as f:
                    cached = json.load(f)
                cached_head = cached.get("git_head")
                head_matches = current_head is None or cached_head == current_head
                if cached.get("project_path") == self.project_path and head_matches:
                    self.symbols = cached.get("symbols") or []
                    self.file_mtimes = cached.get("file_mtimes") or {}
                    self.indexed_at = cached.get("indexed_at", 0)
                    self.git_head = cached_head
                    return self.stats()
            except (json.JSONDecodeError, OSError):
                pass

        gitignore = _load_gitignore_patterns(self.project_path)
        symbols: list[dict[str, Any]] = []
        mtimes: dict[str, float] = {}
        root = self.project_path

        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
            for name in filenames:
                rel = os.path.relpath(os.path.join(dirpath, name), root).replace("\\", "/")
                if _ignored(name, rel, gitignore):
                    continue
                ext = os.path.splitext(name)[1].lower()
                if ext in SKIP_EXT:
                    continue
                full = os.path.join(dirpath, name)
                try:
                    size = os.path.getsize(full)
                    mtime = os.path.getmtime(full)
                except OSError:
                    continue
                if size > MAX_INDEXABLE_SIZE:
                    continue
                if ext not in (".py", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"):
                    continue
                try:
                    with open(full, "r", encoding="utf-8", errors="replace") as f:
                        content = f.read()
                except OSError:
                    continue
                symbols.extend(_parse_file_symbols(rel, content))
                mtimes[rel] = mtime

        self.symbols = symbols
        self.file_mtimes = mtimes
        self.indexed_at = time.time()
        self.git_head = current_head
        self._persist()
        self._maybe_start_watch()
        return self.stats()

    def _persist(self) -> None:
        path = _symbol_cache_path(self.project_path)
        payload = {
            "project_path": self.project_path,
            "indexed_at": self.indexed_at,
            "git_head": self.git_head,
            "symbols": self.symbols,
            "file_mtimes": self.file_mtimes,
        }
        try:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(payload, f)
        except OSError:
            pass

    def _maybe_start_watch(self) -> None:
        if self._watch_started:
            return
        try:
            from watchdog.observers import Observer
            from watchdog.events import FileSystemEventHandler
        except ImportError:
            return

        manager = self

        class Handler(FileSystemEventHandler):
            def on_modified(self, event):
                if event.is_directory:
                    return
                src = getattr(event, "src_path", "")
                if src:
                    manager.update_file(src)

            def on_created(self, event):
                self.on_modified(event)

            def on_deleted(self, event):
                if event.is_directory:
                    return
                src = getattr(event, "src_path", "")
                rel = os.path.relpath(src, manager.project_path).replace("\\", "/")
                with manager._mutate_lock:
                    manager.symbols = [s for s in manager.symbols if s.get("file") != rel]
                    manager.file_mtimes.pop(rel, None)
                    manager._persist()

        try:
            observer = Observer()
            observer.schedule(Handler(), self.project_path, recursive=True)
            observer.daemon = True
            observer.start()
            self._watch_started = True
        except Exception:
            pass

    def update_file(self, abs_path: str) -> None:
        rel = os.path.relpath(abs_path, self.project_path).replace("\\", "/")
        with self._mutate_lock:
            self.symbols = [s for s in self.symbols if s.get("file") != rel]
            if not os.path.isfile(abs_path):
                self.file_mtimes.pop(rel, None)
                self._persist()
                return
            try:
                with open(abs_path, "r", encoding="utf-8", errors="replace") as f:
                    content = f.read()
                self.symbols.extend(_parse_file_symbols(rel, content))
                self.file_mtimes[rel] = os.path.getmtime(abs_path)
                self._persist()
            except OSError:
                pass

    def stats(self) -> dict[str, Any]:
        langs: dict[str, int] = {}
        for s in self.symbols:
            ext = os.path.splitext(s.get("file", ""))[1].lower()
            langs[ext or "?"] = langs.get(ext or "?", 0) + 1
        return {
            "symbol_count": len(self.symbols),
            "file_count": len(self.file_mtimes),
            "languages": langs,
            "indexed_at": self.indexed_at,
        }

    def find_symbol(self, name: str, kind: str | None = None, limit: int = 30) -> list[dict[str, Any]]:
        needle = (name or "").strip()
        if not needle:
            return []
        out = []
        for s in self.symbols:
            if needle not in s.get("name", ""):
                continue
            if kind and s.get("kind") != kind:
                continue
            out.append(s)
            if len(out) >= limit:
                break
        return out

    def find_references(self, name: str, limit: int = 40) -> list[dict[str, Any]]:
        needle = (name or "").strip()
        if not needle:
            return []
        refs: list[dict[str, Any]] = []
        pattern = re.compile(r"\b" + re.escape(needle) + r"\b")
        for rel in self.file_mtimes:
            full, _ = resolve_safe_path(self.project_path, rel)
            if not full or not os.path.isfile(full):
                continue
            try:
                with open(full, "r", encoding="utf-8", errors="replace") as f:
                    for i, line in enumerate(f, 1):
                        if pattern.search(line):
                            refs.append({"file": rel, "line": i, "text": line.strip()[:120]})
                            if len(refs) >= limit:
                                return refs
            except OSError:
                continue
        return refs

    def list_symbols(self, path: str = "", limit: int = 80) -> list[dict[str, Any]]:
        prefix = (path or "").strip().replace("\\", "/")
        out = []
        for s in self.symbols:
            fp = s.get("file", "")
            if prefix and not fp.startswith(prefix):
                continue
            out.append(s)
            if len(out) >= limit:
                break
        return out

def get_codebase_index(project_path: str, *, force: bool = False) -> CodebaseIndexManager:
    key = _project_hash(project_path)
    with _codebase_index_lock:
        if key not in _managers:
            _managers[key] = CodebaseIndexManager(project_path)
        mgr = _managers[key]
    mgr.build(force=force)
    return mgr

# ============================================================================
