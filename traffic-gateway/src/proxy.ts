import http, {
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import net, { type Socket } from "node:net";
import { clientIp } from "./access-control.js";
import {
  config,
  upstreamAgent,
  upstreamConnectTimeoutMs,
  upstreamHeadersTimeoutMs,
} from "./config.js";
import { limiter, ThrottleTransform } from "./rate-limit.js";
import { log } from "./observability.js";
import { type Policy, policies } from "./policy.js";
import { samples } from "./sampling.js";

export function sanitizedHeaders(
  request: IncomingMessage,
  forUpgrade = false,
  stripAuthorization = false,
): IncomingHttpHeaders {
  const headers = { ...request.headers };
  for (const name of [
    "proxy-authorization",
    "proxy-authenticate",
    "proxy-connection",
    "forwarded",
    "x-forwarded-for",
    "x-forwarded-host",
    "x-forwarded-port",
    "x-forwarded-proto",
    "x-real-ip",
  ])
    delete headers[name];
  if (stripAuthorization) delete headers.authorization;
  if (!forUpgrade)
    for (const name of [
      "connection",
      "keep-alive",
      "te",
      "trailer",
      "transfer-encoding",
      "upgrade",
    ])
      delete headers[name];
  const source = clientIp(request);
  headers["x-forwarded-for"] = source;
  headers["x-real-ip"] = source;
  headers["x-forwarded-host"] = request.headers.host ?? "";
  headers["x-forwarded-proto"] = "https";
  return headers;
}

function sanitizedResponseHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const output = { ...headers };
  for (const name of [
    "server",
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
  ])
    delete output[name];
  return output;
}

export function controlledError(
  response: ServerResponse,
  status: number,
  errorCode: string,
  message: string,
): void {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify({ error_code: errorCode, message }));
}

export function proxyRequest(
  request: IncomingMessage,
  response: ServerResponse,
  policy: Policy,
  stripAuthorization: boolean,
): void {
  samples.request(policy);
  const controller = new AbortController();
  const upstream = http.request({
    host: config.upstreamHost,
    port: config.upstreamPort,
    method: request.method,
    path: request.url,
    headers: sanitizedHeaders(request, false, stripAuthorization),
    agent: upstreamAgent,
  });
  upstream.setTimeout(upstreamHeadersTimeoutMs, () =>
    upstream.destroy(new Error("UPSTREAM_TIMEOUT")),
  );
  let finished = false;
  let unregister: () => void = () => {};
  const finish = (reason?: Error) => {
    if (finished) return;
    finished = true;
    unregister();
    controller.abort();
    if (reason) {
      if (!upstream.destroyed) upstream.destroy(reason);
      if (!response.destroyed) response.destroy();
    }
  };
  unregister = policies.register(policy.connection_id, () => finish(new Error("POLICY_REVOKED")));
  response.once("close", () =>
    finish(response.writableFinished ? undefined : new Error("CLIENT_CLOSED")),
  );
  request.once("error", finish);
  response.once("error", finish);
  upstream.on("response", (upstreamResponse) => {
    upstream.setTimeout(0);
    response.writeHead(
      upstreamResponse.statusCode ?? 502,
      sanitizedResponseHeaders(upstreamResponse.headers),
    );
    const throttled = new ThrottleTransform(policy.connection_id, "download", controller);
    throttled.once("error", finish);
    upstreamResponse.once("error", finish);
    upstreamResponse.pipe(throttled).pipe(response);
  });
  upstream.on("error", (error) => {
    if (finished && error.message !== "POLICY_REVOKED") return;
    samples.error(policy);
    log("warn", "UPSTREAM_ERROR", error.message, { connection_id: policy.connection_id });
    const revoked = error.message === "POLICY_REVOKED";
    controlledError(
      response,
      revoked ? 423 : 502,
      revoked ? "CONNECTION_DISABLED" : "UPSTREAM_UNAVAILABLE",
      "隧道上游暂不可用",
    );
    finish(error);
  });
  const upload = new ThrottleTransform(policy.connection_id, "upload", controller);
  upload.once("error", (error) => {
    const revoked = error.message === "POLICY_REVOKED";
    controlledError(
      response,
      revoked ? 423 : 502,
      revoked ? "CONNECTION_DISABLED" : "UPSTREAM_UNAVAILABLE",
      "隧道上游暂不可用",
    );
    finish(error);
  });
  request.pipe(upload).pipe(upstream);
}

function writeUpgradeRequest(
  request: IncomingMessage,
  upstream: Socket,
  stripAuthorization: boolean,
): void {
  const headers = sanitizedHeaders(request, true, stripAuthorization);
  let data = `${request.method ?? "GET"} ${request.url ?? "/"} HTTP/${request.httpVersion}\r\n`;
  for (const [key, value] of Object.entries(headers)) {
    if (value == null) continue;
    if (Array.isArray(value)) for (const item of value) data += `${key}: ${item}\r\n`;
    else data += `${key}: ${value}\r\n`;
  }
  upstream.write(`${data}\r\n`);
}

export function rejectUpgrade(client: Socket, statusLine: string, extraHeaderLines = ""): void {
  if (client.destroyed) return;
  client.write(
    `HTTP/1.1 ${statusLine}\r\nConnection: close\r\n${extraHeaderLines}Content-Length: 0\r\n\r\n`,
  );
  client.destroySoon();
}

export function proxyUpgrade(
  request: IncomingMessage,
  client: Socket,
  head: Buffer,
  policy: Policy,
  stripAuthorization: boolean,
): void {
  samples.request(policy);
  const controller = new AbortController();
  const upstream = net.connect(config.upstreamPort, config.upstreamHost);
  upstream.setTimeout(upstreamConnectTimeoutMs, () =>
    upstream.destroy(new Error("UPSTREAM_CONNECT_TIMEOUT")),
  );
  let closed = false;
  let unregister: () => void = () => {};
  const close = () => {
    if (closed) return;
    closed = true;
    unregister();
    controller.abort();
    client.destroy();
    upstream.destroy();
  };
  unregister = policies.register(policy.connection_id, close);
  upstream.once("connect", () => {
    upstream.setTimeout(0);
    writeUpgradeRequest(request, upstream, stripAuthorization);
    if (head.length)
      void limiter
        .acquire(policy.connection_id, head.length, controller.signal)
        .then(() => {
          samples.record(policy, "upload", head.length);
          upstream.write(head);
        })
        .catch(close);
    const upload = new ThrottleTransform(policy.connection_id, "upload", controller);
    const download = new ThrottleTransform(policy.connection_id, "download", controller);
    upload.once("error", close);
    download.once("error", close);
    client.pipe(upload).pipe(upstream);
    upstream.pipe(download).pipe(client);
  });
  upstream.on("error", (error) => {
    samples.error(policy);
    log("warn", "UPGRADE_UPSTREAM_ERROR", error.message, { connection_id: policy.connection_id });
    close();
  });
  client.on("error", close);
  client.on("close", close);
  upstream.on("close", close);
}
