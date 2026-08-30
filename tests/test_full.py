"""Full integration and unit tests for LiveCode / Live Code."""
from __future__ import annotations

import json
import os
import unittest
from pathlib import Path
from unittest.mock import MagicMock, mock_open, patch

import requests

ROOT = Path(__file__).resolve().parents[1]

import livecode as livecode_app  # noqa: E402
import livecode.llm_providers as llm_providers  # noqa: E402
import livecode.server as livecode_server  # noqa: E402
import livecode.repo_tools as repo_tools  # noqa: E402
import livecode.runtime as runtime  # noqa: E402

BASE_URL = os.environ.get("LIVE_CODE_TEST_URL", "http://127.0.0.1:5050")
PROJECT_PATH = str(ROOT)


def _parse_sse_payloads(text: str) -> list[dict]:
    payloads: list[dict] = []
    for line in (text or "").splitlines():
        if not line.startswith("data: "):
            continue
        try:
            payloads.append(json.loads(line[6:]))
        except json.JSONDecodeError:
            continue
    return payloads


def _final_sse_payload(text: str) -> dict:
    payloads = _parse_sse_payloads(text)
    result: dict = {}
    for item in payloads:
        if item.get("error"):
            result = item
        elif item.get("done"):
            result = item
        elif item.get("meta"):
            result.update(item["meta"])
    return result


class GeminiRoleTests(unittest.TestCase):
    def test_function_response_uses_user_role(self):
        captured: list[dict] = []

        def fake_call(_api_key, _model, contents, **_kwargs):
            captured.append({"contents": json.loads(json.dumps(contents))})
            if len(captured) == 1:
                return {
                    "candidates": [{
                        "content": {
                            "parts": [{
                                "functionCall": {
                                    "name": "list_dir",
                                    "args": {"path": ""},
                                }
                            }]
                        }
                    }]
                }
            return {
                "candidates": [{
                    "content": {
                        "parts": [{"text": "This is a Python project."}]
                    }
                }]
            }

        with patch.object(llm_providers, "_call_gemini", side_effect=fake_call):
            answer, model_used = livecode_app._run_gemini_turn(
                PROJECT_PATH, "what is the project", "test-key", "gemini-2.5-flash"
            )

        self.assertIn("Python project", answer)
        self.assertEqual(model_used, "gemini-2.5-flash")
        self.assertEqual(len(captured), 2)
        function_turn = captured[1]["contents"][-1]
        self.assertEqual(function_turn["role"], "user")
        self.assertIn("functionResponse", function_turn["parts"][0])
        self.assertNotIn("function", {m["role"] for m in captured[1]["contents"]})


class ToolTests(unittest.TestCase):
    def test_list_dir_root(self):
        result = livecode_app._run_tool(PROJECT_PATH, "list_dir", {"path": ""})
        self.assertIn("entries", result)
        names = {e["name"] for e in result["entries"]}
        self.assertIn("pyproject.toml", names)
        self.assertIn("src", names)

    def test_read_file_readme(self):
        result = livecode_app._run_tool(PROJECT_PATH, "read_file", {"path": "README.md", "start_line": 1, "end_line": 5})
        self.assertIn("content", result)
        self.assertIn("Live Code", result["content"])

    def test_grep_pattern(self):
        result = livecode_app._run_tool(PROJECT_PATH, "grep", {"pattern": "create_app", "glob": "*.py"})
        self.assertIn("matches", result)
        self.assertTrue(len(result["matches"]) >= 1)


