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

## How to use

### 1. Add an API key

Before chatting with the agent, add at least one LLM provider key:

1. Open Live Code in your browser.
2. Click the **gear icon** (Settings) in the top-right of the chat panel.
3. In **LLM Settings**, paste either:
   - an **OpenAI** key (`sk-...`) from [platform.openai.com/api-keys](https://platform.openai.com/api-keys), or
   - a **Gemini** key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
4. Click **Save**. Live Code validates the key and stores it locally at `~/livecode/settings.json` (never in this repo).

You can add both keys. If both are set, use the **model dropdown** next to the chat box to pick a provider/model, or choose **Auto** to let Live Code route requests.

### 2. Open a project

1. Click **Open Folder…** in the left sidebar (or the welcome screen).
2. Choose a local project directory.
3. The file explorer loads so the agent can read, search, edit, and run commands in that folder.

### 3. Chat with the agent

1. Type a task in the chat box at the bottom (for example: “Add a health check endpoint”).
2. Pick a mode if needed:
   - **Agent** — reads/edits files and runs commands
   - **Plan** — drafts a plan before building
   - **Ask** — answers questions without making changes
3. Press **Enter** or click send. Approve shell commands when prompted.

Recent projects and chat sessions are saved under `~/livecode/projects/`.

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

Issues and pull requests are welcome.

## Security

- API keys and session data live outside the repo (`~/livecode/`).
- `.env` files are gitignored; only `.env.example` is tracked.
- Do not commit real credentials. Set `FLASK_SECRET_KEY` before exposing the server publicly.

## License

[MIT](LICENSE)
