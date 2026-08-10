#!/usr/bin/env python3
"""Production smoke test for API, HTTP/HTTPS tunnels, SSE, and WebSocket."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import secrets
import socket
import ssl
import struct
import subprocess
import tempfile
import threading
import time
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class ApiError(RuntimeError):
    pass


def toml_string(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"').replace("\r", "").replace("\n", "") + '"'


def handler_for(label: str):
    class SmokeHandler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, _format: str, *_args: object) -> None:
            return

        def do_GET(self) -> None:  # noqa: N802
            if self.headers.get("Upgrade", "").lower() == "websocket":
                key = self.headers.get("Sec-WebSocket-Key", "")
                accept = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
                self.send_response(101, "Switching Protocols")
                self.send_header("Upgrade", "websocket")
                self.send_header("Connection", "Upgrade")
                self.send_header("Sec-WebSocket-Accept", accept)
                self.end_headers()
                first = self.rfile.read(2)
                if len(first) != 2:
                    return
                length = first[1] & 0x7F
                if length == 126:
                    length = struct.unpack("!H", self.rfile.read(2))[0]
                elif length == 127:
                    length = struct.unpack("!Q", self.rfile.read(8))[0]
                mask = self.rfile.read(4)
                payload = self.rfile.read(length)
                decoded = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
                response = b"home-tunnel-ws:" + decoded
                self.wfile.write(bytes([0x81, len(response)]) + response)
                self.wfile.flush()
                self.close_connection = True
                return
            if self.path == "/sse":
                payload = b"data: home-tunnel-sse\n\n"
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
                self.wfile.flush()
                return
            payload = f"home-tunnel-{label}".encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    return SmokeHandler


def websocket_roundtrip(domain: str) -> None:
    raw = socket.create_connection((domain, 443), timeout=15)
    context = ssl.create_default_context()
    connection = context.wrap_socket(raw, server_hostname=domain)
    try:
        key = base64.b64encode(os.urandom(16)).decode()
        request = (
            f"GET /ws HTTP/1.1\r\nHost: {domain}\r\nUpgrade: websocket\r\n"
            f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
        )
        connection.sendall(request.encode())
        headers = b""
        while b"\r\n\r\n" not in headers and len(headers) < 65536:
            headers += connection.recv(4096)
        if b" 101 " not in headers.split(b"\r\n", 1)[0]:
            raise RuntimeError("WebSocket upgrade did not return HTTP 101")
        payload = b"ping"
        mask = os.urandom(4)
        connection.sendall(bytes([0x81, 0x80 | len(payload)]) + mask + bytes(value ^ mask[index % 4] for index, value in enumerate(payload)))
        first = connection.recv(2)
        if len(first) != 2:
            raise RuntimeError("WebSocket response frame is incomplete")
        length = first[1] & 0x7F
        response = b""
        while len(response) < length:
            response += connection.recv(length - len(response))
        if response != b"home-tunnel-ws:ping":
            raise RuntimeError("WebSocket echo payload did not match")
    finally:
        connection.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--origin", default="https://console.tunnel.example.com")
    parser.add_argument("--frpc", required=True)
    parser.add_argument("--bootstrap-password-file", required=True)
    parser.add_argument("--admin-password-file", required=True)
    parser.add_argument("--handoff-file", required=True)
    parser.add_argument("--evidence-file", required=True)
    arguments = parser.parse_args()

    bootstrap_path = Path(arguments.bootstrap_password_file)
    admin_password_path = Path(arguments.admin_password_file)
    bootstrap_password = bootstrap_path.read_text(encoding="utf-8").strip()
    admin_password = admin_password_path.read_text(encoding="utf-8").strip()
    if not bootstrap_password or not admin_password:
        raise RuntimeError("Administrator password handoff inputs are empty")

    def api(method: str, path: str, payload: object | None = None, token: str | None = None, expected: tuple[int, ...] = (200,)):
        data = None if payload is None else json.dumps(payload, separators=(",", ":")).encode()
        headers = {"X-Request-ID": str(uuid.uuid4())}
        if data is not None:
            headers["Content-Type"] = "application/json"
        if token:
            headers["Authorization"] = f"Bearer {token}"
        request = Request(arguments.origin + path, data=data, headers=headers, method=method)
        try:
            with urlopen(request, timeout=20) as response:
                status = response.status
                body = response.read()
        except HTTPError as error:
            status = error.code
            body = error.read()
        if status not in expected:
            error_code = "UNKNOWN"
            try:
                error_code = json.loads(body or b"{}").get("error_code", "UNKNOWN")
            except (ValueError, AttributeError):
                pass
            raise ApiError(f"{method} {path} returned {status} ({error_code})")
        return None if not body else json.loads(body)

    def public_get(url: str, expected_text: str, attempts: int = 60) -> None:
        last_error: Exception | None = None
        for _ in range(attempts):
            try:
                with urlopen(url, timeout=20) as response:
                    value = response.read().decode()
                    if response.status == 200 and expected_text in value:
                        return
                    last_error = RuntimeError(f"unexpected HTTP status/content: {response.status}")
            except (HTTPError, URLError, TimeoutError, ssl.SSLError) as error:
                last_error = error
            time.sleep(2)
        raise RuntimeError(f"Public tunnel did not become ready: {type(last_error).__name__}")

    suffix = secrets.token_hex(5)
    username = f"smoke-{suffix}"
    user_password = f"Smoke-{secrets.token_hex(16)}-Q9!"
    http_domain = f"smoke-http-{suffix}.tunnel.example.com"
    https_domain = f"smoke-https-{suffix}.tunnel.example.com"
    unknown_domain = f"unassigned-{suffix}.tunnel.example.com"
    http_server = ThreadingHTTPServer(("127.0.0.1", 0), handler_for("http"))
    https_server = ThreadingHTTPServer(("127.0.0.1", 0), handler_for("https"))
    http_thread = threading.Thread(target=http_server.serve_forever, daemon=True)
    https_thread = threading.Thread(target=https_server.serve_forever, daemon=True)
    frpc: subprocess.Popen[bytes] | None = None
    admin_token: str | None = None
    user_id: str | None = None
    device_id: str | None = None
    connection_ids: list[str] = []
    original_admin_hash: str | None = None

    def sqlite(statements: list[dict[str, object]]) -> list[object]:
        bridge = r"""
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
const request = JSON.parse(fs.readFileSync(0, "utf8"));
const database = new DatabaseSync(process.env.SQLITE_PATH || "/data/home-tunnel.db");
database.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");
try {
  const results = request.statements.map((command) => {
    const statement = database.prepare(command.sql);
    if (command.mode === "get") {
      const row = statement.get(...(command.parameters || []));
      return row ? Object.values(row)[0] : null;
    }
    const result = statement.run(...(command.parameters || []));
    return Number(result.changes);
  });
  database.exec("COMMIT");
  process.stdout.write(JSON.stringify(results));
} catch (error) {
  database.exec("ROLLBACK");
  throw error;
} finally {
  database.close();
}
"""
        completed = subprocess.run(
            ["docker", "exec", "-i", "home-tunnel-control-center", "node", "--input-type=module", "-e", bridge],
            check=True,
            input=json.dumps({"statements": statements}, separators=(",", ":")),
            stdout=subprocess.PIPE,
            text=True,
        )
        return json.loads(completed.stdout)

    def sqlite_value(statement: str, parameters: list[object] | None = None) -> object:
        return sqlite([{"sql": statement, "parameters": parameters or [], "mode": "get"}])[0]

    def restore_default_administrator() -> None:
        if not original_admin_hash or not original_admin_hash.startswith("$argon2id$") or "'" in original_admin_hash:
            return
        sqlite([
            {
                "sql": """UPDATE users SET password_hash=?,password_state='must_change',temporary_password_expires_at=NULL,
                  token_version=token_version+1,version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
                  WHERE lower(username)='admin' AND role='admin'""",
                "parameters": [original_admin_hash],
            },
            {
                "sql": """UPDATE sessions SET revoked_at=COALESCE(revoked_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                  updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
                  WHERE user_id IN (SELECT id FROM users WHERE lower(username)='admin' AND role='admin')""",
            },
            {
                "sql": """INSERT INTO audit_events(actor_type,action,target_type,target_id,after_value,request_id)
                  SELECT 'system','BootstrapAdminRestored','User',id,?,?
                  FROM users WHERE lower(username)='admin' AND role='admin'""",
                "parameters": [json.dumps({"password_state": "must_change"}, separators=(",", ":")), str(uuid.uuid4())],
            },
        ])

    def cleanup_database() -> None:
        if not user_id or not uuid.UUID(user_id):
            return
        sqlite([
            {"sql": "DELETE FROM traffic_samples WHERE user_id=?", "parameters": [user_id]},
            {"sql": "DELETE FROM traffic_hourly WHERE user_id=?", "parameters": [user_id]},
            {"sql": "DELETE FROM runtime_states WHERE connection_id IN (SELECT id FROM connections WHERE user_id=?)", "parameters": [user_id]},
            {"sql": """DELETE FROM traffic_policies WHERE
              (scope_type='connection' AND scope_id IN (SELECT id FROM connections WHERE user_id=?))
              OR (scope_type='user' AND scope_id=?)""", "parameters": [user_id, user_id]},
            {"sql": "DELETE FROM connections WHERE user_id=?", "parameters": [user_id]},
            {"sql": "DELETE FROM sessions WHERE user_id=?", "parameters": [user_id]},
            {"sql": "DELETE FROM outbox_events WHERE recipient_user_id=? OR resource_id=?", "parameters": [user_id, user_id]},
            {"sql": "DELETE FROM devices WHERE user_id=?", "parameters": [user_id]},
            {"sql": "DELETE FROM users WHERE id=?", "parameters": [user_id]},
        ])

    with tempfile.TemporaryDirectory(prefix="home-tunnel-smoke-") as temporary:
        temporary_path = Path(temporary)
        cert_path = temporary_path / "local.crt"
        key_path = temporary_path / "local.key"
        config_path = temporary_path / "frpc.toml"
        frpc_log_path = temporary_path / "frpc.log"
        subprocess.run([
            "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
            "-subj", "/CN=127.0.0.1", "-keyout", str(key_path), "-out", str(cert_path),
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(cert_path, key_path)
        https_server.socket = context.wrap_socket(https_server.socket, server_side=True)
        http_thread.start()
        https_thread.start()
        try:
            for _ in range(45):
                try:
                    with urlopen(arguments.origin + "/healthz", timeout=10) as response:
                        if response.status == 200:
                            break
                except Exception:
                    time.sleep(2)
            else:
                raise RuntimeError("Console endpoint did not become ready")

            public_get(arguments.origin + "/", "下载 Windows 客户端")
            with urlopen(arguments.origin + "/", timeout=20) as response:
                landing_page = response.read().decode()
            if 'href="https://github.com/ZHanry/home-tunnel/releases/latest"' not in landing_page:
                raise RuntimeError("Landing page does not point to GitHub Releases")

            original_admin_hash = str(sqlite_value("SELECT password_hash FROM users WHERE lower(username)='admin' AND role='admin' LIMIT 1") or "")
            bootstrap_login = api("POST", "/api/v1/auth/login", {"username": "admin", "password": bootstrap_password, "client_type": "windows"})
            if not bootstrap_login.get("password_change_required"):
                raise RuntimeError("Bootstrap administrator did not require a password change")
            api("POST", "/api/v1/auth/password/change", {"current_password": bootstrap_password, "new_password": admin_password}, bootstrap_login["access_token"], (204,))
            Path(arguments.handoff_file).write_text(
                f"Home Tunnel 管理后台\nURL: {arguments.origin}/admin\n用户名: admin\n初始密码: {bootstrap_password}\n首次登录必须修改密码，改密后请删除本文件。\n",
                encoding="utf-8",
            )
            os.chmod(arguments.handoff_file, 0o600)
            admin_password_path.unlink(missing_ok=True)

            admin_login = api("POST", "/api/v1/auth/login", {"username": "admin", "password": admin_password, "client_type": "windows"})
            admin_token = admin_login["access_token"]
            created_user = api("POST", "/api/v1/admin/users", {
                "username": username,
                "display_name": "Deployment Smoke User",
                "role": "user",
                "bandwidth_limit_bps": 20_000_000,
            }, admin_token, (201,))
            temporary_password = created_user["temporary_password"]
            user_id = created_user["user"]["id"]
            initial_user = api("POST", "/api/v1/auth/login", {"username": username, "password": temporary_password, "client_type": "windows"})
            api("POST", "/api/v1/auth/password/change", {"current_password": temporary_password, "new_password": user_password}, initial_user["access_token"], (204,))
            user_login = api("POST", "/api/v1/auth/login", {"username": username, "password": user_password, "client_type": "windows"})
            user_token = user_login["access_token"]
            registered = api("POST", "/api/v1/devices/register", {
                "name": "Deployment Smoke Device",
                "install_id": f"smoke-{suffix}",
                "fingerprint_hash": hashlib.sha256(f"smoke-{suffix}".encode()).hexdigest(),
                "client_version": "2.0.0-deployment-smoke",
            }, user_token, (201,))
            device_id = registered["device_id"]

            for scheme, domain, port in [
                ("http", http_domain, http_server.server_port),
                ("https", https_domain, https_server.server_port),
            ]:
                connection = api("POST", "/api/v1/client/connections", {
                    "device_id": device_id,
                    "name": f"Deployment {scheme.upper()} Smoke",
                    "subdomain": domain.split(".", 1)[0],
                    "local_scheme": scheme,
                    "local_host": "127.0.0.1",
                    "local_port": port,
                    "enabled": True,
                    "bandwidth_limit_bps": 10_000_000,
                }, user_token, (201,))
                connection_ids.append(connection["id"])

            sync = api("POST", "/api/v1/client/sync", {"device_id": device_id, "last_config_version": 0}, user_token)
            lines = [
                'serverAddr = "127.0.0.1"',
                "serverPort = 7000",
                f"user = {toml_string(sync['device_id'])}",
                "loginFailExit = true",
                "transport.tls.enable = true",
                "transport.tls.disableCustomTLSFirstByte = true",
                f"metadatas.home_tunnel_lease = {toml_string(sync['lease']['lease'])}",
                'log.to = "console"',
                'log.level = "warn"',
            ]
            for connection in sync["connections"]:
                if not connection["enabled"]:
                    continue
                lines.extend([
                    "", "[[proxies]]", f"name = {toml_string(connection['proxy_name'])}", 'type = "http"',
                    f"customDomains = [{toml_string(connection['subdomain'] + '.tunnel.example.com')}]",
                    "transport.useEncryption = true", "transport.useCompression = true",
                    'healthCheck.type = "tcp"', "healthCheck.timeoutSeconds = 3", "healthCheck.intervalSeconds = 10",
                ])
                if connection["local_scheme"] == "https":
                    local_address = "127.0.0.1:" + str(https_server.server_port)
                    lines.extend(["", "[proxies.plugin]", 'type = "http2https"', f"localAddr = {toml_string(local_address)}", 'hostHeaderRewrite = "127.0.0.1"'])
                else:
                    lines.extend(['localIP = "127.0.0.1"', f"localPort = {http_server.server_port}"])
            config_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
            os.chmod(config_path, 0o600)
            subprocess.run([arguments.frpc, "verify", "-c", str(config_path)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            frpc_log = frpc_log_path.open("wb")
            frpc = subprocess.Popen(
                [arguments.frpc, "-c", str(config_path)],
                stdout=frpc_log,
                stderr=subprocess.STDOUT,
            )
            time.sleep(4)
            if frpc.poll() is not None:
                frpc_log.close()
                output = frpc_log_path.read_text(encoding="utf-8", errors="replace")[-4000:].strip()
                raise RuntimeError(f"FRPC exited during deployment smoke startup: {output or 'no output'}")

            public_get(f"https://{http_domain}/", "home-tunnel-http")
            public_get(f"https://{https_domain}/", "home-tunnel-https")
            public_get(f"https://{http_domain}/sse", "home-tunnel-sse")
            websocket_roundtrip(http_domain)
            try:
                with urlopen(f"https://{unknown_domain}/", timeout=20) as response:
                    if response.status < 400:
                        raise RuntimeError("Unassigned wildcard domain was unexpectedly routable")
            except (HTTPError, URLError, TimeoutError, ssl.SSLError):
                pass

            health = api("GET", "/api/v1/admin/system/health", token=admin_token)
            unhealthy = [item.get("component") for item in health["components"] if item.get("status") == "unhealthy"]
            if unhealthy:
                raise RuntimeError("Unhealthy components: " + ",".join(str(item) for item in unhealthy))
            Path(arguments.evidence_file).write_text(json.dumps({
                "status": "passed",
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "tests": ["landing_page", "github_release_link", "api", "http_local", "https_local", "sse", "websocket", "unassigned_host_denied", "component_health"],
                "http_domain": http_domain,
                "https_domain": https_domain,
            }, indent=2) + "\n", encoding="utf-8")
        finally:
            if frpc is not None and frpc.poll() is None:
                frpc.terminate()
                try:
                    frpc.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    frpc.kill()
            if "frpc_log" in locals() and not frpc_log.closed:
                frpc_log.close()
            http_server.shutdown()
            https_server.shutdown()
            try:
                cleanup_database()
            finally:
                if admin_token:
                    try:
                        api("POST", "/api/v1/auth/logout", {}, admin_token, (204,))
                    except Exception:
                        pass
                restore_default_administrator()

    print("Production smoke passed: landing page, GitHub release link, API, HTTP, HTTPS-local, SSE, WebSocket, host denial, health")


if __name__ == "__main__":
    main()