class RepoToolsTests(unittest.TestCase):
    def test_create_diff_html_returns_tuple(self):
        diff_html, plain, additions, deletions = repo_tools.create_diff_html("a\nb", "a\nc\n")
        self.assertIn("diff-block-wrapper", diff_html)
        self.assertIn("diff-line-sign-added", diff_html)
        self.assertIn("diff-line-gutter-bar", diff_html)
        self.assertNotRegex(diff_html, r'diff-line-content[^>]*>\+')
        self.assertGreaterEqual(additions, 1)
        self.assertGreaterEqual(deletions, 1)
        self.assertIn("---", plain)

    def test_create_diff_html_compact_single_hunk(self):
        old_lines = [f"line {i}" for i in range(1, 51)]
        old_lines[39] = "old text"
        new_lines = old_lines[:]
        new_lines[39] = "new text"
        old = "\n".join(old_lines)
        new = "\n".join(new_lines)
        diff_html, _plain, additions, deletions = repo_tools.create_diff_html(old, new)
        self.assertEqual(additions, 1)
        self.assertEqual(deletions, 1)
        row_count = diff_html.count("diff-line-wrapper")
        self.assertLess(row_count, 20)
        self.assertNotIn('data-start-line="1"', diff_html)
        self.assertIn('data-start-line="37"', diff_html)
        self.assertIn('data-additions="1"', diff_html)
        self.assertIn('data-deletions="1"', diff_html)

    def test_create_diff_html_multiple_hunks(self):
        old_lines = [f"line {i}" for i in range(1, 201)]
        new_lines = old_lines[:]
        new_lines[9] = "changed near top"
        new_lines[149] = "changed near bottom"
        old = "\n".join(old_lines)
        new = "\n".join(new_lines)
        diff_html, _plain, additions, deletions = repo_tools.create_diff_html(old, new)
        self.assertEqual(additions, 2)
        self.assertEqual(deletions, 2)
        self.assertEqual(diff_html.count("diff-block-wrapper"), 2)
        self.assertIn('data-start-line="7"', diff_html)
        self.assertIn('data-start-line="147"', diff_html)

    def test_create_diff_html_per_hunk_stats(self):
        old_lines = [f"line {i}" for i in range(1, 51)]
        new_lines = old_lines[:]
        new_lines[4] = "changed first"
        new_lines[44] = "changed second"
        old = "\n".join(old_lines)
        new = "\n".join(new_lines)
        diff_html, _plain, additions, deletions = repo_tools.create_diff_html(old, new)
        self.assertEqual(additions, 2)
        self.assertEqual(deletions, 2)
        wrappers = diff_html.split('<div class="diff-block-wrapper"')[1:]
        self.assertEqual(len(wrappers), 2)
        for chunk in wrappers:
            self.assertRegex(chunk, r'data-additions="1"')
            self.assertRegex(chunk, r'data-deletions="1"')

    def test_repo_read_numbered_lines(self):
        result = repo_tools.repo_read_fn(PROJECT_PATH, "README.md", 1, 3)
        self.assertTrue(result.get("success"))
        self.assertIn("1|", result.get("content", ""))

    def test_repo_grep_create_app(self):
        result = repo_tools.repo_grep_fn(PROJECT_PATH, "create_app", "*.py", 10, "")
        if result.get("error") == "ripgrep (rg) not installed":
            self.skipTest("ripgrep not installed")
        self.assertTrue(result.get("success"))
        self.assertGreaterEqual(result.get("match_count", 0), 1)


