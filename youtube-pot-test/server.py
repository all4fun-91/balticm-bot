import json
import os
import subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

PORT = int(os.environ.get("PORT", "10000"))
CLIENTS = ["mweb", "android_vr", "web_embedded"]

def run_client(url, client):
    cmd = [
        "yt-dlp", "-v",
        "--js-runtimes", "node",
        "--extractor-args", f"youtube:player_client={client}",
        "-f", "bestaudio",
        "--skip-download",
        "--print", "%(id)s|%(title)s|%(format_id)s|%(url)s",
        url,
    ]
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=75)
        out = (p.stdout or "").strip()
        err = (p.stderr or "").strip()
        provider = "PO Token Providers:" in err and "bgutil:http" in err
        player403 = "HTTP Error 403" in err and ("player API" in err or "API page" in err)
        if p.returncode == 0:
            parts = out.split("|", 3)
            return {
                "client": client, "ok": True, "providerDetected": provider,
                "playerApi403": player403,
                "videoId": parts[0] if len(parts) > 0 else None,
                "title": parts[1] if len(parts) > 1 else None,
                "formatId": parts[2] if len(parts) > 2 else None,
                "streamUrlResolved": len(parts) > 3 and parts[3].startswith("http"),
            }
        return {
            "client": client, "ok": False, "providerDetected": provider,
            "playerApi403": player403, "exitCode": p.returncode,
            "errorTail": err[-2200:],
        }
    except subprocess.TimeoutExpired:
        return {"client": client, "ok": False, "error": "timeout after 75 seconds"}
    except Exception as e:
        return {"client": client, "ok": False, "error": str(e)}

class Handler(BaseHTTPRequestHandler):
    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urlparse(self.path)
        if u.path in ("/", "/health"):
            node = subprocess.run(["node", "--version"], capture_output=True, text=True).stdout.strip()
            return self.send_json(200, {
                "ok": True, "service": "BalticM yt-dlp + bgutil POT test",
                "version": "1.1.0", "node": node, "clients": CLIENTS
            })

        if u.path == "/test":
            url = parse_qs(u.query).get("url", [""])[0]
            if not url:
                return self.send_json(400, {"ok": False, "error": "url query parameter required"})
            results = [run_client(url, client) for client in CLIENTS]
            winners = [r["client"] for r in results if r.get("streamUrlResolved")]
            return self.send_json(200 if winners else 502, {
                "ok": bool(winners),
                "service": "BalticM multi-client POT test",
                "version": "1.1.0",
                "workingClients": winners,
                "results": results,
            })

        return self.send_json(404, {"ok": False, "error": "Not found"})

    def log_message(self, fmt, *args):
        print("[HTTP]", fmt % args)

HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
