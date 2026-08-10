import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import express from "express";
import { WebSocketServer } from "ws";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const publicDirectory = join(root, "public");
const port = Number.parseInt(process.env.UI_PREVIEW_PORT ?? "4175", 10);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("UI_PREVIEW_PORT is invalid");

const ids = {
  user: "5f70df22-86df-4b52-b9ca-083f8adb70bb",
  userTwo: "327e3788-64c4-4a45-8c71-45ac229a18d2",
  device: "7b15970d-9641-424e-b7d5-c6e2a006e501",
  deviceTwo: "081a1d4f-fb1a-4ca2-916c-6f57c85f981b",
  connection: "cc9b7a2d-9a90-4daf-887d-cf6b05ee5149",
  connectionTwo: "a17bf5d4-f89f-42e4-a685-c15fb2ba86a2",
};

const now = Date.now();
const users = [
  { id: ids.user, username: "lin", display_name: "林先生", role: "user", status: "active", password_state: "normal", device_count: 1, connection_count: 2, bandwidth_limit_bps: 50_000_000, policy_version: 3 },
  { id: ids.userTwo, username: "ops.demo", display_name: "家庭运维", role: "user", status: "active", password_state: "must_change", device_count: 1, connection_count: 0, bandwidth_limit_bps: null, policy_version: 1 },
];
const devices = [
  { id: ids.device, user_id: ids.user, username: "lin", name: "书房主机", status: "active", online: true, client_version: "2.2.5", applied_config_version: 12, config_version: 12, last_seen_at: new Date(now - 12_000).toISOString(), lease_expires_at: new Date(now + 21_600_000).toISOString() },
  { id: ids.deviceTwo, user_id: ids.userTwo, username: "ops.demo", name: "家庭服务器", status: "active", online: false, client_version: "2.2.5", applied_config_version: 4, config_version: 5, last_seen_at: new Date(now - 3_600_000).toISOString(), lease_expires_at: null },
];
const connections = [
  { id: ids.connection, user_id: ids.user, username: "lin", device_id: ids.device, device_name: "书房主机", name: "NAS 控制台", subdomain: "nas-home", public_url: "https://nas-home.tunnel.example.com", local_scheme: "http", local_host: "127.0.0.1", local_port: 8080, enabled: true, state: "Online", bandwidth_limit_bps: 20_000_000, version: 12, applied_version: 12 },
  { id: ids.connectionTwo, user_id: ids.user, username: "lin", device_id: ids.device, device_name: "书房主机", name: "照片管理", subdomain: "photos-home", public_url: "https://photos-home.tunnel.example.com", local_scheme: "http", local_host: "127.0.0.1", local_port: 2342, enabled: true, state: "Pending", bandwidth_limit_bps: null, version: 3, applied_version: 2 },
];
const auditActions = ["ConnectionUpdated", "DeviceHeartbeatAccepted", "LoginSucceeded", "UserPolicyUpdated"];
const auditEvents = Array.from({ length: 67 }, (_, index) => ({
  created_at: new Date(now - (index + 1) * 90_000).toISOString(),
  action: auditActions[index % auditActions.length],
  actor_type: index % 3 === 0 ? "admin" : index % 3 === 1 ? "device" : "user",
  actor_id: index % 3 === 1 ? ids.device : index % 3 === 2 ? ids.user : "preview-admin",
  target_type: index % 2 === 0 ? "Connection" : "Device",
  target_id: index % 2 === 0 ? ids.connection : ids.device,
  request_id: randomUUID(),
}));

const app = express();
app.disable("x-powered-by");
app.use(express.json());
app.use(express.static(publicDirectory, { etag: false, lastModified: false, maxAge: 0 }));

