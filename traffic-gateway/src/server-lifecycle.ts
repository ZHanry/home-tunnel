import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import {
  basicAuthChallenge,
  clientIp,
  constantTimeStringEqual,
  verifyBasicAuthorization,
} from "./access-control.js";
import { config, policyEventIdleTimeoutMs } from "./config.js";
import { log, metrics } from "./observability.js";
import { policies, syncPolicies } from "./policy.js";
import { controlledError, proxyRequest, proxyUpgrade, rejectUpgrade } from "./proxy.js";
import { samples } from "./sampling.js";

function renderMetrics(): string {
  const policyAgeSeconds = policies.lastSuccessAt
    ? (Date.now() - policies.lastSuccessAt) / 1000
    : -1;
  const lines = [
    "# HELP home_tunnel_gateway_up Traffic gateway process is running.",
    "# TYPE home_tunnel_gateway_up gauge",
    "home_tunnel_gateway_up 1",
    "# HELP home_tunnel_gateway_policy_revision Revision of the applied policy snapshot.",
    "# TYPE home_tunnel_gateway_policy_revision gauge",
    `home_tunnel_gateway_policy_revision ${policies.revision}`,
    "# HELP home_tunnel_gateway_policy_age_seconds Seconds since the last successful policy sync (-1 before the first sync).",
    "# TYPE home_tunnel_gateway_policy_age_seconds gauge",
    `home_tunnel_gateway_policy_age_seconds ${policyAgeSeconds}`,
    "# HELP home_tunnel_gateway_active_streams Proxied streams currently registered for revocation.",
    "# TYPE home_tunnel_gateway_active_streams gauge",
    `home_tunnel_gateway_active_streams ${policies.activeStreamCount}`,
    "# HELP home_tunnel_gateway_bytes_total Proxied payload bytes by direction.",
    "# TYPE home_tunnel_gateway_bytes_total counter",
    `home_tunnel_gateway_bytes_total{direction="upload"} ${metrics.bytesTotal.upload}`,
    `home_tunnel_gateway_bytes_total{direction="download"} ${metrics.bytesTotal.download}`,
    "# HELP home_tunnel_gateway_requests_total Authorized proxied requests and upgrades.",
    "# TYPE home_tunnel_gateway_requests_total counter",
    `home_tunnel_gateway_requests_total ${metrics.requestsTotal}`,
    "# HELP home_tunnel_gateway_upstream_errors_total Upstream connection failures.",
    "# TYPE home_tunnel_gateway_upstream_errors_total counter",
    `home_tunnel_gateway_upstream_errors_total ${metrics.upstreamErrorsTotal}`,
    "# HELP home_tunnel_gateway_access_denied_total Requests rejected by per-connection access control gates.",
    "# TYPE home_tunnel_gateway_access_denied_total counter",
    `home_tunnel_gateway_access_denied_total{reason="ip"} ${metrics.accessDeniedTotal.ip}`,
    `home_tunnel_gateway_access_denied_total{reason="basic"} ${metrics.accessDeniedTotal.basic}`,
    "# HELP home_tunnel_gateway_sample_buffer_size Traffic samples buffered for upload to the control center.",
    "# TYPE home_tunnel_gateway_sample_buffer_size gauge",
    `home_tunnel_gateway_sample_buffer_size ${samples.bufferedSampleCount}`,
    "# HELP home_tunnel_gateway_throttle_wait_seconds_total Seconds spent waiting on rate limiter buckets.",
    "# TYPE home_tunnel_gateway_throttle_wait_seconds_total counter",
    `home_tunnel_gateway_throttle_wait_seconds_total ${metrics.throttleWaitSecondsTotal}`,
  ];
  return `${lines.join("\n")}\n`;
}

