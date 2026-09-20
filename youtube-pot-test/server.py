import json
import os
import subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

PORT = int(os.environ.get("PORT", "10000"))

class Handler(BaseHTTPRequestHandler):
    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urlparse(self.path)
        if u.path in ("/", "/health"):
            return self.send_json(200, {
                "ok": True,
                "service": "BalticM yt-dlp + bgutil POT test",
                "version": "1.0.0"
            })

        if u.path == "/test":
            url = parse_qs(u.query).get("url", [""])[0]
            if not url:
                return self.send_json(400, {"ok": False, "error": "url query parameter required"})

            cmd = [
                "yt-dlp", "-v",
                "--js-runtimes", "node",
                "--extractor-args", "youtube:player_client=mweb",
                "-f", "bestaudio",
                "--skip-download",
                "--print", "%(id)s|%(title)s|%(format_id)s|%(url)s",
                url,
            ]
            try:
                p = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
                out = (p.stdout or "").strip()
                err = (p.stderr or "").strip()
                provider = "PO Token Providers:" in err and "none" not in err.lower()
                if p.returncode != 0:
                    return self.send_json(502, {
                        "ok": False,
                        "providerDetected": provider,
                        "exitCode": p.returncode,
                        "error": err[-7000:]
                    })
                parts = out.split("|", 3)
                return self.send_json(200, {
                    "ok": True,
                    "providerDetected": provider,
                    "videoId": parts[0] if len(parts) > 0 else None,
                    "title": parts[1] if len(parts) > 1 else None,
                    "formatId": parts[2] if len(parts) > 2 else None,
                    "streamUrlResolved": len(parts) > 3 and parts[3].startswith("http")
                })
            except subprocess.TimeoutExpired:
                return self.send_json(504, {"ok": False, "error": "yt-dlp test timed out after 90 seconds"})
            except Exception as e:
                return self.send_json(500, {"ok": False, "error": str(e)})

        return self.send_json(404, {"ok": False, "error": "Not found"})

    def log_message(self, fmt, *args):
        print("[HTTP]", fmt % args)

HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
