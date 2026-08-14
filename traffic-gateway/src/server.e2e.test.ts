import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import { once } from "node:events";
import http, {
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type ServerResponse,
} from "node:http";
import net, { type AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { after, test } from "node:test";

const internalKey = "11".repeat(32);
const tunnelDomain = "tunnel.example.com";
const managedHost = `service.${tunnelDomain}`;
const limitedHost = `limited.${tunnelDomain}`;
const ipGatedHost = `ipgate.${tunnelDomain}`;
const basicGatedHost = `basicgate.${tunnelDomain}`;
const dualGatedHost = `dualgate.${tunnelDomain}`;

// 与控制中心 hashBasicPassword 相同的 scrypt$N$r$p$saltB64$hashB64 格式
function scryptBasicHash(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32, { N: 16_384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString("base64")}$${hash.toString("base64")}`;
}

const basicGatePassword = "open sesame 42!";
const basicGateHash = scryptBasicHash(basicGatePassword);

function basicHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

type TestPolicy = {
  connection_id: string;
  user_id: string;
  device_id: string;
  subdomain: string;
  custom_domains: string[];
  enabled: boolean;
  device_lease_expires_at: string | null;
  connection_version: number;
  access_ip_allowlist: string[] | null;
  access_basic_user: string | null;
  access_basic_hash: string | null;
  access_policy_version: number;
  connection_limit_bps: number | null;
  connection_burst_bytes: number | null;
  connection_policy_version: number;
  user_limit_bps: number | null;
  user_burst_bytes: number | null;
  user_policy_version: number;
};

function gatewayPolicy(
  id: string,
  subdomain: string,
  overrides: Partial<TestPolicy> = {},
): TestPolicy {
  return {
    connection_id: id,
    user_id: "user-e2e",
    device_id: "device-e2e",
    subdomain,
    custom_domains: [],
    enabled: true,
    device_lease_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    connection_version: 1,
    access_ip_allowlist: null,
    access_basic_user: null,
    access_basic_hash: null,
    access_policy_version: 1,
    connection_limit_bps: null,
    connection_burst_bytes: null,
    connection_policy_version: 1,
    user_limit_bps: null,
    user_burst_bytes: null,
    user_policy_version: 1,
    ...overrides,
  };
}

function defaultConnections(): TestPolicy[] {
  return [
    gatewayPolicy("connection-service", "service"),
    // 独立用户避免限速桶影响其他用例；64KiB 突发 + 1MiB/s 限速使 128KiB 传输必然进入等待
    gatewayPolicy("connection-limited", "limited", {
      user_id: "user-limited",
      user_limit_bps: 8 * 1024 * 1024,
      user_burst_bytes: 64 * 1024,
    }),
    gatewayPolicy("connection-ipgate", "ipgate", {
      user_id: "user-ipgate",
      access_ip_allowlist: ["198.51.100.0/24", "2001:db8::/64"],
    }),
    gatewayPolicy("connection-basicgate", "basicgate", {
      user_id: "user-basicgate",
      access_basic_user: "svc",
      access_basic_hash: basicGateHash,
    }),
    gatewayPolicy("connection-dualgate", "dualgate", {
      user_id: "user-dualgate",
      access_ip_allowlist: ["198.51.100.0/24"],
      access_basic_user: "svc",
      access_basic_hash: basicGateHash,
    }),
  ];
}

function makeSnapshot(connections: TestPolicy[], revision = 7) {
  return {
    revision,
    generated_at: new Date().toISOString(),
    snapshot_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    tunnel_domain: tunnelDomain,
    connections,
  };
}

// ---------- 假上游（frps 替身）：回显请求、chunked 挂起、Upgrade 字节回声 ----------

const hangingResponses = new Set<ServerResponse>();
const upgradeCaptures: IncomingHttpHeaders[] = [];
const upgradeSockets = new Set<Duplex>();

const upstream = http.createServer((request, response) => {
  request.on("error", () => {});
  response.on("error", () => {});
  const url = request.url ?? "/";
  if (url.startsWith("/slow")) {
    response.writeHead(200, { "content-type": "application/octet-stream" });
    response.write("first-chunk");
    hangingResponses.add(response);
    response.once("close", () => hangingResponses.delete(response));
    return;
  }
  if (url.startsWith("/upload")) {
    request.resume();
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ received: true }));
    });
    return;
  }
  const chunks: Buffer[] = [];
  request.on("data", (chunk: Buffer) => chunks.push(chunk));
  request.on("end", () => {
    response.writeHead(200, {
      "content-type": "application/json",
      server: "fake-upstream",
      "x-upstream-marker": "1",
    });
    response.end(
      JSON.stringify({
        method: request.method,
        url,
        headers: request.headers,
        body: Buffer.concat(chunks).toString("base64"),
      }),
    );
  });
});
upstream.on("upgrade", (request, socket, head) => {
  upgradeCaptures.push({ ...request.headers });
  upgradeSockets.add(socket);
  socket.on("error", () => {});
  // http.Server 交给 upgrade 事件的 socket 是 allowHalfOpen 的：收到对端 FIN
  // 后必须主动销毁，否则半开连接会阻止 server.close() 完成、拖住进程退出
  socket.on("end", () => socket.destroy());
  socket.on("close", () => upgradeSockets.delete(socket));
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\n\r\n",
  );
  if (head.length) socket.write(head);
  socket.on("data", (chunk: Buffer) => socket.write(chunk));
});

// ---------- 假控制中心：策略快照/304 与样本上报捕获 ----------

let policySyncMode: "snapshot" | "unchanged" = "snapshot";
const policySyncRequests: IncomingHttpHeaders[] = [];
type UploadedBatch = { batch_id: string; samples: Array<Record<string, unknown>> };
const sampleUploads: Array<{ headers: IncomingHttpHeaders; body: UploadedBatch }> = [];

const controlCenter = http.createServer((request, response) => {
  request.on("error", () => {});
  response.on("error", () => {});
  const url = request.url ?? "/";
  if (url === "/internal/policies/sync") {
    policySyncRequests.push({ ...request.headers });
    if (policySyncMode === "unchanged") {
      response.writeHead(304, {
        "x-policy-snapshot-expires-at": new Date(Date.now() + 7_200_000).toISOString(),
      });
      response.end();
    } else {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(makeSnapshot(defaultConnections(), 5)));
    }
    return;
  }
  if (url === "/internal/traffic/samples" && request.method === "POST") {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      sampleUploads.push({
        headers: { ...request.headers },
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as UploadedBatch,
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
    return;
  }
  response.writeHead(404, { "content-type": "application/json" });
  response.end("{}");
});

// ---------- 启动顺序：先起假服务拿端口，再设环境变量，最后动态导入网关模块 ----------

function listen(server: http.Server, port = 0): Promise<number> {
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });
}

const upstreamPort = await listen(upstream);
const controlCenterPort = await listen(controlCenter);

process.env.INTERNAL_SERVICE_KEY = internalKey;
process.env.FRPS_VHOST_HOST = "127.0.0.1";
process.env.FRPS_VHOST_PORT = String(upstreamPort);
process.env.CONTROL_CENTER_URL = `http://127.0.0.1:${controlCenterPort}`;

const { accessStats, createGatewayServer, policies, samples, syncPolicies } =
  await import("./server.js");

const gateway = createGatewayServer();
const gatewayPort = await listen(gateway);

after(async () => {
  // 撤销全部策略：确定性关闭任何仍存活的代理流/升级隧道（closeAllConnections
  // 不覆盖已从 HTTP 管理中剥离的 upgrade socket），再关闭服务器
  policies.apply(makeSnapshot([], 999));
  for (const socket of upgradeSockets) socket.destroy();
  for (const response of hangingResponses) response.destroy();
  gateway.closeAllConnections();
  upstream.closeAllConnections();
  controlCenter.closeAllConnections();
  await Promise.all([closeServer(gateway), closeServer(upstream), closeServer(controlCenter)]);
});

// ---------- 测试基建 ----------

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

type GatewayResponse = { status: number; headers: IncomingHttpHeaders; body: Buffer };

function gatewayRequest(options: {
  method?: string;
  path: string;
  headers?: OutgoingHttpHeaders;
  body?: Buffer;
}): Promise<GatewayResponse> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        port: gatewayPort,
        method: options.method ?? "GET",
        path: options.path,
        headers: options.headers,
        agent: false,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.once("error", reject);
        response.once("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    request.once("error", reject);
    request.end(options.body);
  });
}