function handleRequest(request: IncomingMessage, response: ServerResponse): void {
  if (
    request.url === "/healthz" &&
    [
      "127.0.0.1:8080",
      "localhost:8080",
      "traffic-gateway:8080",
      "home-tunnel-traffic-gateway:8080",
    ].includes(request.headers.host ?? "")
  ) {
    response.writeHead(policies.valid() ? 200 : 503, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        status: policies.valid() ? "healthy" : "stale",
        revision: policies.revision,
        policy_age_seconds: policies.lastSuccessAt
          ? Math.round((Date.now() - policies.lastSuccessAt) / 1000)
          : null,
      }),
    );
    return;
  }
  if (request.url === "/metrics") {
    const providedKey = request.headers["x-home-tunnel-key"];
    if (
      typeof providedKey !== "string" ||
      !constantTimeStringEqual(providedKey, config.internalKey)
    ) {
      controlledError(response, 404, "CONNECTION_NOT_FOUND", "未分配该业务子域");
      return;
    }
    response.writeHead(200, {
      "content-type": "text/plain; version=0.0.4; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(renderMetrics());
    return;
  }
  const authorized = policies.host(request.headers.host);
  if (!authorized.policy) {
    const mapping = {
      stale: [503, "POLICY_STALE", "策略快照不可用，请稍后重试"],
      reserved: [404, "SUBDOMAIN_RESERVED", "该主机名不可用于业务连接"],
      invalid: [421, "HOST_INVALID", "请求主机名不受 Home Tunnel 管理"],
      not_found: [404, "CONNECTION_NOT_FOUND", "未分配该业务子域"],
    } as const;
    const [status, code, message] = mapping[authorized.error ?? "invalid"];
    controlledError(response, status, code, message);
    return;
  }
  const policy = authorized.policy;
  if (!policies.ipAllowed(policy, clientIp(request))) {
    metrics.accessDeniedTotal.ip += 1;
    controlledError(response, 403, "ACCESS_IP_FORBIDDEN", "来源 IP 不在该连接的白名单内");
    return;
  }
  if (policy.access_basic_user != null) {
    const authorizationHeader = request.headers.authorization;
    if (typeof authorizationHeader !== "string" || !authorizationHeader) {
      basicAuthChallenge(response);
      return;
    }
    request.on("error", () => {});
    void verifyBasicAuthorization(policy, authorizationHeader)
      .then((allowed) => {
        if (request.destroyed || response.destroyed) return;
        if (!allowed) {
          basicAuthChallenge(response);
          return;
        }
        proxyRequest(request, response, policy, true);
      })
      .catch(() => basicAuthChallenge(response));
    return;
  }
  proxyRequest(request, response, policy, false);
}

function handleUpgrade(request: IncomingMessage, client: Socket, head: Buffer): void {
  const authorized = policies.host(request.headers.host);
  if (!authorized.policy) {
    client.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    return;
  }
  const policy = authorized.policy;
  client.on("error", () => {});
  if (!policies.ipAllowed(policy, clientIp(request))) {
    metrics.accessDeniedTotal.ip += 1;
    rejectUpgrade(client, "403 Forbidden");
    return;
  }
  if (policy.access_basic_user != null) {
    const authorizationHeader = request.headers.authorization;
    if (typeof authorizationHeader !== "string" || !authorizationHeader) {
      metrics.accessDeniedTotal.basic += 1;
      rejectUpgrade(client, "401 Unauthorized", 'WWW-Authenticate: Basic realm="Home Tunnel"\r\n');
      return;
    }
    void verifyBasicAuthorization(policy, authorizationHeader)
      .then((allowed) => {
        if (client.destroyed) return;
        if (!allowed) {
          metrics.accessDeniedTotal.basic += 1;
          rejectUpgrade(
            client,
            "401 Unauthorized",
            'WWW-Authenticate: Basic realm="Home Tunnel"\r\n',
          );
          return;
        }
        proxyUpgrade(request, client, head, policy, true);
      })
      .catch(() =>
        rejectUpgrade(
          client,
          "401 Unauthorized",
          'WWW-Authenticate: Basic realm="Home Tunnel"\r\n',
        ),
      );
    return;
  }
  proxyUpgrade(request, client, head, policy, false);
}

export function createGatewayServer(): http.Server {
  const server = http.createServer(handleRequest);
  server.on("upgrade", handleUpgrade);
  server.requestTimeout = 0;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 65_000;
  return server;
}

function waitForReconnect(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(done, milliseconds);
    function done() {
      signal.removeEventListener("abort", aborted);
      resolve();
    }
    function aborted() {
      clearTimeout(timer);
      done();
    }
    signal.addEventListener("abort", aborted, { once: true });
  });
}