class RuntimeTests(unittest.TestCase):
    def test_resolve_agent_model_auto(self):
        with patch.object(runtime, "_load_settings", return_value={
            "gemini_api_key": "test-key",
            "openai_api_key": "",
            "provider": "gemini",
        }):
            model = runtime.resolve_agent_model("auto")
        self.assertEqual(model, livecode_app.GEMINI_FAST_MODEL)

    def test_is_agent_model_with_key(self):
        with patch.object(runtime, "_load_settings", return_value={"gemini_api_key": "test-key"}):
            self.assertTrue(runtime.is_agent_model("gemini-2.5-flash"))

    @patch.object(runtime, "_gemini_call")
    def test_call_with_tools_gemini(self, mock_gemini):
        mock_gemini.return_value = {"content": "done", "tool_calls": None, "reasoning_content": ""}
        with patch.object(runtime, "_load_settings", return_value={
            "gemini_api_key": "test-key",
            "openai_api_key": "",
        }):
            with patch.object(runtime, "_infer_provider", return_value="gemini"):
                with patch.object(runtime, "resolve_agent_model", return_value="gemini-2.5-flash"):
                    resp = runtime.call_with_tools(
                        "auto",
                        [{"role": "user", "content": "hello"}],
                        [],
                    )
        self.assertEqual(resp["content"], "done")

    def test_parse_gemini_response_captures_thought_signature(self):
        parsed = runtime._parse_gemini_response({
            "candidates": [{
                "content": {
                    "parts": [{
                        "functionCall": {"name": "run_command", "args": {"command": "git status"}},
                        "thought_signature": "sig123",
                    }]
                }
            }]
        })
        self.assertEqual(parsed["tool_calls"][0]["thought_signature"], "sig123")

    def test_parse_gemini_response_captures_thought_parts(self):
        parsed = runtime._parse_gemini_response({
            "candidates": [{
                "content": {
                    "parts": [
                        {"text": "internal reasoning", "thought": True},
                        {"text": "visible answer"},
                    ]
                }
            }]
        })
        self.assertEqual(parsed["reasoning_content"], "internal reasoning")
        self.assertEqual(parsed["content"], "visible answer")

    def test_openai_streaming_emits_thought_delta(self):
        sse_lines = [
            "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"Planning\"}}]}",
            "data: {\"choices\":[{\"delta\":{\"content\":\" answer\"}}]}",
            "data: [DONE]",
        ]
        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()
        mock_resp.iter_lines = MagicMock(side_effect=lambda decode_unicode=True: iter(sse_lines))

        deltas: list[str] = []
        with patch("livecode.runtime.requests.post", return_value=mock_resp):
            result = runtime._openai_call_streaming(
                "gpt-4o",
                [{"role": "user", "content": "hi"}],
                [],
                api_key="test-key",
                on_thought_delta=deltas.append,
            )
        self.assertEqual(deltas, ["Planning", " answer"])
        self.assertEqual(result["reasoning_content"], "Planning")
        self.assertEqual(result["content"], " answer")

    @patch.object(runtime, "_gemini_call_streaming")
    def test_call_with_tools_passes_on_thought_delta(self, mock_stream):
        mock_stream.return_value = {
            "content": "ok",
            "tool_calls": None,
            "reasoning_content": "think",
        }
        deltas: list[str] = []
        with patch.object(runtime, "_load_settings", return_value={
            "gemini_api_key": "test-key",
            "openai_api_key": "",
        }):
            with patch.object(runtime, "_infer_provider", return_value="gemini"):
                with patch.object(runtime, "resolve_agent_model", return_value="gemini-2.5-flash"):
                    resp = runtime.call_with_tools(
                        "auto",
                        [{"role": "user", "content": "hello"}],
                        [],
                        on_thought_delta=deltas.append,
                    )
        mock_stream.assert_called_once()
        cb = mock_stream.call_args.kwargs.get("on_thought_delta")
        self.assertTrue(callable(cb))
        cb("hello")
        self.assertEqual(deltas, ["hello"])
        self.assertEqual(resp["content"], "ok")
        self.assertEqual(resp["reasoning_content"], "think")

    def test_gemini_contents_preserves_thought_signature(self):
        _, contents = runtime._gemini_contents([
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [{
                    "id": "call_abc",
                    "type": "function",
                    "function": {
                        "name": "run_command",
                        "arguments": '{"command": "git status"}',
                    },
                    "thought_signature": "sig123",
                }],
            },
            {
                "role": "tool",
                "tool_call_id": "call_abc",
                "name": "run_command",
                "content": '{"result": "ok"}',
            },
        ])
        first_part = contents[0]["parts"][0]
        self.assertEqual(first_part.get("thought_signature"), "sig123")
        self.assertEqual(first_part["functionCall"]["name"], "run_command")


class AgentEndpointTests(unittest.TestCase):
    def test_livecode_agent_streams_sse(self):
        app, _socketio = livecode_app.create_app()
        app.config["TESTING"] = True

        def fake_turn(*_args, **_kwargs):
            yield 'data: {"done": true, "answer": "Harness answer", "turn_messages": []}\n\n'

        with patch.object(livecode_server, "run_livecode_turn", side_effect=fake_turn):
            with patch.object(llm_providers, "load_settings", return_value={
                "gemini_api_key": "test-key",
                "openai_api_key": "",
                "provider": "gemini",
            }):
                client = app.test_client()
                resp = client.post(
                    "/livecode-agent",
                    json={"project_path": PROJECT_PATH, "question": "hello"},
                )
        self.assertEqual(resp.status_code, 200)
        self.assertIn("text/event-stream", resp.content_type)
        final = _final_sse_payload(resp.get_data(as_text=True))
        self.assertEqual(final.get("answer"), "Harness answer")

    def test_livecode_agent_sse_no_legacy_branding(self):
        app, _socketio = livecode_app.create_app()
        app.config["TESTING"] = True

        def fake_error_turn(*_args, **_kwargs):
            yield 'data: {"error": "Agent model not configured", "done": true}\n\n'

        with patch.object(livecode_server, "run_livecode_turn", side_effect=fake_error_turn):
            with patch.object(llm_providers, "load_settings", return_value={
                "gemini_api_key": "",
                "openai_api_key": "",
                "provider": "gemini",
            }):
                client = app.test_client()
                resp = client.post(
                    "/livecode-agent",
                    json={"project_path": PROJECT_PATH, "question": "hello"},
                )
        body = resp.get_data(as_text=True).lower()
        self.assertNotIn("workbench", body)
        self.assertNotIn("azure", body)


