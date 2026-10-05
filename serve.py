"""Serve Ropon Radar locally with caching disabled, so edits always show up.

Usage:  python serve.py [port]      (default 8000), then open http://localhost:8000/

`python -m http.server` also works, but browsers may keep old JavaScript
cached after an update; press Ctrl+Shift+R if you use it.
"""
import http.server
import sys
from functools import partial
from pathlib import Path


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".json": "application/json",
                      ".geojson": "application/geo+json", ".woff2": "font/woff2"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = partial(NoCacheHandler, directory=str(Path(__file__).resolve().parent))
    print(f"Ropon Radar: http://localhost:{port}/  (Ctrl+C to stop)")
    http.server.ThreadingHTTPServer(("", port), handler).serve_forever()