async function consumePolicyEvents(
  response: Response,
  signal: AbortSignal,
  onEvent: () => void,
  connection: AbortController,
): Promise<void> {
  if (!response.body) throw new Error("policy event stream has no body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!signal.aborted) {
      const idleTimer = setTimeout(
        () => connection.abort(new Error("policy event stream idle timeout")),
        policyEventIdleTimeoutMs,
      );
      let chunk: Awaited<ReturnType<typeof reader.read>>;
      try {
        chunk = await reader.read();
      } finally {
        clearTimeout(idleTimer);
      }
      if (chunk.done) throw new Error("policy event stream closed");
      buffer += decoder.decode(chunk.value, { stream: true }).replaceAll("\r\n", "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const message = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = message
          .split("\n")
          .find((line) => line.startsWith("event:"))
          ?.slice(6)
          .trim();
        if (event === "policy" || event === "ready") onEvent();
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

async function watchPolicyEvents(signal: AbortSignal, onEvent: () => void): Promise<void> {
  while (!signal.aborted) {
    const connection = new AbortController();
    const forwardAbort = () => connection.abort(signal.reason);
    signal.addEventListener("abort", forwardAbort, { once: true });
    const connectTimeout = setTimeout(
      () => connection.abort(new Error("policy event connection timeout")),
      10_000,
    );
    try {
      const response = await fetch(`${config.controlCenterUrl}/internal/policies/events`, {
        headers: { "x-home-tunnel-key": config.internalKey, accept: "text/event-stream" },
        signal: connection.signal,
      });
      clearTimeout(connectTimeout);
      if (!response.ok) throw new Error(`policy event stream returned ${response.status}`);
      log("info", "POLICY_EVENTS_CONNECTED", "Policy push channel connected");
      await consumePolicyEvents(response, signal, onEvent, connection);
    } catch (error) {
      clearTimeout(connectTimeout);
      if (!signal.aborted)
        log(
          "warn",
          "POLICY_EVENTS_DISCONNECTED",
          error instanceof Error ? error.message : "Policy push channel disconnected",
        );
    } finally {
      signal.removeEventListener("abort", forwardAbort);
    }
    if (!signal.aborted) await waitForReconnect(config.policyReconnectMs, signal);
  }
}

async function initialPolicySync(): Promise<void> {
  let delayMs = 1000;
  for (;;) {
    try {
      await syncPolicies();
      return;
    } catch (error) {
      log(
        "warn",
        "POLICY_SYNC_FAILED",
        error instanceof Error ? error.message : "Unknown policy error",
        { retry_in_ms: delayMs },
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      delayMs = Math.min(delayMs * 2, 30_000);
    }
  }
}

export async function main(): Promise<void> {
  await initialPolicySync();
  let syncing = false;
  let syncAgain = false;
  const requestSync = () => {
    if (syncing) {
      syncAgain = true;
      return;
    }
    syncing = true;
    void (async () => {
      do {
        syncAgain = false;
        await syncPolicies();
      } while (syncAgain);
    })()
      .catch((error) =>
        log(
          "warn",
          "POLICY_SYNC_FAILED",
          error instanceof Error ? error.message : "Unknown policy error",
        ),
      )
      .finally(() => {
        syncing = false;
        if (syncAgain) requestSync();
      });
  };
  const policyEvents = new AbortController();
  void watchPolicyEvents(policyEvents.signal, requestSync);
  const policyTimer = setInterval(requestSync, config.policyFullSyncMs);
  const sampleTimer = setInterval(() => void samples.flush(), config.sampleBucketSeconds * 1000);
  const expiryTimer = setInterval(() => {
    if (policies.enforceExpiry())
      log(
        "warn",
        "POLICY_AUTHORIZATION_EXPIRED",
        "Expired policy authorization closed active streams",
      );
  }, 1000);
  const server = createGatewayServer();
  await new Promise<void>((resolve) => server.listen(config.port, "0.0.0.0", resolve));
  log("info", "SERVER_STARTED", "Traffic gateway started", {
    port: config.port,
    revision: policies.revision,
  });
  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    policyEvents.abort();
    clearInterval(policyTimer);
    clearInterval(sampleTimer);
    clearInterval(expiryTimer);
    await samples.flush();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
    log("info", "SERVER_STOPPING", "Traffic gateway stopping", { signal });
  };
  process.on("SIGTERM", () => void stop("SIGTERM"));
  process.on("SIGINT", () => void stop("SIGINT"));
}
