#!/usr/bin/env python3
"""Production smoke test for API, HTTP/HTTPS tunnels, SSE, and WebSocket."""

from __future__ import annotations

import argparse
import base64
import hashlib
import http.client
import ipaddress
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
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


class ApiError(RuntimeError):
    pass


class RoutedHTTPSConnection(http.client.HTTPSConnection):
    """Keep the requested SNI/Host while connecting to a local smoke endpoint."""

    def __init__(
        self,
        requested_host: str,
        connect_host: str,
        connect_port: int,
        context: ssl.SSLContext,
        timeout: float,
    ) -> None:
        super().__init__(requested_host, connect_port, context=context, timeout=timeout)
        self._connect_host = connect_host

    def connect(self) -> None:
        raw = socket.create_connection((self._connect_host, self.port), self.timeout)
        self.sock = self._context.wrap_socket(raw, server_hostname=self.host)


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


def websocket_roundtrip(
    domain: str,
    connect_host: str | None = None,
    connect_port: int = 443,
    insecure_tls: bool = False,
    ca_file: str | None = None,
) -> None:
    raw = socket.create_connection((connect_host or domain, connect_port), timeout=15)
    context = ssl._create_unverified_context() if insecure_tls else ssl.create_default_context(cafile=ca_file)
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
    parser.add_argument("--managed-agent", action="store_true")
    parser.add_argument("--frps-server", default="127.0.0.1")
    parser.add_argument("--frps-port", type=int, default=7000)
    parser.add_argument("--frps-ca-file")
    parser.add_argument("--tunnel-domain", default="tunnel.example.com")
    parser.add_argument("--public-connect-host")
    parser.add_argument("--public-connect-port", type=int, default=443)
    parser.add_argument("--insecure-public-tls", action="store_true")
    parser.add_argument("--public-ca-file")
    parser.add_argument("--bootstrap-password-file", required=True)
    parser.add_argument("--admin-password-file", required=True)
    parser.add_argument("--handoff-file", required=True)
    parser.add_argument("--evidence-file", required=True)
    arguments = parser.parse_args()

    origin = urlsplit(arguments.origin)
    if origin.scheme != "https" or not origin.hostname or origin.query or origin.fragment:
        raise RuntimeError("Smoke origin must be an HTTPS origin")
    if not (1 <= arguments.frps_port <= 65535 and 1 <= arguments.public_connect_port <= 65535):
        raise RuntimeError("Smoke port is outside the valid range")
    if arguments.insecure_public_tls and not arguments.public_connect_host:
        raise RuntimeError("Insecure public TLS is allowed only with an explicit local connect host")
    if arguments.public_ca_file and not arguments.public_connect_host:
        raise RuntimeError("A routed public CA file requires an explicit connect host")
    if arguments.insecure_public_tls and arguments.public_ca_file:
        raise RuntimeError("Choose either insecure public TLS or an explicit public CA file")
    if arguments.managed_agent and not arguments.frps_ca_file:
        raise RuntimeError("Managed Agent smoke requires --frps-ca-file")
    if arguments.insecure_public_tls:
        try:
            routed_address = ipaddress.ip_address(arguments.public_connect_host)
        except ValueError as error:
            raise RuntimeError("Insecure public TLS requires a loopback connect address") from error
        if not routed_address.is_loopback:
            raise RuntimeError("Insecure public TLS requires a loopback connect address")
    tunnel_domain = arguments.tunnel_domain.strip().strip(".").lower()
    if not tunnel_domain or "." not in tunnel_domain:
        raise RuntimeError("Tunnel domain is invalid")

    bootstrap_path = Path(arguments.bootstrap_password_file)
    admin_password_path = Path(arguments.admin_password_file)
    bootstrap_password = bootstrap_path.read_text(encoding="utf-8").strip()
    admin_password = admin_password_path.read_text(encoding="utf-8").strip()
    if not bootstrap_password or not admin_password:
        raise RuntimeError("Administrator password handoff inputs are empty")

    def fetch(request: Request | str, timeout: float = 20) -> tuple[int, bytes]:
        if not arguments.public_connect_host:
            try:
                with urlopen(request, timeout=timeout) as response:
                    return response.status, response.read()
            except HTTPError as error:
                return error.code, error.read()

        target = request.full_url if isinstance(request, Request) else request
        parsed = urlsplit(target)
        if parsed.scheme != "https" or not parsed.hostname:
            raise RuntimeError("Local routed smoke supports HTTPS URLs only")
        context = (
            ssl._create_unverified_context()
            if arguments.insecure_public_tls
            else ssl.create_default_context(cafile=arguments.public_ca_file)
        )
        connection = RoutedHTTPSConnection(
            parsed.hostname,
            arguments.public_connect_host,
            arguments.public_connect_port,
            context,
            timeout,
        )
        try:
            method = request.get_method() if isinstance(request, Request) else "GET"
            body = request.data if isinstance(request, Request) else None
            headers = dict(request.header_items()) if isinstance(request, Request) else {}
            headers["Host"] = parsed.hostname
            path = parsed.path or "/"
            if parsed.query:
                path += "?" + parsed.query
            connection.request(method, path, body=body, headers=headers)
            response = connection.getresponse()
            return response.status, response.read()
        finally:
            connection.close()

    def api(method: str, path: str, payload: object | None = None, token: str | None = None, expected: tuple[int, ...] = (200,)):
        data = None if payload is None else json.dumps(payload, separators=(",", ":")).encode()
        headers = {"X-Request-ID": str(uuid.uuid4())}
        if data is not None:
            headers["Content-Type"] = "application/json"
        if token:
            headers["Authorization"] = f"Bearer {token}"
        request = Request(arguments.origin + path, data=data, headers=headers, method=method)
        status, body = fetch(request)
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
                status, body = fetch(url)
                value = body.decode()
                if status == 200 and expected_text in value:
                    return
                last_error = RuntimeError(f"unexpected HTTP status/content: {status}")
            except (HTTPError, URLError, TimeoutError, ssl.SSLError) as error:
                last_error = error
            time.sleep(2)
        raise RuntimeError(f"Public tunnel did not become ready: {type(last_error).__name__}")

    def public_denied(url: str, attempts: int = 30) -> None:
        last_status = 0
        last_error: Exception | None = None
        for _ in range(attempts):
            try:
                last_status, _ = fetch(url)
                if last_status in (403, 404, 410, 423, 503):
                    return
                last_error = None
            except (HTTPError, URLError, TimeoutError, ssl.SSLError, OSError) as error:
                last_status = 0
                last_error = error
            time.sleep(1)
        detail = f"status {last_status}" if last_error is None else type(last_error).__name__
        raise RuntimeError(f"Revoked tunnel denial was not observed ({detail})")

    suffix = secrets.token_hex(5)
    username = f"smoke-{suffix}"
    user_password = f"Smoke-{secrets.token_hex(16)}-Q9!"
    http_domain = f"smoke-http-{suffix}.{tunnel_domain}"
    https_domain = f"smoke-https-{suffix}.{tunnel_domain}"
    unknown_domain = f"unassigned-{suffix}.{tunnel_domain}"
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
            [
                "docker",
                "exec",
                "-i",
                os.environ.get("HOME_TUNNEL_CONTROL_CONTAINER", "home-tunnel-control-center"),
                "node",
                "--input-type=module",
                "-e",
                bridge,
            ],
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
                    status, _ = fetch(arguments.origin + "/healthz", timeout=10)
                    if status == 200:
                        break
                except Exception:
                    time.sleep(2)
            else:
                raise RuntimeError("Console endpoint did not become ready")

            public_get(arguments.origin + "/", "Linux 客户端快速开始")
            _, landing_body = fetch(arguments.origin + "/")
            landing_page = landing_body.decode()
            if 'href="https://github.com/ZHanry/home-tunnel/blob/main/linux-client/README.md"' not in landing_page:
                raise RuntimeError("Landing page does not point to the Linux quick start")
            windows_download = (
                'href="https://github.com/ZHanry/home-tunnel/releases/latest/download/'
                'HomeTunnel-Setup-3.0.0-x64.exe"'
            )
            if windows_download not in landing_page or 'id="hero-download"' not in landing_page:
                raise RuntimeError("Landing page does not expose the Windows x64 EXE")
            if "Windows EXE 为自签名 Experimental" not in landing_page or "未知发布者" not in landing_page:
                raise RuntimeError("Landing page does not disclose the Windows distribution status")

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
                f"serverAddr = {toml_string(arguments.frps_server)}",
                f"serverPort = {arguments.frps_port}",
                f"user = {toml_string(sync['device_id'])}",
                "loginFailExit = true",
                "transport.tls.enable = true",
                "transport.tls.disableCustomTLSFirstByte = true",
                "transport.heartbeatInterval = 30",
                "transport.heartbeatTimeout = 90",
                f"metadatas.home_tunnel_lease = {toml_string(sync['lease']['lease'])}",
                'log.to = "console"',
                'log.level = "info"',
            ]
            ca_path: Path | None = None
            if arguments.frps_ca_file:
                ca_path = Path(arguments.frps_ca_file).resolve()
                if not ca_path.is_file():
                    raise RuntimeError("FRPS CA file does not exist")
                lines.insert(7, f"transport.tls.trustedCaFile = {toml_string(str(ca_path))}")
                lines.insert(8, f"transport.tls.serverName = {toml_string(arguments.frps_server)}")
            for connection in sync["connections"]:
                if not connection["enabled"]:
                    continue
                lines.extend([
                    "", "[[proxies]]", f"name = {toml_string(connection['proxy_name'])}", 'type = "http"',
                    f"customDomains = [{toml_string(connection['subdomain'] + '.' + tunnel_domain)}]",
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
            if arguments.managed_agent:
                if ca_path is None:
                    raise RuntimeError("Managed Agent smoke requires a readable FRPS CA file")
                ca_hash = hashlib.sha256(ca_path.read_bytes()).hexdigest()
                managed_arguments = [
                    "--config",
                    str(config_path),
                    "--server",
                    arguments.frps_server,
                    "--port",
                    str(arguments.frps_port),
                    "--domain",
                    tunnel_domain,
                    "--tls-ca-sha256",
                    ca_hash,
                ]
                verify_command = [arguments.frpc, "verify", *managed_arguments]
                run_command = [arguments.frpc, "run", *managed_arguments]
            else:
                verify_command = [arguments.frpc, "verify", "-c", str(config_path)]
                run_command = [arguments.frpc, "-c", str(config_path)]
            verified = subprocess.run(
                verify_command,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
            )
            if verified.returncode != 0:
                raise RuntimeError(
                    "Managed FRPC configuration was rejected: "
                    + (verified.stdout[-4000:].strip() or "no output")
                )
            frpc_log = frpc_log_path.open("wb")
            frpc = subprocess.Popen(
                run_command,
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
            websocket_roundtrip(
                http_domain,
                arguments.public_connect_host,
                arguments.public_connect_port,
                arguments.insecure_public_tls,
                arguments.public_ca_file,
            )
            unknown_status, _ = fetch(f"https://{unknown_domain}/")
            if unknown_status < 400:
                raise RuntimeError("Unassigned wildcard domain was unexpectedly routable")

            http_connection = next(
                item for item in sync["connections"] if item["id"] == connection_ids[0]
            )
            disabled = api(
                "PATCH",
                f"/api/v1/client/connections/{connection_ids[0]}",
                {"enabled": False, "expected_version": http_connection["version"]},
                user_token,
            )
            if disabled.get("enabled") is not False:
                raise RuntimeError("Connection disable did not take effect")
            public_denied(f"https://{http_domain}/")

            health = api("GET", "/api/v1/admin/system/health", token=admin_token)
            unhealthy = [item.get("component") for item in health["components"] if item.get("status") == "unhealthy"]
            if unhealthy:
                raise RuntimeError("Unhealthy components: " + ",".join(str(item) for item in unhealthy))
            Path(arguments.evidence_file).write_text(json.dumps({
                "status": "passed",
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "tests": ["landing_page", "linux_quick_start_link", "authenticated_api", "http_local", "https_local", "sse", "websocket", "unassigned_host_denied", "policy_revocation", "component_health"],
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

    print("Production smoke passed: landing page, authenticated API, HTTP, HTTPS-local, SSE, WebSocket, host denial, policy revocation, health")


if __name__ == "__main__":
    main()
