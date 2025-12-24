#!/usr/bin/env python3
import hashlib
import json
import os
import time
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, urlencode
import urllib.request

HOST = "0.0.0.0"
PORT = 8000
API_BASE = "https://calidaddelairews.asturias.es/RestCecoma"
API_USER = "manten"
API_PASS = "MANTEN"
ALLOWED_PATHS = {"/getEstacion", "/getDato", "/getAnalogin"}
COLLECTOR_INTERVAL = 300

try:
    import collector
except Exception:
    collector = None


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def sign_headers():
    timestamp = str(int(time.time() * 1000))
    first = sha256_hex(API_USER + API_PASS)
    signature = sha256_hex(first + timestamp)
    return {
        "signature": signature,
        "timestamp": timestamp,
    }


class PMXIXONHandler(SimpleHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/asturaire"):
            self.handle_proxy()
            return
        super().do_GET()

    def handle_proxy(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        target_path = params.pop("path", [""])[0]

        if target_path not in ALLOWED_PATHS:
            self.send_response(400)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Ruta no permitida"}).encode("utf-8"))
            return

        qs = urlencode({k: v[0] for k, v in params.items()})
        target_url = f"{API_BASE}{target_path}"
        if qs:
            target_url += f"?{qs}"

        headers = sign_headers()
        req = urllib.request.Request(target_url, headers=headers)

        try:
            with urllib.request.urlopen(req, timeout=12) as resp:
                body = resp.read()
                if resp.status >= 400:
                    raise RuntimeError("Bad response")
        except Exception:
            self.send_response(502)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(
                json.dumps({"error": "No se pudo obtener datos de AsturAire."}).encode("utf-8")
            )
            return

        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    if collector:
        def _collector_loop():
            while True:
                try:
                    collector.run_once()
                except Exception as exc:
                    print("Collector error:", exc)
                time.sleep(COLLECTOR_INTERVAL)

        thread = threading.Thread(target=_collector_loop, daemon=True)
        thread.start()
    server = ThreadingHTTPServer((HOST, PORT), PMXIXONHandler)
    print(f"PMXIXON server en http://{HOST}:{PORT}")
    server.serve_forever()
