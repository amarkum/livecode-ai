"""LiveCode backend package."""
from __future__ import annotations

import importlib
import pkgutil

from livecode._deps import load_prior

load_prior("livecode.server", globals())

from livecode.server import create_app


def _reexport_submodules() -> None:
    import livecode as pkg

    g = globals()
    for info in pkgutil.walk_packages(pkg.__path__, pkg.__name__ + "."):
        if info.name.endswith("__main__"):
            continue
        mod = importlib.import_module(info.name)
        for name, value in vars(mod).items():
            if name.startswith("__"):
                continue
            g.setdefault(name, value)


_reexport_submodules()
