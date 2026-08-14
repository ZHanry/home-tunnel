import { readFileSync } from "node:fs";
import http from "node:http";

function integer(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function secret(name: string, fileName: string): string {
  const inline = process.env[name]?.trim();
  if (inline) return inline;
  const path = process.env[fileName]?.trim();
  if (path) return readFileSync(path, "utf8").trim();
  throw new Error(`${name} or ${fileName} is required`);
}

export const config = {
  port: integer("PORT", 8080),
  controlCenterUrl: process.env.CONTROL_CENTER_URL ?? "http://control-center:8080",
  upstreamHost: process.env.FRPS_VHOST_HOST ?? "frps",
  upstreamPort: integer("FRPS_VHOST_PORT", 8080),
  internalKey: secret("INTERNAL_SERVICE_KEY", "INTERNAL_SERVICE_KEY_FILE"),
  policyFullSyncMs: integer("POLICY_FULL_SYNC_MS", 5 * 60 * 1000),
  policyReconnectMs: integer("POLICY_RECONNECT_MS", 3000),
  sampleBucketSeconds: integer("SAMPLE_BUCKET_SECONDS", 60),
  maxBodyChunkBytes: integer("MAX_BODY_CHUNK_BYTES", 64 * 1024),
};

export const upstreamAgent = new http.Agent({ keepAlive: true, maxSockets: 256 });
export const upstreamHeadersTimeoutMs = 30_000;
export const upstreamConnectTimeoutMs = 30_000;
export const policyEventIdleTimeoutMs = 90_000;