app.get("/api/v1/public/releases/latest", (_request, response) => response.json({
  version: "2.2.5",
  architecture: "x64",
  file_name: "HomeTunnel-Setup-2.2.5-x64.exe",
  size_bytes: 58_000_000,
  sha256: "8a69a7cf2b33c64c4af1a48882de163f739f25bd90ea9707146d82d317d777a4",
  released_at: new Date(now).toISOString(),
  download_url: "https://github.com/ZHanry/home-tunnel/releases/download/v2.2.5/HomeTunnel-Setup-2.2.5-x64.exe",
}));
app.post("/api/v1/auth/refresh", (_request, response) => response.json({ csrf_token: "local-ui-preview" }));
app.get("/api/v1/auth/me", (_request, response) => response.json({ id: "preview-admin", username: "admin", display_name: "系统管理员", role: "admin" }));
app.post("/api/v1/auth/logout", (_request, response) => response.sendStatus(204));
app.get("/api/v1/admin/summary", (_request, response) => response.json({ users: 2, online_devices: 1, connections: 2, online_connections: 1, upload_24h: 348_127_232, download_24h: 1_492_611_072 }));
app.get("/api/v1/admin/system/health", (_request, response) => response.json({
  status: "healthy",
  components: [
    { component: "control-center", status: "healthy", latency_ms: 3 },
    { component: "sqlite", status: "healthy", latency_ms: 1 },
    { component: "traffic-gateway", status: "healthy", latency_ms: 8 },
    { component: "frps", status: "healthy", latency_ms: 6 },
  ],
}));
app.get("/api/v1/admin/traffic/summary", (_request, response) => response.json({ items: [
  { name: "NAS 控制台", subdomain: "nas-home", username: "lin", upload_bytes: 286_261_248, download_bytes: 1_262_436_352, requests: 3184 },
  { name: "照片管理", subdomain: "photos-home", username: "lin", upload_bytes: 61_865_984, download_bytes: 230_174_720, requests: 846 },
] }));
app.get("/api/v1/admin/users", (_request, response) => response.json({ items: users }));
app.get("/api/v1/admin/devices", (_request, response) => response.json({ items: devices }));
app.get("/api/v1/admin/connections", (_request, response) => response.json({ items: connections }));
app.get("/api/v1/admin/audit-events", (request, response) => {
  const query = String(request.query.q ?? "").toLowerCase();
  const action = String(request.query.action ?? "");
  const targetType = String(request.query.target_type ?? "");
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(request.query.page_size ?? 25), 10) || 25));
  const requestedPage = Math.max(1, Number.parseInt(String(request.query.page ?? 1), 10) || 1);
  const filtered = auditEvents.filter((item) =>
    (!action || item.action === action) &&
    (!targetType || item.target_type === targetType) &&
    (!query || Object.values(item).some((value) => String(value).toLowerCase().includes(query))));
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(requestedPage, totalPages);
  response.json({
    items: filtered.slice((page - 1) * pageSize, page * pageSize),
    total: filtered.length,
    page,
    page_size: pageSize,
    total_pages: totalPages,
  });
});
app.post("/api/v1/admin/users", (_request, response) => response.status(201).json({ user: users[0], temporary_password: "Preview-Only-A7!safe" }));
app.post(/\/api\/v1\/admin\/users\/[^/]+\/reset-password/, (_request, response) => response.json({ temporary_password: "Preview-Reset-Q9!safe" }));
app.delete(/\/api\/v1\/admin\/devices\/[^/]+/, (request, response) => {
  const deviceId = request.path.split("/").at(-1);
  const index = devices.findIndex((device) => device.id === deviceId);
  if (index >= 0) devices.splice(index, 1);
  response.sendStatus(204);
});
app.use("/api/v1/admin", (_request, response) => response.sendStatus(204));
app.use("/downloads", (_request, response) => response.status(404).send("UI preview does not serve binaries"));
app.use((request, response, next) => {
  if (request.method !== "GET") return next();
  response.sendFile(join(publicDirectory, "index.html"));
});

const server = app.listen(port, "127.0.0.1", () => {
  console.log(`Home Tunnel UI preview: http://127.0.0.1:${port}`);
});
const webSockets = new WebSocketServer({ noServer: true });
server.on("upgrade", (request, socket, head) => {
  if (request.url !== "/api/v1/ws") {
    socket.destroy();
    return;
  }
  webSockets.handleUpgrade(request, socket, head, (client) => webSockets.emit("connection", client, request));
});
webSockets.on("connection", (client) => client.send(JSON.stringify({ event: "preview.ready" })));

async function stop() {
  for (const client of webSockets.clients) client.close();
  await new Promise((resolve) => webSockets.close(resolve));
  await new Promise((resolve) => server.close(resolve));
}
process.on("SIGINT", () => void stop().then(() => process.exit(0)));
process.on("SIGTERM", () => void stop().then(() => process.exit(0)));
