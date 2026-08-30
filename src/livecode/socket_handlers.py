"""Socket.IO handlers for IDE file ops and live PTY terminal."""
from __future__ import annotations

import base64
import fcntl
import os
import signal
import struct
import subprocess
import termios
import threading
from typing import Any

from flask import request
from flask_socketio import SocketIO, emit

_terminals: dict[str, dict[str, Any]] = {}
_sid_terminals: dict[str, set[str]] = {}
_term_lock = threading.Lock()
_terminal_generation = 0


def _set_winsize(fd: int, rows: int, cols: int) -> None:
    rows = max(int(rows or 24), 1)
    cols = max(int(cols or 80), 1)
    winsize = struct.pack("HHHH", rows, cols, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)


def _close_terminal(terminal_id: str) -> None:
    with _term_lock:
        term = _terminals.pop(terminal_id, None)
        if term:
            sid = term.get("sid")
            if sid and sid in _sid_terminals:
                _sid_terminals[sid].discard(terminal_id)
                if not _sid_terminals[sid]:
                    _sid_terminals.pop(sid, None)
    if not term:
        return
    proc = term.get("proc")
    master = term.get("master")
    if proc and proc.poll() is None:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGHUP)
        except OSError:
            pass
        try:
            proc.wait(timeout=1)
        except subprocess.TimeoutExpired:
            try:
                proc.kill()
            except OSError:
                pass
    if master is not None:
        try:
            os.close(master)
        except OSError:
            pass


def _close_sid_terminals(sid: str) -> None:
    with _term_lock:
        terminal_ids = list(_sid_terminals.pop(sid, set()))
    for terminal_id in terminal_ids:
        _close_terminal(terminal_id)


def _get_terminal(terminal_id: str) -> dict[str, Any] | None:
    with _term_lock:
        return _terminals.get(terminal_id)


