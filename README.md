# Live Code

Browser-based AI coding IDE with a Monaco editor, integrated terminal, and an agent that reads, searches, edits, and runs commands in local projects.

**Repository:** https://github.com/amarkum/livecode-ai

## Quick start

```bash
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
python -m livecode
```

Open **http://127.0.0.1:5050/**

Add an OpenAI or Gemini API key in the in-app **Settings** panel. Keys are stored locally at `~/livecode/settings.json` (not in this repo).

## Features

- **Agent mode** — tool loop with read, grep, edit, write, shell, git log, and subagents
- **Plan / Ask / Agent modes** — switch how the assistant behaves
- **Live progress UI** — streaming thoughts, tool activity feed, diffs, and command output
- **Permission prompts** — approve or deny destructive shell commands before they run
- **Monaco editor** — multi-tab editing with syntax highlighting
- **Integrated terminal** — shell in the project directory
- **Session persistence** — chat history under `~/livecode/projects/`
- **Multi-provider LLM** — OpenAI and Gemini with auto-routing
- **Modular harness** — transient retry, length salvage, interjection framing, optional todo gate

## Project structure

```
livecode-ai/
├── pyproject.toml
├── src/livecode/       # Python package
├── templates/          # Flask HTML
├── static/             # Frontend assets
└── tests/
```

| Path | Purpose |
|------|---------|
| `src/livecode/server.py` | Flask routes and SSE agent endpoint |
| `src/livecode/harness/` | Agent turn loop and sampler modules |
| `src/livecode/runtime.py` | LLM streaming and provider helpers |
| `src/livecode/repo_tools.py` | Repository read/grep/diff implementations |
| `src/livecode/socket_handlers.py` | Socket.IO terminal and file browser |
| `src/livecode/tools.py` | Tool definitions and execution |
| `src/livecode/llm_providers.py` | Settings, model routing, provider calls |
| `src/livecode/session.py` | Chat session persistence |
| `src/livecode/memory/` | Codebase memory index and retrieval |

Run with `python -m livecode` or the `livecode` console script after editable install.

## Environment

Copy `.env.example` to `.env` if you want local overrides:

| Variable | Default | Description |
|----------|---------|-------------|
| `LIVE_CODE_HOST` | `127.0.0.1` | Bind address |
| `LIVE_CODE_PORT` | `5050` | HTTP port |
| `FLASK_DEBUG` | `1` | Flask debug mode |
| `FLASK_SECRET_KEY` | `live-code-dev-secret` | Flask session secret (set in production) |
| `LIVECODE_TODO_GATE` | — | Set to `1` to nudge the agent when todos remain open at turn end |
| `TAVILY_API_KEY` | — | Optional web search provider |
| `SERPER_API_KEY` | — | Optional web search provider |
| `LIVECODE_HOME` | `~/livecode` | Data directory for settings and sessions |

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Main IDE page |
| POST | `/livecode-agent` | Agent turn (SSE) |
| GET | `/livecode/sessions` | List chat sessions |
| GET/POST | `/settings` | LLM provider settings |
| POST | `/livecode/permission` | Approve or deny a tool permission |
| POST | `/livecode/interject` | Mid-turn user message (`interrupt: true` for cancel framing) |

## Requirements

- Python 3.10+
- [ripgrep](https://github.com/BurntSushi/ripgrep) (`rg`) for code search in the agent
- OpenAI and/or Gemini API key (configured in app settings)

## Tests

```bash
pip install -e ".[dev]"
python -m pytest tests/ -q
```

## Contributing

Issues and pull requests are welcome. Run the test suite before submitting changes.

## Security

- API keys and session data live outside the repo (`~/livecode/`).
- `.env` files are gitignored; only `.env.example` is tracked.
- Do not commit real credentials. Set `FLASK_SECRET_KEY` before exposing the server publicly.

## License

[MIT](LICENSE)
