"""Run Live Code: ``python -m livecode`` or ``livecode`` after editable install."""
from __future__ import annotations

import logging
import os

from livecode.server import create_app


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    host = os.environ.get("LIVE_CODE_HOST", "127.0.0.1")
    port = int(os.environ.get("LIVE_CODE_PORT", os.environ.get("PORT", "5050")))
    debug = os.environ.get("FLASK_DEBUG", "1") == "1"
    app, socketio = create_app()
    print(f"Live Code running at http://{host}:{port}/")
    socketio.run(app, host=host, port=port, debug=debug, allow_unsafe_werkzeug=True)


if __name__ == "__main__":
    main()