class SettingsLogicTests(unittest.TestCase):
    def test_save_settings_preserves_provider_when_omitted(self):
        current = {
            "provider": "gemini",
            "openai_api_key": "",
            "openai_model": "",
            "gemini_api_key": "existing-key",
            "gemini_model": "",
        }
        with patch.object(llm_providers, "load_settings", return_value=dict(current)):
            with patch.object(livecode_app, "ensure_livecode_home_migrated"):
                with patch.object(llm_providers, "SETTINGS_PATH", Path("/tmp/livecode-test-settings.json")):
                    with patch("builtins.open", mock_open()):
                        with patch.object(os, "makedirs"):
                            with patch.object(os, "chmod"):
                                saved = livecode_app.save_settings({"gemini_api_key": "new-key-value"})
        self.assertEqual(saved["provider"], "gemini")
        self.assertEqual(saved["gemini_api_key"], "new-key-value")

    def test_gemini_alias_maps_to_stable_model(self):
        models = livecode_app._gemini_models_to_try("gemini-flash-latest")
        self.assertEqual(models[0], livecode_app.GEMINI_FAST_MODEL)
        self.assertIn(livecode_app.GEMINI_LITE_MODEL, models)

    def test_model_options_with_gemini_key(self):
        options = livecode_app.model_options_for_settings({
            "gemini_api_key": "AQ.test-key",
            "openai_api_key": "",
        })
        values = [o["value"] for o in options]
        self.assertIn("auto", values)
        self.assertIn(livecode_app.GEMINI_FAST_MODEL, values)
        self.assertIn(livecode_app.GEMINI_LITE_MODEL, values)
        auto_opt = next(o for o in options if o["value"] == "auto")
        self.assertEqual(auto_opt["label"], "Auto")
        flash_opt = next(o for o in options if o["value"] == livecode_app.GEMINI_FAST_MODEL)
        self.assertEqual(flash_opt["label"], "Gemini 3.7 Flash")
        self.assertNotIn("(Agent)", flash_opt["label"])
        self.assertNotIn("(Flagship)", flash_opt["label"])

    def test_model_options_with_both_providers(self):
        options = livecode_app.model_options_for_settings({
            "openai_api_key": "sk-test",
            "gemini_api_key": "AQ.test-key",
        })
        values = [o["value"] for o in options]
        self.assertIn(livecode_app.OPENAI_FAST_MODEL, values)
        self.assertIn(livecode_app.GEMINI_FAST_MODEL, values)
        auto_opt = next(o for o in options if o["value"] == "auto")
        self.assertEqual(auto_opt["label"], "Auto")

    def test_auto_routes_to_only_configured_provider(self):
        provider, model = livecode_app._resolve_auto_provider_and_model(
            {"gemini_api_key": "AQ.test-key", "openai_api_key": ""},
            "hello",
        )
        self.assertEqual(provider, "gemini")
        self.assertEqual(model, livecode_app.GEMINI_FAST_MODEL)

    def test_auto_routes_complex_to_gemini_pro_when_both_configured(self):
        long_question = "x" * 300
        provider, model = livecode_app._resolve_auto_provider_and_model(
            {"openai_api_key": "sk-test", "gemini_api_key": "AQ.test-key"},
            long_question,
        )
        self.assertEqual(provider, "gemini")
        self.assertEqual(model, livecode_app.GEMINI_STRONG_MODEL)

    def test_auto_routes_simple_to_gemini_when_both_configured(self):
        provider, model = livecode_app._resolve_auto_provider_and_model(
            {"openai_api_key": "sk-test", "gemini_api_key": "AQ.test-key"},
            "hello",
        )
        self.assertEqual(provider, "gemini")
        self.assertEqual(model, livecode_app.GEMINI_FAST_MODEL)


class HttpIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            r = requests.get(BASE_URL, timeout=3)
            cls.server_up = r.status_code == 200
        except requests.RequestException:
            cls.server_up = False

    def setUp(self):
        if not self.server_up:
            self.skipTest(f"Server not running at {BASE_URL}")

    def test_home_page(self):
        r = requests.get(BASE_URL, timeout=10)
        self.assertEqual(r.status_code, 200)
        self.assertIn("LiveCode", r.text)

    def test_static_assets(self):
        for path in ("/static/css/bundle.css", "/static/js/bundle.js", "/static/js/markdown-pdf.js"):
            r = requests.get(BASE_URL + path, timeout=10)
            self.assertEqual(r.status_code, 200, path)
            self.assertTrue(len(r.content) > 1000, path)

    def test_settings_get(self):
        r = requests.get(BASE_URL + "/settings", timeout=30)
        self.assertEqual(r.status_code, 200)
        data = r.json()
        for key in ("provider", "openai_api_key", "gemini_api_key", "model_options"):
            self.assertIn(key, data)

    def test_settings_post_invalid_openai_key(self):
        r = requests.post(
            BASE_URL + "/settings",
            json={"openai_api_key": "sk-invalid-test-key-12345"},
            timeout=30,
        )
        self.assertEqual(r.status_code, 400)
        self.assertIn("error", r.json())

    def test_livecode_agent_validation(self):
        r = requests.post(BASE_URL + "/livecode-agent", json={}, timeout=10)
        self.assertEqual(r.status_code, 400)

        r = requests.post(
            BASE_URL + "/livecode-agent",
            json={"project_path": PROJECT_PATH},
            timeout=10,
        )
        self.assertEqual(r.status_code, 400)

        r = requests.post(
            BASE_URL + "/livecode-agent",
            json={"question": "hello"},
            timeout=10,
        )
        self.assertEqual(r.status_code, 400)

    def test_livecode_sessions_and_plans(self):
        r = requests.get(
            BASE_URL + "/livecode/sessions",
            params={"project_path": PROJECT_PATH},
            timeout=10,
        )
        self.assertEqual(r.status_code, 200)
        self.assertIn("sessions", r.json())

        r = requests.get(BASE_URL + "/livecode/plans", timeout=10)
        self.assertEqual(r.status_code, 200)
        self.assertIn("plans", r.json())

    def test_index_html_has_simplified_settings(self):
        r = requests.get(BASE_URL, timeout=10)
        html = r.text
        self.assertIn("app-settings-openai-key", html)
        self.assertIn("app-settings-gemini-key", html)
        self.assertNotIn("app-settings-provider", html)
        self.assertNotIn("app-settings-openai-model", html)
        self.assertNotIn("app-settings-gemini-model", html)


class LiveAgentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            r = requests.get(BASE_URL, timeout=3)
            cls.server_up = r.status_code == 200
        except requests.RequestException:
            cls.server_up = False
        settings = livecode_app.load_settings()
        cls.has_gemini = bool((settings.get("gemini_api_key") or "").strip())
        cls.has_openai = bool((settings.get("openai_api_key") or "").strip())

    def setUp(self):
        if not self.server_up:
            self.skipTest(f"Server not running at {BASE_URL}")
        if not self.has_gemini and not self.has_openai:
            self.skipTest("No LLM API key configured in ~/livecode/settings.json")

    def test_what_is_the_project(self):
        models_to_try = []
        if self.has_gemini:
            models_to_try.extend(["gemini-flash-latest", "gemini-pro-latest", "auto"])
        if self.has_openai:
            models_to_try.append("gpt-4o-mini")

        last_error = ""
        for model in models_to_try:
            r = requests.post(
                BASE_URL + "/livecode-agent",
                json={
                    "project_path": PROJECT_PATH,
                    "question": "what is the project",
                    "model": model,
                },
                timeout=120,
                stream=True,
            )
            self.assertEqual(r.status_code, 200)
            body = r.text
            data = _final_sse_payload(body)
            if data.get("error"):
                last_error = data.get("error") or str(data)
                transient = any(
                    phrase in last_error.lower()
                    for phrase in ("high demand", "rate limit", "quota", "try again", "overloaded")
                )
                if not transient:
                    self.fail(last_error)
                continue
            if data.get("answer"):
                self.assertTrue((data.get("answer") or "").strip())
                err = (data.get("error") or "").lower()
                self.assertNotIn("role 'function'", err)
                self.assertNotIn("is not supported", err)
                return
            last_error = data.get("error") or body[:300]

        self.skipTest(f"Live agent unavailable after retries: {last_error}")