type EchoReply = { method: string; url: string; headers: IncomingHttpHeaders; body: string };

function parseEcho(response: GatewayResponse): EchoReply {
  return JSON.parse(response.body.toString("utf8")) as EchoReply;
}

function errorCode(response: GatewayResponse): string {
  return (JSON.parse(response.body.toString("utf8")) as { error_code: string }).error_code;
}

async function scrapeMetrics(): Promise<string> {
  const response = await gatewayRequest({
    path: "/metrics",
    headers: { "x-home-tunnel-key": internalKey },
  });
  assert.equal(response.status, 200);
  assert.match(String(response.headers["content-type"]), /^text\/plain/);
  return response.body.toString("utf8");
}

function metricValue(body: string, name: string): number {
  const line = body.split("\n").find((candidate) => candidate.startsWith(`${name} `));
  assert.ok(line, `metric ${name} missing`);
  return Number(line.slice(name.length + 1));
}

class SocketReader {
  private readonly chunks: Buffer[] = [];

  constructor(socket: net.Socket) {
    socket.on("data", (chunk: Buffer) => this.chunks.push(chunk));
  }

  get buffer(): Buffer {
    return Buffer.concat(this.chunks);
  }

  async waitFor(predicate: (data: Buffer) => boolean, milliseconds = 5000): Promise<Buffer> {
    const deadline = Date.now() + milliseconds;
    for (;;) {
      const data = this.buffer;
      if (predicate(data)) return data;
      if (Date.now() > deadline) throw new Error("timed out waiting for socket data");
      await delay(20);
    }
  }
}