def register_socket_handlers(socketio: SocketIO) -> None:
    @socketio.on("connect")
    def on_connect():
        emit("connected", {"ok": True})

    @socketio.on("ide_list_files")
    def ide_list_files(data):
        raw = (data or {}).get("path") or (data or {}).get("project_path") or "."
        target = os.path.abspath(os.path.expanduser(str(raw)))
        if not os.path.isdir(target):
            emit("ide_files_list", {
                "path": raw,
                "requested_path": raw,
                "error": f"Folder not found: {raw}",
                "files": [],
            })
            return
        try:
            items = []
            for name in sorted(
                os.listdir(target),
                key=lambda n: (not os.path.isdir(os.path.join(target, n)), n.lower()),
            ):
                if name.startswith("."):
                    continue
                full = os.path.join(target, name)
                is_dir = os.path.isdir(full)
                items.append({
                    "name": name,
                    "path": full,
                    "type": "folder" if is_dir else "file",
                    "is_dir": is_dir,
                })
            emit("ide_files_list", {"path": target, "requested_path": raw, "files": items})
        except OSError as exc:
            emit("ide_files_list", {
                "path": target,
                "requested_path": raw,
                "error": str(exc),
                "files": [],
            })

    @socketio.on("ide_read_file")
    def ide_read_file(data):
        path = os.path.abspath(os.path.expanduser(str((data or {}).get("path") or "")))
        if not path or not os.path.isfile(path):
            emit("ide_file_content", {"error": "File not found", "path": path or (data or {}).get("path")})
            return
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as handle:
                content = handle.read()
            emit("ide_file_content", {"path": path, "content": content, "success": True})
        except OSError as exc:
            emit("ide_file_content", {"error": str(exc), "path": path})

    @socketio.on("ide_write_file")
    def ide_write_file(data):
        payload = data or {}
        path = os.path.abspath(os.path.expanduser(str(payload.get("path") or "")))
        content = payload.get("content", "")
        if not path:
            emit("ide_file_saved", {"error": "path required"})
            return
        try:
            parent = os.path.dirname(path)
            if parent:
                os.makedirs(parent, exist_ok=True)
            with open(path, "w", encoding="utf-8") as handle:
                handle.write(content)
            emit("ide_file_saved", {"path": path, "success": True})
        except OSError as exc:
            emit("ide_file_saved", {"error": str(exc), "path": path})

    @socketio.on("ide_mkdir")
    def ide_mkdir(data):
        payload = data or {}
        base = os.path.abspath(os.path.expanduser(str(payload.get("path") or "")))
        name = str(payload.get("name") or "").strip()
        if not base or not name:
            emit("ide_mkdir_result", {"error": "path and name required"})
            return
        target = os.path.join(base, name)
        try:
            os.makedirs(target, exist_ok=False)
            emit("ide_mkdir_result", {"success": True, "path": target, "parent": base})
        except FileExistsError:
            emit("ide_mkdir_result", {"error": "Directory already exists"})
        except OSError as exc:
            emit("ide_mkdir_result", {"error": str(exc)})

    @socketio.on("terminal_init")
    def terminal_init(data):
        global _terminal_generation
        sid = request.sid
        payload = data or {}
        project_path = payload.get("project_path") or payload.get("cwd") or os.path.expanduser("~")
        cwd = project_path if os.path.isdir(project_path) else os.path.expanduser("~")
        cols = int(payload.get("cols") or 80)
        rows = int(payload.get("rows") or 24)
        terminal_id = str(payload.get("terminal_id") or sid)

        _close_terminal(terminal_id)
        _terminal_generation += 1
        generation = _terminal_generation

        try:
            import pty
            import select

            master, slave = pty.openpty()
            _set_winsize(master, rows, cols)
            _set_winsize(slave, rows, cols)

            env = os.environ.copy()
            env["TERM"] = "xterm-256color"
            env["COLORTERM"] = "truecolor"
            env["COLUMNS"] = str(cols)
            env["LINES"] = str(rows)
            env.setdefault("LANG", "en_US.UTF-8")
            env.setdefault("LC_ALL", "en_US.UTF-8")

            shell = env.get("SHELL") or "/bin/zsh"
            proc = subprocess.Popen(
                [shell, "-i"],
                stdin=slave,
                stdout=slave,
                stderr=slave,
                cwd=cwd,
                env=env,
                preexec_fn=os.setsid,
                close_fds=True,
            )
            os.close(slave)

            def reader() -> None:
                try:
                    while True:
                        term = _get_terminal(terminal_id)
                        if not term or term.get("generation") != generation or term.get("proc") is not proc:
                            return
                        if proc.poll() is not None:
                            break
                        r, _, _ = select.select([master], [], [], 0.25)
                        if not r:
                            continue
                        try:
                            chunk = os.read(master, 8192)
                        except OSError:
                            break
                        if not chunk:
                            if proc.poll() is not None:
                                break
                            continue
                        socketio.emit(
                            "terminal_output",
                            {
                                "data": base64.b64encode(chunk).decode("ascii"),
                                "terminal_id": terminal_id,
                            },
                            to=sid,
                        )
                finally:
                    term = _get_terminal(terminal_id)
                    if term and term.get("generation") == generation and term.get("proc") is proc:
                        code = proc.poll()
                        if code is not None:
                            msg = (
                                f"\r\n[Process exited with code {code}]\r\n"
                                if code
                                else "\r\n[Process exited]\r\n"
                            )
                            socketio.emit(
                                "terminal_output",
                                {
                                    "data": base64.b64encode(msg.encode("utf-8")).decode("ascii"),
                                    "terminal_id": terminal_id,
                                },
                                to=sid,
                            )

            thread = threading.Thread(
                target=reader,
                daemon=True,
                name=f"pty-{terminal_id[:24]}",
            )
            with _term_lock:
                _terminals[terminal_id] = {
                    "master": master,
                    "proc": proc,
                    "thread": thread,
                    "terminal_id": terminal_id,
                    "sid": sid,
                    "generation": generation,
                }
                _sid_terminals.setdefault(sid, set()).add(terminal_id)
            thread.start()
            emit("terminal_ready", {"ok": True, "terminal_id": terminal_id, "cwd": cwd})
        except Exception as exc:
            emit(
                "terminal_output",
                {
                    "data": base64.b64encode(
                        f"\r\nTerminal unavailable: {exc}\r\n".encode("utf-8")
                    ).decode("ascii"),
                    "terminal_id": terminal_id,
                },
            )
            emit("terminal_ready", {"ok": False, "error": str(exc), "terminal_id": terminal_id})

    @socketio.on("terminal_input")
    def terminal_input(data):
        payload = data or {}
        terminal_id = str(payload.get("terminal_id") or request.sid)
        inp = payload.get("input", "")
        if not inp:
            return
        term = _get_terminal(terminal_id)
        if not term:
            return
        try:
            os.write(term["master"], inp.encode("utf-8", errors="surrogateescape"))
        except OSError:
            pass

    @socketio.on("terminal_resize")
    def terminal_resize(data):
        payload = data or {}
        terminal_id = str(payload.get("terminal_id") or request.sid)
        cols = int(payload.get("cols") or 80)
        rows = int(payload.get("rows") or 24)
        term = _get_terminal(terminal_id)
        if not term:
            return
        master = term.get("master")
        proc = term.get("proc")
        if master is None:
            return
        try:
            _set_winsize(master, rows, cols)
            if proc and proc.poll() is None:
                os.killpg(os.getpgid(proc.pid), signal.SIGWINCH)
        except OSError:
            pass

    @socketio.on("terminal_close")
    def terminal_close(data):
        terminal_id = str((data or {}).get("terminal_id") or "")
        if terminal_id:
            _close_terminal(terminal_id)

    @socketio.on("disconnect")
    def on_disconnect():
        _close_sid_terminals(request.sid)
