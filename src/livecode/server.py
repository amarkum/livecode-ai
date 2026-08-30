"""LiveCode — server."""
from __future__ import annotations

from livecode._deps import load_prior
load_prior('livecode.server', globals())

import logging
import os
import queue
from pathlib import Path

from flask import Flask, Response, jsonify, render_template, request, stream_with_context


class SSEProgressBridge:
    """Queues progress events for SSE and optionally forwards to live Socket.IO."""

    def __init__(self, real_socketio: Any = None, emit_room: str | None = None) -> None:
        self._events: queue.Queue[dict[str, Any]] = queue.Queue()
        self._real_socketio = real_socketio
        self._emit_room = (emit_room or "").strip() or None

    def emit(self, event: str, payload: dict | None = None, room: str | None = None) -> None:
        if event not in {"livecode_progress", "agent_command_stream"}:
            return
        data = payload or {}
        self._events.put({"event": event, "payload": data})
        if self._real_socketio is not None:
            try:
                target_room = (room or "").strip() or self._emit_room
                if target_room:
                    self._real_socketio.emit(event, data, room=target_room)
                else:
                    self._real_socketio.emit(event, data)
            except Exception:
                pass

    def drain(self) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        while True:
            try:
                items.append(self._events.get_nowait())
            except queue.Empty:
                break
        return items


def _build_harness_user_content(
    question: str,
    attachments: list[dict] | None,
    display_payload: dict | None,
    project_path: str,
) -> str | list:
    agent_question, image_parts = _prepare_agent_input(project_path, question, attachments or [])
    if image_parts:
        parts: list[dict[str, Any]] = [{"type": "text", "text": wrap_user_content(agent_question)}]
        for part in image_parts:
            inline = part.get("inlineData") or {}
            mime = inline.get("mimeType") or "image/png"
            data = inline.get("data") or ""
            if data:
                parts.append({
                    "type": "image_url",
                    "image_url": {"url": f"data:{mime};base64,{data}"},
                })
        if isinstance(display_payload, dict):
            for block in display_payload.get("segments") or []:
                if isinstance(block, dict):
                    parts.append(block)
        return parts
    if isinstance(display_payload, dict) and (
        display_payload.get("segments") or display_payload.get("attachments")
    ):
        content: list[Any] = [{"type": "text", "text": wrap_user_content(agent_question)}]
        for block in display_payload.get("segments") or []:
            if isinstance(block, dict):
                content.append(block)
        return content
    return wrap_user_content(agent_question)