function applyDefaultPolicies(): void {
  policies.apply(makeSnapshot(defaultConnections()));
}

// ---------- 用例 ----------

test("requests are rejected with 503 before any policy snapshot is applied", async () => {
  const response = await gatewayRequest({ path: "/echo", headers: { host: managedHost } });
  assert.equal(response.status, 503);
  assert.equal(errorCode(response), "POLICY_STALE");
});

test("syncPolicies performs an authenticated full sync and honors 304 freshness refresh", async () => {
  await syncPolicies();
  const first = policySyncRequests.at(0);
  assert.ok(first, "control center should observe a sync request");
  assert.equal(first["x-home-tunnel-key"], internalKey);
  assert.equal(first["if-none-match"], undefined);
  assert.equal(policies.revision, 5);
  assert.equal(policies.host(managedHost).policy?.connection_id, "connection-service");

  policySyncMode = "unchanged";
  const expiresBefore = policies.expiresAt;
  await syncPolicies();
  const second = policySyncRequests.at(1);
  assert.ok(second, "control center should observe a conditional sync request");
  assert.equal(second["if-none-match"], '"5"');
  assert.ok(policies.expiresAt > expiresBefore, "304 must refresh snapshot expiry");
  assert.equal(policies.revision, 5);
});

test("proxy round-trip sanitizes forwarding headers in both directions", async () => {
  applyDefaultPolicies();
  const requestBody = Buffer.from("payload-e2e-".repeat(8));
  const response = await gatewayRequest({
    method: "POST",
    path: "/echo",
    headers: {
      host: managedHost,
      "proxy-authorization": "Basic c3Bvb2Y=",
      te: "trailers",
      "x-forwarded-for": "spoofed-client",
      "x-forwarded-host": "spoof.example",
      "x-forwarded-proto": "gopher",
      "x-forwarded-port": "1234",
      "x-real-ip": "203.0.113.66",
      forwarded: "for=203.0.113.66",
      "x-custom-echo": "42",
      "content-type": "text/plain",
    },
    body: requestBody,
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.server, undefined, "upstream server header must be stripped");
  assert.equal(response.headers["x-upstream-marker"], "1");
  const echoed = parseEcho(response);
  assert.equal(echoed.method, "POST");
  assert.equal(echoed.url, "/echo");
  assert.equal(echoed.headers["proxy-authorization"], undefined);
  assert.equal(echoed.headers.te, undefined);
  assert.equal(echoed.headers.forwarded, undefined);
  assert.equal(echoed.headers["x-forwarded-port"], undefined);
  assert.equal(echoed.headers["x-forwarded-for"], "127.0.0.1");
  assert.equal(echoed.headers["x-real-ip"], "127.0.0.1");
  assert.equal(echoed.headers["x-forwarded-proto"], "https");
  assert.equal(echoed.headers["x-forwarded-host"], managedHost);
  assert.equal(echoed.headers.host, managedHost);
  assert.equal(echoed.headers["x-custom-echo"], "42");
  assert.equal(Buffer.from(echoed.body, "base64").toString("utf8"), requestBody.toString("utf8"));

  // 生产部署中最右 XFF 元素由可信的直连 Caddy 追加：是合法 IP 时按原样采信
  const trusted = await gatewayRequest({
    path: "/echo",
    headers: { host: managedHost, "x-forwarded-for": "198.51.100.7" },
  });
  assert.equal(parseEcho(trusted).headers["x-forwarded-for"], "198.51.100.7");
});

test("unknown subdomain, reserved subdomain, unmanaged host, and stale snapshot are mapped", async () => {
  applyDefaultPolicies();
  const missing = await gatewayRequest({
    path: "/echo",
    headers: { host: `missing.${tunnelDomain}` },
  });
  assert.equal(missing.status, 404);
  assert.equal(errorCode(missing), "CONNECTION_NOT_FOUND");

  const reserved = await gatewayRequest({
    path: "/echo",
    headers: { host: `console.${tunnelDomain}` },
  });
  assert.equal(reserved.status, 404);
  assert.equal(errorCode(reserved), "SUBDOMAIN_RESERVED");

  const unmanaged = await gatewayRequest({ path: "/echo", headers: { host: "evil.example" } });
  assert.equal(unmanaged.status, 421);
  assert.equal(errorCode(unmanaged), "HOST_INVALID");

  const savedExpiresAt = policies.expiresAt;
  try {
    policies.expiresAt = Date.now() - 1;
    const stale = await gatewayRequest({ path: "/echo", headers: { host: managedHost } });
    assert.equal(stale.status, 503);
    assert.equal(errorCode(stale), "POLICY_STALE");
  } finally {
    policies.expiresAt = savedExpiresAt;
  }
});

test("upstream connection refusal maps to 502 and records an error sample", async () => {
  applyDefaultPolicies();
  upstream.closeAllConnections();
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
  await delay(50);
  try {
    const response = await gatewayRequest({ path: "/echo", headers: { host: managedHost } });
    assert.equal(response.status, 502);
    assert.equal(errorCode(response), "UPSTREAM_UNAVAILABLE");
  } finally {
    await listen(upstream, upstreamPort);
  }
  await samples.flush();
  const upload = sampleUploads.at(-1);
  assert.ok(upload, "expected a sample batch upload");
  assert.equal(upload.headers["x-home-tunnel-key"], internalKey);
  const errored = upload.body.samples.find(
    (sample) =>
      String(sample.connection_id) === "connection-service" && Number(sample.error_count) >= 1,
  );
  assert.ok(errored, "expected an error sample for connection-service");
});

test("mid-transfer policy revocation severs the streaming client connection", async () => {
  applyDefaultPolicies();
  const request = http.request({
    host: "127.0.0.1",
    port: gatewayPort,
    path: "/slow",
    headers: { host: managedHost },
    agent: false,
  });
  const responsePromise = new Promise<IncomingMessage>((resolve, reject) => {
    request.once("response", resolve);
    request.once("error", reject);
  });
  request.end();
  const response = await withTimeout(responsePromise, 5000, "slow response headers");
  request.on("error", () => {});
  assert.equal(response.statusCode, 200);
  await withTimeout(once(response, "data"), 5000, "first body chunk");

  const during = await scrapeMetrics();
  assert.ok(
    metricValue(during, "home_tunnel_gateway_active_streams") >= 1,
    "streaming request must be registered",
  );

  const severed = new Promise<"clean-end" | "severed">((resolve) => {
    response.once("error", () => resolve("severed"));
    response.once("end", () => resolve("clean-end"));
    response.once("close", () => resolve(response.complete ? "clean-end" : "severed"));
  });
  policies.apply(makeSnapshot([], 8));
  assert.equal(await withTimeout(severed, 5000, "client connection to be severed"), "severed");
  applyDefaultPolicies();
});

test("websocket upgrade proxies bytes verbatim in both directions", async () => {
  applyDefaultPolicies();
  const socket = net.connect(gatewayPort, "127.0.0.1");
  socket.on("error", () => {});
  await withTimeout(once(socket, "connect"), 5000, "websocket client connect");
  const reader = new SocketReader(socket);
  socket.write(
    `GET /ws HTTP/1.1\r\n` +
      `host: ${managedHost}\r\n` +
      `connection: Upgrade\r\n` +
      `upgrade: websocket\r\n` +
      `sec-websocket-version: 13\r\n` +
      `sec-websocket-key: ZTJlLXRlc3Qta2V5LTEyMw==\r\n` +
      `\r\n`,
  );
  const headerEndMarker = Buffer.from("\r\n\r\n");
  const handshake = await reader.waitFor((data) => data.includes(headerEndMarker));
  assert.match(handshake.toString("latin1"), /^HTTP\/1\.1 101 /);
  const headerEnd = handshake.indexOf(headerEndMarker) + headerEndMarker.length;

  const frame = Buffer.concat([
    Buffer.from([0x81, 0x85, 0x01, 0x02, 0x03, 0x04]),
    Buffer.from("hello"),
  ]);
  socket.write(frame);
  const stream = await reader.waitFor((data) => data.length >= headerEnd + frame.length);
  assert.deepEqual(stream.subarray(headerEnd, headerEnd + frame.length), frame);

  const upgradeHeaders = upgradeCaptures.at(-1);
  assert.ok(upgradeHeaders, "fake upstream should observe the upgrade request");
  assert.equal(String(upgradeHeaders.upgrade).toLowerCase(), "websocket");
  assert.equal(upgradeHeaders["x-forwarded-for"], "127.0.0.1");
  assert.equal(upgradeHeaders["x-forwarded-proto"], "https");

  // 升级隧道两端均为 allowHalfOpen socket，仅销毁客户端要等对端收尾；
  // 通过策略撤销走网关自身的 close() 路径，确定性拆除整条隧道
  const socketClosed = once(socket, "close");
  policies.apply(makeSnapshot([], 9));
  socket.destroy();
  await withTimeout(socketClosed, 5000, "websocket tunnel teardown");
  applyDefaultPolicies();
});

test("client reset mid-upload leaves the gateway serving subsequent requests", async () => {
  applyDefaultPolicies();
  const socket = net.connect(gatewayPort, "127.0.0.1");
  socket.on("error", () => {});
  await withTimeout(once(socket, "connect"), 5000, "upload client connect");
  socket.write(
    `POST /upload HTTP/1.1\r\n` +
      `host: ${managedHost}\r\n` +
      `content-length: 1048576\r\n` +
      `\r\n`,
  );
  socket.write("partial-upload-bytes");
  await delay(150);
  socket.resetAndDestroy();
  await delay(150);
  const followup = await gatewayRequest({ path: "/echo", headers: { host: managedHost } });
  assert.equal(followup.status, 200);
  assert.equal(parseEcho(followup).url, "/echo");
});

test("metrics endpoint stays hidden without the exact internal key", async () => {
  const missingKey = await gatewayRequest({ path: "/metrics", headers: { host: managedHost } });
  assert.equal(missingKey.status, 404);
  assert.equal(errorCode(missingKey), "CONNECTION_NOT_FOUND");

  const wrongKey = await gatewayRequest({
    path: "/metrics",
    headers: { "x-home-tunnel-key": "22".repeat(32) },
  });
  assert.equal(wrongKey.status, 404);

  const shortKey = await gatewayRequest({
    path: "/metrics",
    headers: { "x-home-tunnel-key": "nope" },
  });
  assert.equal(shortKey.status, 404);
});

test("metrics counters advance with proxied traffic and limiter waits", async () => {
  applyDefaultPolicies();
  const before = await scrapeMetrics();
  assert.equal(metricValue(before, "home_tunnel_gateway_up"), 1);

  const uploadBody = Buffer.alloc(2048, 120);
  const proxied = await gatewayRequest({
    method: "POST",
    path: "/echo",
    headers: { host: managedHost, "content-type": "application/octet-stream" },
    body: uploadBody,
  });
  assert.equal(proxied.status, 200);

  const throttledBody = Buffer.alloc(128 * 1024, 97);
  const throttled = await gatewayRequest({
    method: "POST",
    path: "/echo",
    headers: { host: limitedHost, "content-type": "application/octet-stream" },
    body: throttledBody,
  });
  assert.equal(throttled.status, 200);

  const afterBody = await scrapeMetrics();
  assert.equal(metricValue(afterBody, "home_tunnel_gateway_up"), 1);
  assert.equal(metricValue(afterBody, "home_tunnel_gateway_policy_revision"), policies.revision);
  assert.ok(metricValue(afterBody, "home_tunnel_gateway_policy_age_seconds") >= 0);
  assert.ok(metricValue(afterBody, "home_tunnel_gateway_active_streams") >= 0);
  assert.ok(
    metricValue(afterBody, "home_tunnel_gateway_requests_total") >=
      metricValue(before, "home_tunnel_gateway_requests_total") + 2,
  );
  assert.ok(
    metricValue(afterBody, 'home_tunnel_gateway_bytes_total{direction="upload"}') >=
      metricValue(before, 'home_tunnel_gateway_bytes_total{direction="upload"}') +
        uploadBody.length +
        throttledBody.length,
  );
  assert.ok(
    metricValue(afterBody, 'home_tunnel_gateway_bytes_total{direction="download"}') >
      metricValue(before, 'home_tunnel_gateway_bytes_total{direction="download"}'),
  );
  assert.ok(metricValue(afterBody, "home_tunnel_gateway_upstream_errors_total") >= 1);
  assert.ok(metricValue(afterBody, "home_tunnel_gateway_sample_buffer_size") >= 1);
  assert.ok(
    metricValue(afterBody, "home_tunnel_gateway_throttle_wait_seconds_total") >
      metricValue(before, "home_tunnel_gateway_throttle_wait_seconds_total"),
    "throttled upload must accumulate limiter wait time",
  );
});

// ---------- 访问控制门禁（功能 1）----------

test("IP allowlist admits matching clients and rejects others with 403", async () => {
  applyDefaultPolicies();
  const deniedBefore = metricValue(
    await scrapeMetrics(),
    'home_tunnel_gateway_access_denied_total{reason="ip"}',
  );

  // 生产部署中最右 XFF 由可信 Caddy 追加，即门禁使用的可信客户端 IP
  const allowedIpv4 = await gatewayRequest({
    path: "/echo",
    headers: { host: ipGatedHost, "x-forwarded-for": "198.51.100.7" },
  });
  assert.equal(allowedIpv4.status, 200);
  assert.equal(parseEcho(allowedIpv4).headers["x-forwarded-for"], "198.51.100.7");

  const allowedIpv6 = await gatewayRequest({
    path: "/echo",
    headers: { host: ipGatedHost, "x-forwarded-for": "2001:db8::42" },
  });
  assert.equal(allowedIpv6.status, 200);

  const deniedForeign = await gatewayRequest({
    path: "/echo",
    headers: { host: ipGatedHost, "x-forwarded-for": "203.0.113.9" },
  });
  assert.equal(deniedForeign.status, 403);
  assert.equal(errorCode(deniedForeign), "ACCESS_IP_FORBIDDEN");

  // 无 XFF 时取 socket 对端地址（127.0.0.1），不在白名单内：fail-closed
  const deniedLoopback = await gatewayRequest({ path: "/echo", headers: { host: ipGatedHost } });
  assert.equal(deniedLoopback.status, 403);
  assert.equal(errorCode(deniedLoopback), "ACCESS_IP_FORBIDDEN");

  const deniedAfter = metricValue(
    await scrapeMetrics(),
    'home_tunnel_gateway_access_denied_total{reason="ip"}',
  );
  assert.ok(deniedAfter >= deniedBefore + 2, "denied requests must advance the ip counter");
});

test("Basic Auth gate challenges, rejects bad credentials, and hides the header from upstream", async () => {
  applyDefaultPolicies();
  const deniedBefore = metricValue(
    await scrapeMetrics(),
    'home_tunnel_gateway_access_denied_total{reason="basic"}',
  );

  const missing = await gatewayRequest({ path: "/echo", headers: { host: basicGatedHost } });
  assert.equal(missing.status, 401);
  assert.equal(missing.headers["www-authenticate"], 'Basic realm="Home Tunnel"');
  assert.equal(errorCode(missing), "ACCESS_BASIC_UNAUTHORIZED");

  const malformed = await gatewayRequest({
    path: "/echo",
    headers: { host: basicGatedHost, authorization: "Bearer not-basic" },
  });
  assert.equal(malformed.status, 401);
  assert.equal(malformed.headers["www-authenticate"], 'Basic realm="Home Tunnel"');

  const wrongPassword = await gatewayRequest({
    path: "/echo",
    headers: { host: basicGatedHost, authorization: basicHeader("svc", "wrong password") },
  });
  assert.equal(wrongPassword.status, 401);

  const wrongUser = await gatewayRequest({
    path: "/echo",
    headers: { host: basicGatedHost, authorization: basicHeader("intruder", basicGatePassword) },
  });
  assert.equal(wrongUser.status, 401);

  const accepted = await gatewayRequest({
    path: "/echo",
    headers: { host: basicGatedHost, authorization: basicHeader("svc", basicGatePassword) },
  });
  assert.equal(accepted.status, 200);
  // 门禁凭据不得泄漏给后端
  assert.equal(parseEcho(accepted).headers.authorization, undefined);

  const deniedAfter = metricValue(
    await scrapeMetrics(),
    'home_tunnel_gateway_access_denied_total{reason="basic"}',
  );
  assert.ok(deniedAfter >= deniedBefore + 4, "denied requests must advance the basic counter");
});

test("authorization passes through untouched when no Basic gate is configured", async () => {
  applyDefaultPolicies();
  const forwarded = await gatewayRequest({
    path: "/echo",
    headers: { host: managedHost, authorization: "Bearer upstream-app-token" },
  });
  assert.equal(forwarded.status, 200);
  assert.equal(parseEcho(forwarded).headers.authorization, "Bearer upstream-app-token");
});

test("Basic Auth verification is memoized until the access policy version changes", async () => {
  applyDefaultPolicies();
  const header = basicHeader("svc", basicGatePassword);
  const first = await gatewayRequest({
    path: "/echo",
    headers: { host: basicGatedHost, authorization: header },
  });
  assert.equal(first.status, 200);
  const verificationsAfterFirst = accessStats.scryptVerifications;
  const hitsAfterFirst = accessStats.basicCacheHits;

  const second = await gatewayRequest({
    path: "/echo",
    headers: { host: basicGatedHost, authorization: header },
  });
  assert.equal(second.status, 200);
  assert.equal(
    accessStats.scryptVerifications,
    verificationsAfterFirst,
    "repeat credentials must not re-run scrypt",
  );
  assert.ok(
    accessStats.basicCacheHits > hitsAfterFirst,
    "repeat credentials must hit the memo cache",
  );

  // access_policy_version 变化（如改口令/重设门禁）后旧缓存键失效，需重新验证
  const rotated = defaultConnections().map((connection) =>
    connection.connection_id === "connection-basicgate"
      ? { ...connection, access_policy_version: 2 }
      : connection,
  );
  policies.apply(makeSnapshot(rotated, 11));
  const third = await gatewayRequest({
    path: "/echo",
    headers: { host: basicGatedHost, authorization: header },
  });
  assert.equal(third.status, 200);
  assert.equal(
    accessStats.scryptVerifications,
    verificationsAfterFirst + 1,
    "policy version change must invalidate the cache",
  );
  applyDefaultPolicies();
});

test("upgrade path enforces IP and Basic gates before proxying", async () => {
  applyDefaultPolicies();

  async function upgradeAttempt(host: string, extraHeaders: string): Promise<Buffer> {
    const socket = net.connect(gatewayPort, "127.0.0.1");
    socket.on("error", () => {});
    await withTimeout(once(socket, "connect"), 5000, "upgrade gate client connect");
    const reader = new SocketReader(socket);
    socket.write(
      `GET /ws HTTP/1.1\r\n` +
        `host: ${host}\r\n` +
        `connection: Upgrade\r\n` +
        `upgrade: websocket\r\n` +
        `sec-websocket-version: 13\r\n` +
        `sec-websocket-key: ZTJlLXRlc3Qta2V5LTEyMw==\r\n` +
        extraHeaders +
        `\r\n`,
    );
    const data = await reader.waitFor((buffer) => buffer.includes(Buffer.from("\r\n\r\n")));
    socket.destroy();
    return data;
  }

  const ipDenied = await upgradeAttempt(ipGatedHost, "");
  assert.match(ipDenied.toString("latin1"), /^HTTP\/1\.1 403 /);

  const ipAllowed = await upgradeAttempt(ipGatedHost, `x-forwarded-for: 198.51.100.7\r\n`);
  assert.match(ipAllowed.toString("latin1"), /^HTTP\/1\.1 101 /);

  const basicMissing = await upgradeAttempt(basicGatedHost, "");
  assert.match(basicMissing.toString("latin1"), /^HTTP\/1\.1 401 /);
  assert.match(basicMissing.toString("latin1"), /www-authenticate: Basic realm="Home Tunnel"/i);

  const basicWrong = await upgradeAttempt(
    basicGatedHost,
    `authorization: ${basicHeader("svc", "bad password")}\r\n`,
  );
  assert.match(basicWrong.toString("latin1"), /^HTTP\/1\.1 401 /);

  const basicAccepted = await upgradeAttempt(
    basicGatedHost,
    `authorization: ${basicHeader("svc", basicGatePassword)}\r\n`,
  );
  assert.match(basicAccepted.toString("latin1"), /^HTTP\/1\.1 101 /);
  const upgradeHeaders = upgradeCaptures.at(-1);
  assert.ok(upgradeHeaders, "fake upstream should observe the authorized upgrade");
  assert.equal(upgradeHeaders.authorization, undefined, "gate credentials must not leak upstream");
});

test("stacked gates check the IP allowlist before Basic Auth", async () => {
  applyDefaultPolicies();
  const header = basicHeader("svc", basicGatePassword);

  const ipRejected = await gatewayRequest({
    path: "/echo",
    headers: { host: dualGatedHost, "x-forwarded-for": "203.0.113.9", authorization: header },
  });
  assert.equal(ipRejected.status, 403);
  assert.equal(errorCode(ipRejected), "ACCESS_IP_FORBIDDEN");

  const basicChallenged = await gatewayRequest({
    path: "/echo",
    headers: { host: dualGatedHost, "x-forwarded-for": "198.51.100.7" },
  });
  assert.equal(basicChallenged.status, 401);

  const admitted = await gatewayRequest({
    path: "/echo",
    headers: { host: dualGatedHost, "x-forwarded-for": "198.51.100.7", authorization: header },
  });
  assert.equal(admitted.status, 200);
  assert.equal(parseEcho(admitted).headers.authorization, undefined);
});