class HarnessAlignmentTests(unittest.TestCase):
    def test_heuristic_file_edit_prompt(self):
        q = "updated 404.html make it cleaner"
        h = livecode_app.heuristic_classification(q, has_prior_turns=False)
        self.assertIsNotNone(h)
        self.assertEqual(h.get("goal_kind"), "code_change")
        self.assertFalse(h.get("chat_only"))
        self.assertEqual(h.get("edit_scope"), "single_file")
        normalized = livecode_app.normalize_livecode_classification(q, h, has_prior_turns=False)
        self.assertEqual(livecode_app.pick_tool_choice(1, normalized, q), "required")

    def test_looks_like_file_edit_negative(self):
        self.assertFalse(livecode_app.looks_like_file_edit("hello"))

    def test_apply_search_replace_batch_non_overlapping(self):
        import tempfile

        def fake_diff(a, b, ext):
            return "<diff>", "", 1, 1

        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "t.txt")
            with open(path, "w") as f:
                f.write("aaa bbb ccc\n")
            result = livecode_app.apply_search_replace_batch(
                path, "t.txt",
                [("aaa", "AAA", False), ("ccc", "CCC", False)],
                fake_diff,
            )
            self.assertTrue(result.get("success"))
            with open(path) as f:
                self.assertEqual(f.read(), "AAA bbb CCC\n")

    def test_apply_search_replace_batch_overlap_aborts(self):
        import tempfile

        def fake_diff(a, b, ext):
            return "<diff>", "", 1, 1

        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "t.txt")
            original = "hero start\nline2\nhero end\n"
            with open(path, "w") as f:
                f.write(original)
            result = livecode_app.apply_search_replace_batch(
                path, "t.txt",
                [("line2", "LINE2", False), ("hero start\nline2\nhero end", "BLOCK", False)],
                fake_diff,
            )
            self.assertEqual(result.get("error_kind"), "no_matches")
            with open(path) as f:
                self.assertEqual(f.read(), original)

    def test_unicode_confusable_edit(self):
        import tempfile

        def fake_diff(a, b, ext):
            return "<diff>", "", 1, 1

        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "q.txt")
            with open(path, "w") as f:
                f.write('say "hello"\n')
            result = livecode_app.apply_search_replace(
                path, "q.txt", '"hello"', '"world"', fake_diff,
            )
            self.assertTrue(result.get("success"), result)
            with open(path) as f:
                self.assertIn("world", f.read())

    def test_concatenated_json_tool_args(self):
        raw = '{"file_path": "a.py"}{"file_path": "b.py"}'
        parsed, err = livecode_app.parse_livecode_tool_arguments("edit_file", raw)
        self.assertIsNone(err)
        self.assertEqual(parsed.get("file_path"), "a.py")

    def test_plan_mode_edit_gate_blocks_non_plan_file(self):
        msg = livecode_app.plan_mode_edit_gate(
            "plan",
            "edit_file",
            {"file_path": "404.html"},
            project_path=PROJECT_PATH,
            session_id="test_session",
        )
        self.assertIsNotNone(msg)
        self.assertIn("404.html", msg)

    def test_detect_tail_repetition(self):
        repeated = "\n".join(["I'll update the file now."] * 5)
        self.assertTrue(livecode_app.detect_tail_repetition(repeated))

    def test_edit_snapshot_and_rewind(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            session_id = "snap_test"
            fpath = "foo.txt"
            full = os.path.join(tmp, fpath)
            with open(full, "w") as f:
                f.write("before\n")
            livecode_app.record_edit_snapshot(
                tmp, session_id, fpath, "before\n", "after\n",
            )
            snaps = livecode_app.list_edit_snapshots(tmp, session_id)
            self.assertEqual(len(snaps), 1)
            self.assertTrue(snaps[0].get("rewindable"))
            result = livecode_app.rewind_file_from_snapshot(tmp, session_id, fpath)
            self.assertTrue(result.get("success"))
            with open(full) as f:
                self.assertEqual(f.read(), "before\n")

    def test_lock_path_for_args(self):
        fp = livecode_app._lock_path_for_args(
            "edit_file", {"file_path": "src/main.py"},
        )
        self.assertEqual(fp, "src/main.py")


if __name__ == "__main__":
    unittest.main(verbosity=2)
