#!/usr/bin/env python3
"""Bot Crossing hub — first-boot setup server (captive portal + on-wall status/QR).

Pure Python 3 standard library (already on the Ubuntu Server base image), so it runs during
first boot before Node or anything else is installed. Two audiences, one server on :80:

  * the operator's phone, joined to the NUC's own "BotCrossing-Setup" wifi (AP at 10.42.0.1):
    the captive portal at "/" — enter wifi + teammate IPs + colony name, POST to /save.
  * the wall itself, once X+Chromium are up: "/wall" — a status page that polls /status and
    renders the Tailscale login URL as a QR to scan from the screen.

State lives as small files under $BCH_SETUP_DIR (default /opt/bch-setup), written by this server
(pending.json, .submitted) and by firstboot.sh (phase, ts-login-url). Nothing here reaches the
network — it only reads/writes those files and serves the two local pages.
"""

import json
import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

SETUP_DIR = os.environ.get("BCH_SETUP_DIR", "/opt/bch-setup")
PORTAL_DIR = os.environ.get("BCH_PORTAL_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "portal"))
PORT = int(os.environ.get("BCH_SETUP_PORT", "80"))

PENDING = os.path.join(SETUP_DIR, "pending.json")
SUBMITTED = os.path.join(SETUP_DIR, ".submitted")
PHASE = os.path.join(SETUP_DIR, "phase")
TS_URL = os.path.join(SETUP_DIR, "ts-login-url")

# Captive-portal probe URLs. Answering these with a redirect to "/" is what makes a phone pop its
# "Sign in to Wi-Fi network" sheet the moment it joins the AP.
CAPTIVE_PROBES = {
    "/generate_204", "/gen_204", "/hotspot-detect.html", "/library/test/success.html",
    "/connecttest.txt", "/ncsi.txt", "/canonical.html", "/success.txt", "/redirect",
}


def read_text(path, default=""):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return fh.read().strip()
    except OSError:
        return default


def parse_neighbors(raw):
    """'Name=100.x' per line (or comma-separated) -> [{name, host, port:5275}]."""
    out = []
    for chunk in re.split(r"[,\n]", raw or ""):
        pair = chunk.strip()
        if not pair:
            continue
        if "=" in pair:
            name, host = pair.split("=", 1)
        else:
            name, host = pair, ""
        name, host = name.strip(), host.strip()
        if host:
            out.append({"name": name or host, "host": host, "port": 5275})
    return out


class Handler(BaseHTTPRequestHandler):
    server_version = "bch-setup/1.0"

    # ---- helpers -------------------------------------------------------------------------
    def _send(self, code, body, ctype="text/html; charset=utf-8"):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _redirect(self, location):
        self.send_response(302)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _page(self, name):
        try:
            with open(os.path.join(PORTAL_DIR, name), "rb") as fh:
                self._send(200, fh.read())
        except OSError:
            self._send(500, "setup page %s missing" % name)

    def log_message(self, *args):
        pass  # firstboot.sh captures its own log; keep the console clean.

    # ---- routes --------------------------------------------------------------------------
    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        path = urlparse(self.path).path
        if path in CAPTIVE_PROBES:
            return self._redirect("http://10.42.0.1/")
        if path in ("/", "/index.html"):
            return self._page("index.html")
        if path == "/wall":
            return self._page("wall.html")
        if path == "/ts-qr.png":
            # Written by firstboot.sh (`qrencode`) once `tailscale up` prints its login URL.
            try:
                with open(os.path.join(SETUP_DIR, "ts-qr.png"), "rb") as fh:
                    return self._send(200, fh.read(), "image/png")
            except OSError:
                return self._send(404, "not ready")
        if path == "/status":
            return self._send(
                200,
                json.dumps({"phase": read_text(PHASE, "collecting"), "tsUrl": read_text(TS_URL)}),
                "application/json",
            )
        # Anything else: treat as a captive probe and bounce to the portal.
        return self._redirect("http://10.42.0.1/")

    def do_POST(self):
        if urlparse(self.path).path != "/save":
            return self._send(404, "not found")
        length = int(self.headers.get("Content-Length", "0") or "0")
        form = parse_qs(self.rfile.read(length).decode("utf-8", "replace"))

        def one(key):
            return (form.get(key, [""])[0] or "").strip()

        ethernet = one("ethernet") in ("on", "1", "true")
        config = {
            "colonyName": one("colony_name") or "Hub",
            "neighbors": parse_neighbors(one("neighbors")),
        }
        if not ethernet and one("wifi_ssid"):
            config["wifi"] = {"ssid": one("wifi_ssid"), "password": one("wifi_password")}

        os.makedirs(SETUP_DIR, exist_ok=True)
        with open(PENDING, "w", encoding="utf-8") as fh:
            json.dump(config, fh, indent=2)
        with open(SUBMITTED, "w", encoding="utf-8") as fh:
            fh.write("1\n")
        # firstboot.sh is watching for .submitted; it takes over from here (AP down, connect, build).
        self._page("submitted.html")


def main():
    os.makedirs(SETUP_DIR, exist_ok=True)
    httpd = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print("bch setup-server listening on :%d (portal dir %s)" % (PORT, PORTAL_DIR), flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