def create_app():
    ensure_livecode_home_migrated()
    repo_root = Path(__file__).resolve().parents[2]
    app = Flask(
        __name__,
        template_folder=str(repo_root / "templates"),
        static_folder=str(repo_root / "static"),
        static_url_path="/static",
    )
    app.config["SECRET_KEY"] = os.environ.get("FLASK_SECRET_KEY", "live-code-dev-secret")
    from flask_socketio import SocketIO

    from livecode.socket_handlers import register_socket_handlers

    socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")
    register_socket_handlers(socketio)
    logger = logging.getLogger("livecode-minimal")

    @app.get("/")
    def index():
        return render_template("index.html")

    @app.get("/favicon.ico")
    def favicon():
        return "", 204

    @app.get("/asset/<path:filename>")
    def asset_alias(filename: str):
        from flask import send_from_directory

        directory = os.path.join(app.static_folder, "asset")
        return send_from_directory(directory, filename)

    @app.post("/socket-emit/<event>")
    def socket_emit(event: str):
        data = request.get_json(silent=True) or {}

        if event == "ide_list_files":
            raw_path = (data.get("path") or str(Path.home())).strip()
            target = os.path.abspath(os.path.expanduser(raw_path))
            if not os.path.isdir(target):
                return jsonify({
                    "response_event": "ide_files_list",
                    "payload": {"path": raw_path, "requested_path": raw_path, "error": "Folder not found: " + raw_path},
                })
            try:
                items = []
                for name in sorted(os.listdir(target), key=lambda n: (not os.path.isdir(os.path.join(target, n)), n.lower())):
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
                return jsonify({
                    "response_event": "ide_files_list",
                    "payload": {"path": target, "requested_path": raw_path, "files": items},
                })
            except Exception as exc:
                return jsonify({
                    "response_event": "ide_files_list",
                    "payload": {"path": target, "requested_path": raw_path, "error": str(exc)},
                })

        if event == "ide_read_file":
            file_path = os.path.abspath(os.path.expanduser((data.get("path") or "").strip()))
            try:
                with open(file_path, "r", encoding="utf-8", errors="replace") as handle:
                    content = handle.read()
                return jsonify({
                    "response_event": "ide_file_content",
                    "payload": {"path": file_path, "content": content},
                })
            except Exception as exc:
                return jsonify({
                    "response_event": "ide_file_content",
                    "payload": {"path": file_path, "error": str(exc)},
                })

        if event == "ide_write_file":
            file_path = os.path.abspath(os.path.expanduser((data.get("path") or "").strip()))
            try:
                with open(file_path, "w", encoding="utf-8") as handle:
                    handle.write(data.get("content") or "")
                return jsonify({
                    "response_event": "ide_file_saved",
                    "payload": {"path": file_path, "success": True},
                })
            except Exception as exc:
                return jsonify({
                    "response_event": "ide_file_saved",
                    "payload": {"path": file_path, "error": str(exc)},
                })

        if event == "ide_mkdir":
            base = os.path.abspath(os.path.expanduser((data.get("path") or str(Path.home())).strip()))
            name = (data.get("name") or "").strip()
            try:
                new_dir = os.path.join(base, name)
                os.makedirs(new_dir, exist_ok=True)
                return jsonify({
                    "response_event": "ide_mkdir_result",
                    "payload": {"path": new_dir, "success": True},
                })
            except Exception as exc:
                return jsonify({
                    "response_event": "ide_mkdir_result",
                    "payload": {"path": base, "error": str(exc)},
                })

        return jsonify({"response_event": event + "_result", "payload": {"error": "Unsupported event: " + event}})

    @app.route("/livecode/index", methods=["POST"])
    def livecode_build_index():

        data = request.get_json(silent=True) or {}
        project_path = (data.get("project_path") or "").strip()
        if not project_path:
            return jsonify({"error": "project_path required"}), 400
        try:
            index = build_workspace_index(project_path, force=bool(data.get("force")))
            return jsonify({
                "success": True,
                "file_count": index.get("file_count", 0),
                "summary": index_summary_text(index),
            })
        except Exception as e:
            logger.exception("livecode index error")
            return jsonify({"error": str(e)}), 500

    @app.route("/livecode/sessions", methods=["GET"])
    def livecode_list_sessions():

        project_path = (request.args.get("project_path") or "").strip()
        if not project_path:
            return jsonify({"error": "project_path required"}), 400
        expanded = os.path.abspath(os.path.expanduser(project_path))
        if not os.path.isdir(expanded):
            return jsonify({"error": f"Project path not found: {project_path}"}), 400
        try:
            limit = int(request.args.get("limit", 30))
        except (TypeError, ValueError):
            limit = 30
        try:
            sessions = list_sessions(expanded, limit=min(max(limit, 1), 100))
            return jsonify({"success": True, "sessions": sessions})
        except Exception as e:
            logger.exception("livecode list sessions error")
            return jsonify({"error": str(e)}), 500

    @app.route("/livecode/session", methods=["GET"])
    def livecode_load_session():

        project_path = (request.args.get("project_path") or "").strip()
        session_id = (request.args.get("session_id") or "").strip()
        if not project_path or not session_id:
            return jsonify({"error": "project_path and session_id required"}), 400
        expanded = os.path.abspath(os.path.expanduser(project_path))
        if not os.path.isdir(expanded):
            return jsonify({"error": f"Project path not found: {project_path}"}), 400
        try:
            session = load_session(expanded, session_id)
            diffs = load_diff_records(expanded, session_id)
            tool_artifacts = load_tool_artifacts(expanded, session_id)
            display_messages = format_messages_for_display(session.get("messages") or [], diffs, tool_artifacts)
            return jsonify({
                "success": True,
                "session_id": session_id,
                "summary": session.get("summary") or {},
                "messages": display_messages,
            })
        except Exception as e:
            logger.exception("livecode load session error")
            return jsonify({"error": str(e)}), 500

    @app.route("/livecode/project-storage", methods=["DELETE", "POST"])
    def livecode_delete_project_storage():

        data = request.get_json(silent=True) or {}
        project_path = (data.get("project_path") or "").strip()
        if not project_path:
            return jsonify({"error": "project_path required"}), 400
        try:
            deleted = delete_project_storage(project_path)
            return jsonify({"success": True, "deleted": deleted})
        except Exception as e:
            logger.exception("livecode delete project storage error")
            return jsonify({"error": str(e)}), 500

    @app.route("/livecode/permission", methods=["POST"])
    def livecode_resolve_permission():

        data = request.get_json(silent=True) or {}
        request_id = (data.get("request_id") or "").strip()
        if not request_id:
            return jsonify({"error": "request_id required"}), 400
        approved = bool(data.get("approved"))
        if not resolve_permission(request_id, approved):
            return jsonify({"error": "Unknown or expired permission request"}), 404
        return jsonify({"success": True, "approved": approved})

    @app.route("/livecode/interject", methods=["POST"])
    def livecode_interject():

        data = request.get_json(silent=True) or {}
        session_id = (data.get("session_id") or "").strip()
        message = (data.get("message") or "").strip()
        if not session_id or not message:
            return jsonify({"error": "session_id and message required"}), 400
        enqueue_interjection(session_id, message, interrupt=bool(data.get("interrupt")))
        return jsonify({"success": True})

    @app.route("/livecode/session/fork", methods=["POST"])
    def livecode_fork_session():

        data = request.get_json(silent=True) or {}
        project_path = (data.get("project_path") or "").strip()
        session_id = (data.get("session_id") or "").strip()
        new_session_id = (data.get("new_session_id") or "").strip()
        if not project_path or not session_id or not new_session_id:
            return jsonify({"error": "project_path, session_id, new_session_id required"}), 400
        try:
            session = fork_session(project_path, session_id, new_session_id)
            return jsonify({"success": True, "session_id": new_session_id, "message_count": len(session.get("messages") or [])})
        except Exception as e:
            return jsonify({"error": str(e)}), 400

    @app.route("/livecode/session/rewind", methods=["POST"])
    def livecode_rewind_session():

        data = request.get_json(silent=True) or {}
        project_path = (data.get("project_path") or "").strip()
        session_id = (data.get("session_id") or "").strip()
        message_index = data.get("message_index")
        if not project_path or not session_id or message_index is None:
            return jsonify({"error": "project_path, session_id, message_index required"}), 400
        try:
            kept = rewind_to_message(project_path, session_id, int(message_index))
            return jsonify({"success": True, "message_count": len(kept)})
        except Exception as e:
            return jsonify({"error": str(e)}), 400

    @app.route("/livecode/session-edits", methods=["GET"])
    def livecode_session_edits():
        project_path = (request.args.get("project_path") or "").strip()
        session_id = (request.args.get("session_id") or "").strip()
        if not project_path or not session_id:
            return jsonify({"error": "project_path and session_id required"}), 400
        return jsonify({
            "success": True,
            "snapshots": list_edit_snapshots(project_path, session_id),
        })

    @app.route("/livecode/rewind-file", methods=["POST"])
    def livecode_rewind_file():
        data = request.get_json(silent=True) or {}
        project_path = (data.get("project_path") or "").strip()
        session_id = (data.get("session_id") or "").strip()
        file_path = (data.get("file_path") or "").strip()
        if not project_path or not session_id or not file_path:
            return jsonify({"error": "project_path, session_id, file_path required"}), 400
        result = rewind_file_from_snapshot(project_path, session_id, file_path)
        if result.get("error"):
            return jsonify(result), 400
        return jsonify(result)

    @app.route("/livecode/session/rename", methods=["POST"])
    def livecode_rename_session():

        data = request.get_json(silent=True) or {}
        project_path = (data.get("project_path") or "").strip()
        session_id = (data.get("session_id") or "").strip()
        title = (data.get("title") or "").strip()
        if not project_path or not session_id or not title:
            return jsonify({"error": "project_path, session_id, and title required"}), 400
        expanded = os.path.abspath(os.path.expanduser(project_path))
        if not os.path.isdir(expanded):
            return jsonify({"error": f"Project path not found: {project_path}"}), 400
        try:
            if not rename_session(expanded, session_id, title):
                return jsonify({"error": "Session not found"}), 404
            return jsonify({"success": True, "session_id": session_id, "title": title[:200]})
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

    @app.route("/livecode/session/delete", methods=["POST"])
    def livecode_delete_session():

        data = request.get_json(silent=True) or {}
        project_path = (data.get("project_path") or "").strip()
        session_id = (data.get("session_id") or "").strip()
        if not project_path or not session_id:
            return jsonify({"error": "project_path and session_id required"}), 400
        expanded = os.path.abspath(os.path.expanduser(project_path))
        if not os.path.isdir(expanded):
            return jsonify({"error": f"Project path not found: {project_path}"}), 400
        if not delete_session(expanded, session_id):
            return jsonify({"error": "Session not found"}), 404
        return jsonify({"success": True, "session_id": session_id})

    @app.route("/livecode/context-search", methods=["GET"])
    def livecode_context_search():

        project_path = (request.args.get("project_path") or "").strip()
        query = (request.args.get("q") or "").strip()
        if not project_path:
            return jsonify({"error": "project_path required"}), 400
        expanded = os.path.abspath(os.path.expanduser(project_path))
        if not os.path.isdir(expanded):
            return jsonify({"error": f"Project path not found: {project_path}"}), 400
        try:
            limit = int(request.args.get("limit", 20))
        except (TypeError, ValueError):
            limit = 20
        directory = None
        if "directory" in request.args:
            directory = (request.args.get("directory") or "").strip()
        try:
            payload = search_context_targets(expanded, query, limit=limit, directory=directory)
            return jsonify(payload)
        except Exception as e:
            logger.exception("livecode context search error")
            return jsonify({"error": str(e)}), 500

    @app.route("/livecode/plans", methods=["GET"])
    def livecode_list_plans():

        project_path = (request.args.get("project_path") or "").strip()
        try:
            limit = max(1, min(int(request.args.get("limit", 200)), 500))
        except (TypeError, ValueError):
            limit = 200
        try:
            plans = list_plans(limit=limit, project_path=project_path)
            return jsonify({"ok": True, "plans": plans})
        except OSError as e:
            logger.exception("livecode list plans error")
            return jsonify({"ok": False, "error": str(e)}), 500

    @app.route("/livecode/plan-content", methods=["GET"])
    def livecode_plan_content():

        filename = (request.args.get("file") or "").strip()
        try:
            plan = read_plan(filename)
        except ValueError as e:
            return jsonify({"ok": False, "error": str(e)}), 400
        except FileNotFoundError:
            return jsonify({"ok": False, "error": "plan not found"}), 404
        except OSError as e:
            logger.exception("livecode plan content error")
            return jsonify({"ok": False, "error": str(e)}), 500
        return jsonify({
            "ok": True,
            "file": plan["file"],
            "title": plan["title"],
            "content": plan["body"],
            "raw": plan["content"],
            "meta": plan["meta"],
        })

    @app.route("/livecode/plan/save", methods=["POST"])
    def livecode_plan_save():

        data = request.get_json(silent=True) or {}
        filename = (data.get("file") or "").strip()
        if "content" not in data:
            return jsonify({"ok": False, "error": "content required"}), 400
        content = data.get("content")
        if content is None:
            content = ""
        content = str(content)
        try:
            existing = read_plan(filename)
        except ValueError as e:
            return jsonify({"ok": False, "error": str(e)}), 400
        except FileNotFoundError:
            return jsonify({"ok": False, "error": "plan not found"}), 404
        except OSError as e:
            logger.exception("livecode plan save read error")
            return jsonify({"ok": False, "error": str(e)}), 500
        meta = existing.get("meta") or {}
        title = (data.get("title") or existing.get("title") or "").strip() or "Untitled plan"
        try:
            saved = write_plan(
                content,
                title=title,
                project_path=meta.get("project_path") or "",
                session_id=meta.get("session_id") or "",
                filename=existing["file"],
            )
        except ValueError as e:
            return jsonify({"ok": False, "error": str(e)}), 400
        except OSError as e:
            logger.exception("livecode plan save error")
            return jsonify({"ok": False, "error": str(e)}), 500
        return jsonify({
            "ok": True,
            "file": saved["file"],
            "title": saved["title"],
            "content": saved["body"],
        })

    @app.route("/livecode/plan/save-to-workspace", methods=["POST"])
    def livecode_plan_save_to_workspace():

        data = request.get_json(silent=True) or {}
        filename = (data.get("file") or "").strip()
        project_path = (data.get("project_path") or "").strip()
        if not project_path:
            return jsonify({"ok": False, "error": "project_path required"}), 400
        expanded = os.path.abspath(os.path.expanduser(project_path))
        if not os.path.isdir(expanded):
            return jsonify({"ok": False, "error": f"Project path not found: {project_path}"}), 400
        try:
            plan = read_plan(filename)
        except ValueError as e:
            return jsonify({"ok": False, "error": str(e)}), 400
        except FileNotFoundError:
            return jsonify({"ok": False, "error": "plan not found"}), 404
        dest_dir = os.path.join(expanded, "docs", "plans")
        dest = os.path.join(dest_dir, plan["file"])
        try:
            os.makedirs(dest_dir, exist_ok=True)
            with open(dest, "w", encoding="utf-8") as f:
                f.write(plan["body"] + "\n")
        except OSError as e:
            return jsonify({"ok": False, "error": str(e)}), 500
        return jsonify({
            "ok": True,
            "file": plan["file"],
            "path": dest,
            "relative_path": os.path.relpath(dest, expanded).replace("\\", "/"),
        })

    @app.route("/livecode/plan/delete", methods=["POST"])
    def livecode_plan_delete():

        data = request.get_json(silent=True) or {}
        filename = (data.get("file") or "").strip()
        try:
            deleted = delete_plan(filename)
        except ValueError as e:
            return jsonify({"ok": False, "error": str(e)}), 400
        except OSError as e:
            return jsonify({"ok": False, "error": str(e)}), 500
        if not deleted:
            return jsonify({"ok": False, "error": "plan not found"}), 404
        return jsonify({"ok": True, "file": filename})

    @app.get("/settings")
    def get_settings():

        validate_keys = request.args.get("validate", "").strip().lower() in {"1", "true", "yes"}
        resp = jsonify(settings_for_display(load_settings(), validate_keys=validate_keys))
        resp.headers["Cache-Control"] = "no-store"
        return resp

    @app.post("/settings")
    def post_settings():

        data = request.get_json(silent=True) or {}
        current = load_settings()
        validation_error = _validate_settings_update(data, current)
        if validation_error:
            return jsonify({"error": validation_error}), 400
        try:
            saved = save_settings(data)
            resp = jsonify(settings_for_display(saved, validate_keys=True))
            resp.headers["Cache-Control"] = "no-store"
            return resp
        except OSError as exc:
            logger.exception("Failed to save settings to %s", SETTINGS_PATH)
            return jsonify({"error": f"Could not save settings: {exc}"}), 500

    @app.post("/livecode-agent")
    def livecode_agent():
        import uuid as _uuid

        from livecode.repo_tools import (
            create_diff_html,
            execute_command_pty_fn,
            repo_ast_fn,
            repo_grep_fn,
            repo_list_fn,
            repo_read_fn,
        )
        from livecode.runtime import (
            call_summarize,
            call_with_tools,
            is_agent_model,
            resolve_agent_model,
        )

        data = request.get_json(silent=True) or {}
        project_path = (data.get("project_path") or "").strip()
        question = (data.get("question") or "").strip()
        attachments = data.get("attachments") or []
        session_id = (data.get("session_id") or "").strip() or f"livecode_{_uuid.uuid4().hex}"
        user_model = (data.get("model") or "auto").strip() or "auto"
        socket_id = (data.get("socket_id") or "").strip()
        mode = (data.get("mode") or "agent").strip() or "agent"
        plan_file = (data.get("plan_file") or "").strip() or None
        display_payload = data.get("display_payload")

        if not project_path:
            return jsonify({"error": "Open a project folder first."}), 400
        if not question and not attachments:
            return jsonify({"error": "question required"}), 400
        expanded = os.path.abspath(os.path.expanduser(project_path))
        if not os.path.isdir(expanded):
            return jsonify({"error": f"Project path not found: {project_path}"}), 400

        settings = load_settings()
        if not settings.get("openai_api_key") and not settings.get("gemini_api_key"):
            return jsonify({
                "success": False,
                "error": "No LLM provider configured. Open Settings and add an OpenAI or Gemini API key.",
            }), 200

        user_content = _build_harness_user_content(
            question,
            attachments,
            display_payload if isinstance(display_payload, dict) else None,
            expanded,
        )

        def generate():
            bridge = SSEProgressBridge(real_socketio=socketio, emit_room=socket_id)
            answer = ""
            turn_messages: list[dict[str, Any]] = []
            session_title = ""
            resolved_model = resolve_agent_model(user_model)
            chunk_queue: queue.Queue[tuple[str, Any]] = queue.Queue()
            exc_holder: list[BaseException] = []

            def _yield_progress_items(items: list[dict[str, Any]]):
                for item in items:
                    event = item.get("event")
                    payload = item.get("payload") or {}
                    if event == "livecode_progress":
                        yield f"data: {json.dumps({'progress': payload})}\n\n"
                    elif event == "agent_command_stream":
                        yield f"data: {json.dumps({'command_stream': payload})}\n\n"

            def _run_turn() -> None:
                try:
                    for chunk in run_livecode_turn(
                        expanded,
                        question,
                        [],
                        user_content=user_content,
                        user_model=user_model,
                        call_with_tools=call_with_tools,
                        call_streaming=None,
                        call_summarize=call_summarize,
                        is_agent_model=is_agent_model,
                        repo_grep_fn=repo_grep_fn,
                        repo_read_fn=repo_read_fn,
                        repo_list_fn=repo_list_fn,
                        repo_ast_fn=repo_ast_fn,
                        create_diff_html_fn=create_diff_html,
                        execute_command_pty_fn=execute_command_pty_fn,
                        socketio=bridge,
                        session_id=session_id,
                        socket_id=socket_id,
                        logger=logger,
                        mode=mode,
                        plan_file=plan_file,
                        display_payload=display_payload if isinstance(display_payload, dict) else None,
                    ):
                        chunk_queue.put(("chunk", chunk))
                except Exception as exc:
                    exc_holder.append(exc)
                finally:
                    chunk_queue.put(("done", None))

            turn_thread = threading.Thread(target=_run_turn, daemon=True)
            turn_thread.start()
            turn_finished = False

            try:
                while not turn_finished:
                    yield from _yield_progress_items(bridge.drain())
                    try:
                        kind, payload = chunk_queue.get(timeout=0.05)
                    except queue.Empty:
                        continue
                    if kind == "done":
                        turn_finished = True
                        break
                    chunk = payload
                    yield from _yield_progress_items(bridge.drain())
                    if not chunk.startswith("data: "):
                        continue
                    try:
                        payload = json.loads(chunk[6:].strip())
                    except json.JSONDecodeError:
                        yield chunk
                        continue
                    if payload.get("error"):
                        yield chunk
                        return
                    if payload.get("done"):
                        answer = payload.get("answer") or answer
                        turn_messages = payload.get("turn_messages") or turn_messages
                        yield chunk
                        break
                    yield chunk
                yield from _yield_progress_items(bridge.drain())
                if exc_holder:
                    raise exc_holder[0]
            except Exception as exc:
                logger.exception("Agent turn failed")
                yield f"data: {json.dumps({'error': str(exc)})}\n\n"
                return

            if turn_messages:
                append_turn_messages(
                    expanded,
                    session_id,
                    turn_messages,
                    model=resolved_model,
                    title=(question or "")[:200] or None,
                )
            elif answer:
                try:
                    existing = load_session(expanded, session_id)
                    has_title = bool((existing.get("summary") or {}).get("title"))
                except Exception:
                    has_title = False
                if not has_title:
                    session_title = " ".join(question.split()[:7]).title()[:80] or "New LiveCode Chat"
                    set_session_title(expanded, session_id, session_title, overwrite=True)
                append_turn_summary(
                    expanded,
                    session_id,
                    question,
                    answer,
                    model=resolved_model,
                    title=session_title or None,
                    display=display_payload if isinstance(display_payload, dict) else None,
                )

            provider, model_used = _resolve_provider_and_model(settings, question, user_model)
            yield f"data: {json.dumps({'meta': {'session_id': session_id, 'session_title': session_title or None, 'provider': provider, 'model': model_used or resolved_model}})}\n\n"

        return Response(
            stream_with_context(generate()),
            mimetype="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    return app, socketio


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    port = int(os.environ.get("PORT", "9191"))
    _app, _socketio = create_app()
    _socketio.run(_app, host="127.0.0.1", port=port, debug=True, allow_unsafe_werkzeug=True)
