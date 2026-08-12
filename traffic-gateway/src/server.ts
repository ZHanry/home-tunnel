import { readFileSync } from "node:fs";
import http, { type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http";
import net, { type Socket } from "node:net";
import { randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { Transform, type TransformCallback } from "node:stream";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

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

const config = {
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

const upstreamAgent = new http.Agent({ keepAlive: true, maxSockets: 256 });
// 等待上游响应头阶段的 socket 空闲超时；响应头到达后清除，避免误杀长轮询/SSE
const upstreamHeadersTimeoutMs = 30_000;
// WebSocket 升级路径的超时仅覆盖 TCP 连接建立阶段，建立后清除以保护长连接
const upstreamConnectTimeoutMs = 30_000;
// 控制中心每 30 秒发送 SSE keepalive，超过该时长无数据视为推送通道失效
const policyEventIdleTimeoutMs = 90_000;

const reservedSubdomains = new Set([
  "console", "admin", "api", "auth", "caddy", "frp", "frps", "gateway", "status", "tunnel", "www",
]);

// /metrics 暴露的进程级累计计数器：仅进程内存中累加，重启后归零（Prometheus counter 语义）
const metrics = {
  requestsTotal: 0,
  upstreamErrorsTotal: 0,
  bytesTotal: { upload: 0, download: 0 },
  throttleWaitSecondsTotal: 0,
  accessDeniedTotal: { ip: 0, basic: 0 },
};

type Policy = {
  connection_id: string;
  user_id: string;
  device_id: string;
  subdomain: string;
  custom_domains?: string[];
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

type PolicySnapshot = {
  revision: number;
  generated_at: string;
  snapshot_expires_at: string;
  tunnel_domain: string;
  connections: Policy[];
};

// ---------- 零依赖 IPv4/IPv6 CIDR 匹配（与控制中心 security.ts 同一实现） ----------

function parseIpv4Bytes(text: string): number[] | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    // 拒绝空段、非数字与前导零（避免八进制歧义解释）
    if (!/^\d{1,3}$/.test(part) || (part.length > 1 && part.startsWith("0"))) return null;
    const value = Number(part);
    if (value > 255) return null;
    bytes.push(value);
  }
  return bytes;
}

// 统一解析为 16 字节：IPv4 与 IPv4-mapped IPv6 都归一到 ::ffff:a.b.c.d 的
// 字节形式，使 IPv4/IPv6 白名单条目可在同一字节域内按前缀比较。
export function parseIpBytes(text: string): Uint8Array | null {
  const value = text.trim();
  if (!value) return null;
  if (!value.includes(":")) {
    const ipv4 = parseIpv4Bytes(value);
    if (!ipv4) return null;
    const bytes = new Uint8Array(16);
    bytes[10] = 0xff;
    bytes[11] = 0xff;
    bytes.set(ipv4, 12);
    return bytes;
  }
  let head = value;
  let tail: string | null = null;
  const marker = value.indexOf("::");
  if (marker >= 0) {
    if (value.indexOf("::", marker + 1) >= 0) return null;
    head = value.slice(0, marker);
    tail = value.slice(marker + 2);
  }
  const parseGroups = (part: string): number[] | null => {
    if (!part) return [];
    const groups = part.split(":");
    const words: number[] = [];
    for (let index = 0; index < groups.length; index += 1) {
      const group = groups[index] ?? "";
      if (group.includes(".")) {
        // 内嵌 IPv4 只允许出现在最后一组
        if (index !== groups.length - 1) return null;
        const ipv4 = parseIpv4Bytes(group);
        if (!ipv4) return null;
        words.push(((ipv4[0] ?? 0) << 8) | (ipv4[1] ?? 0), ((ipv4[2] ?? 0) << 8) | (ipv4[3] ?? 0));
      } else {
        if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
        words.push(Number.parseInt(group, 16));
      }
    }
    return words;
  };
  const headWords = parseGroups(head);
  const tailWords = tail === null ? [] : parseGroups(tail);
  if (!headWords || !tailWords) return null;
  const total = headWords.length + tailWords.length;
  if (tail === null ? total !== 8 : total > 7) return null;
  const words = [...headWords, ...Array.from({ length: 8 - total }, () => 0), ...tailWords];
  const bytes = new Uint8Array(16);
  words.forEach((word, index) => {
    bytes[index * 2] = word >> 8;
    bytes[index * 2 + 1] = word & 0xff;
  });
  return bytes;
}

export type CidrRule = { bytes: Uint8Array; prefixBits: number };

// 接受单 IP（等价 /32、/128）或 CIDR。IPv4 前缀映射到 IPv4-mapped 空间
// （prefix + 96），与 parseIpBytes 的 16 字节归一保持一致。
export function parseCidr(text: string): CidrRule | null {
  const value = text.trim();
  if (!value) return null;
  const slash = value.indexOf("/");
  const ipText = slash >= 0 ? value.slice(0, slash) : value;
  const isIpv4 = !ipText.includes(":");
  const bytes = parseIpBytes(ipText);
  if (!bytes) return null;
  let prefixBits = 128;
  if (slash >= 0) {
    const prefixText = value.slice(slash + 1);
    if (!/^\d{1,3}$/.test(prefixText)) return null;
    const prefix = Number(prefixText);
    if (prefix > (isIpv4 ? 32 : 128)) return null;
    prefixBits = isIpv4 ? prefix + 96 : prefix;
  }
  return { bytes, prefixBits };
}

export function cidrContains(rule: CidrRule, ip: Uint8Array): boolean {
  if (rule.bytes.length !== ip.length) return false;
  const fullBytes = rule.prefixBits >> 3;
  for (let index = 0; index < fullBytes; index += 1) {
    if (rule.bytes[index] !== ip[index]) return false;
  }
  const remainder = rule.prefixBits & 7;
  if (!remainder) return true;
  const mask = (0xff << (8 - remainder)) & 0xff;
  return (((rule.bytes[fullBytes] ?? 0) ^ (ip[fullBytes] ?? 0)) & mask) === 0;
}

type ActiveClose = () => void;

export class PolicyStore {
  private bySubdomain = new Map<string, Policy>();
  private byCustomDomain = new Map<string, Policy>();
  private byConnection = new Map<string, Policy>();
  private active = new Map<string, Set<ActiveClose>>();
  // 按 connection_id 预编译的白名单规则；无效条目在 apply 时剔除并告警，
  // 剔除后仍保持 fail-closed（条目越少可放行的来源越少）。
  private allowRules = new Map<string, CidrRule[]>();
  revision = 0;
  domain = "tunnel.example.com";
  expiresAt = 0;
  lastSuccessAt = 0;
  lastFullSuccessAt = 0;

  private authorized(policy: Policy | undefined): policy is Policy {
    if (!policy?.enabled || !policy.device_lease_expires_at) return false;
    const leaseExpiresAt = Date.parse(policy.device_lease_expires_at);
    return Number.isFinite(leaseExpiresAt) && leaseExpiresAt > Date.now();
  }

  apply(snapshot: PolicySnapshot): void {
    const expiresAt = Date.parse(snapshot.snapshot_expires_at);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      throw new Error("policy snapshot is already expired");
    }
    const domain = snapshot.tunnel_domain.toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(domain) || domain.includes("..")) {
      throw new Error("invalid tunnel domain in policy snapshot");
    }
    const nextBySubdomain = new Map<string, Policy>();
    const nextByCustomDomain = new Map<string, Policy>();
    const nextByConnection = new Map<string, Policy>();
    const nextAllowRules = new Map<string, CidrRule[]>();
    for (const policy of snapshot.connections) {
      const subdomain = policy.subdomain.toLowerCase();
      if (nextBySubdomain.has(subdomain) || nextByConnection.has(policy.connection_id)) {
        throw new Error("duplicate policy identity in snapshot");
      }
      if (policy.device_lease_expires_at !== null && !Number.isFinite(Date.parse(policy.device_lease_expires_at))) {
        throw new Error("invalid device lease expiry in policy snapshot");
      }
      policy.custom_domains = Array.isArray(policy.custom_domains)
        ? policy.custom_domains
            .filter((domain): domain is string => typeof domain === "string")
            .map((domain) => domain.trim().replace(/\.$/, "").toLowerCase())
        : [];
      for (const customDomain of policy.custom_domains) {
        if (
          !/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(customDomain) ||
          customDomain.includes("..") ||
          customDomain === domain ||
          customDomain.endsWith(`.${domain}`) ||
          nextByCustomDomain.has(customDomain)
        ) {
          throw new Error("invalid or duplicate custom domain in policy snapshot");
        }
        nextByCustomDomain.set(customDomain, policy);
      }
      // 归一化门禁字段：兼容尚未升级的控制中心（字段缺失视为未启用）。
      policy.access_ip_allowlist = Array.isArray(policy.access_ip_allowlist)
        ? policy.access_ip_allowlist.filter((entry): entry is string => typeof entry === "string")
        : null;
      policy.access_basic_user =
        typeof policy.access_basic_user === "string" && policy.access_basic_user ? policy.access_basic_user : null;
      policy.access_basic_hash =
        typeof policy.access_basic_hash === "string" && policy.access_basic_hash ? policy.access_basic_hash : null;
      policy.access_policy_version = Number.isFinite(policy.access_policy_version)
        ? Number(policy.access_policy_version)
        : 1;
      if (policy.access_ip_allowlist) {
        const rules: CidrRule[] = [];
        for (const entry of policy.access_ip_allowlist) {
          const rule = parseCidr(entry);
          if (rule) rules.push(rule);
          else log("warn", "ACCESS_ALLOWLIST_ENTRY_INVALID", "Ignoring unparsable allowlist entry", { connection_id: policy.connection_id, entry });
        }
        nextAllowRules.set(policy.connection_id, rules);
      }
      nextBySubdomain.set(subdomain, policy);
      nextByConnection.set(policy.connection_id, policy);
    }
    for (const [connectionId, closers] of this.active) {
      const before = this.byConnection.get(connectionId);
      const after = nextByConnection.get(connectionId);
      // 取舍：access_policy_version 变化不参与此判定——ACL 变更只需对后续请求
      // 生效（新快照立即用于门禁，记忆缓存键含该版本号所以也随之失效），无需
      // 像 connection_version 那样切断进行中的流；已建立的长连接在门禁收紧后
      // 继续存活，属可接受的语义（与 Basic Auth 会话性质一致）。
      const authorizationChanged =
        this.authorized(before) &&
        (!this.authorized(after) ||
          before.connection_version !== after.connection_version ||
          before.user_id !== after.user_id ||
          before.device_id !== after.device_id ||
          before.subdomain.toLowerCase() !== after.subdomain.toLowerCase());
      if (authorizationChanged) {
        for (const close of closers) close();
        this.active.delete(connectionId);
      }
    }
    this.bySubdomain = nextBySubdomain;
    this.byCustomDomain = nextByCustomDomain;
    this.byConnection = nextByConnection;
    this.allowRules = nextAllowRules;
    this.revision = snapshot.revision;
    this.domain = domain;
    this.expiresAt = expiresAt;
    this.lastSuccessAt = Date.now();
    this.lastFullSuccessAt = this.lastSuccessAt;
  }

  // IP 白名单判定：未配置（null）时不限制；配置后客户端 IP 必须命中至少一条
  // 规则，IP 无法解析或规则为空时拒绝（fail-closed）。
  ipAllowed(policy: Policy, clientIpText: string): boolean {
    if (policy.access_ip_allowlist == null) return true;
    const ip = parseIpBytes(clientIpText);
    if (!ip) return false;
    const rules = this.allowRules.get(policy.connection_id) ?? [];
    return rules.some((rule) => cidrContains(rule, ip));
  }

  touch(snapshotExpiresAt: string): void {
    const expiresAt = Date.parse(snapshotExpiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() || !this.lastFullSuccessAt) {
      throw new Error("invalid unchanged policy response");
    }
    this.expiresAt = expiresAt;
    this.lastSuccessAt = Date.now();
  }

  valid(): boolean {
    return this.expiresAt > Date.now();
  }

  enforceExpiry(): boolean {
    if (this.active.size === 0) return false;
    if (!this.valid()) {
      const active = [...this.active.values()];
      this.active.clear();
      for (const closers of active) {
        for (const close of closers) close();
      }
      return true;
    }
    let closed = false;
    for (const [connectionId, closers] of [...this.active]) {
      if (this.authorized(this.byConnection.get(connectionId))) continue;
      this.active.delete(connectionId);
      for (const close of closers) close();
      closed = true;
    }
    return closed;
  }

  host(hostHeader: string | undefined): { policy?: Policy; error?: "invalid" | "reserved" | "not_found" | "stale" } {
    if (!this.valid()) return { error: "stale" };
    if (!hostHeader || hostHeader.includes(",") || /[\s/\\]/.test(hostHeader)) return { error: "invalid" };
    const host = hostHeader.replace(/:\d+$/, "").toLowerCase();
    const suffix = `.${this.domain}`;
    if (!host.endsWith(suffix)) {
      const customPolicy = this.byCustomDomain.get(host);
      return this.authorized(customPolicy) ? { policy: customPolicy } : { error: "invalid" };
    }
    const subdomain = host.slice(0, -suffix.length);
    if (!subdomain || subdomain.includes(".") || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain)) {
      return { error: "invalid" };
    }
    if (reservedSubdomains.has(subdomain)) return { error: "reserved" };
    const policy = this.bySubdomain.get(subdomain);
    if (!this.authorized(policy)) return { error: "not_found" };
    return { policy };
  }

  connection(id: string): Policy | undefined {
    const policy = this.byConnection.get(id);
    return this.valid() && this.authorized(policy) ? policy : undefined;
  }

  register(connectionId: string, closer: ActiveClose): () => void {
    const group = this.active.get(connectionId) ?? new Set<ActiveClose>();
    group.add(closer);
    this.active.set(connectionId, group);
    return () => {
      group.delete(closer);
      if (!group.size) this.active.delete(connectionId);
    };
  }

  get activeStreamCount(): number {
    let total = 0;
    for (const closers of this.active.values()) total += closers.size;
    return total;
  }
}

export const policies = new PolicyStore();

type Bucket = { rateBytesPerSecond: number; capacity: number; tokens: number; updatedAt: number; version: number };

export class HierarchicalLimiter {
  private userBuckets = new Map<string, Bucket>();
  private connectionBuckets = new Map<string, Bucket>();

  constructor(private readonly store: PolicyStore = policies) {}

  private bucket(
    map: Map<string, Bucket>,
    key: string,
    limitBps: number | null,
    burstBytes: number | null,
    version: number,
  ): Bucket | null {
    if (limitBps == null) {
      map.delete(key);
      return null;
    }
    const rateBytesPerSecond = Math.max(limitBps / 8, 1);
    const capacity = Math.max(64 * 1024, Math.min(8 * 1024 * 1024, burstBytes ?? rateBytesPerSecond));
    const existing = map.get(key);
    if (!existing) {
      const created = { rateBytesPerSecond, capacity, tokens: capacity, updatedAt: performance.now(), version };
      map.set(key, created);
      return created;
    }
    this.refill(existing);
    if (existing.version !== version || existing.rateBytesPerSecond !== rateBytesPerSecond || existing.capacity !== capacity) {
      existing.rateBytesPerSecond = rateBytesPerSecond;
      existing.capacity = capacity;
      existing.tokens = Math.min(existing.tokens, capacity);
      existing.version = version;
    }
    return existing;
  }

  private refill(bucket: Bucket): void {
    const now = performance.now();
    const elapsed = Math.max(0, (now - bucket.updatedAt) / 1000);
    bucket.tokens = Math.min(bucket.capacity, bucket.tokens + elapsed * bucket.rateBytesPerSecond);
    bucket.updatedAt = now;
  }

  async acquire(connectionId: string, requestedBytes: number, signal: AbortSignal): Promise<void> {
    let remaining = requestedBytes;
    while (remaining > 0) {
      if (signal.aborted) throw new Error("TRANSFER_ABORTED");
      const policy = this.store.connection(connectionId);
      if (!policy) throw new Error("POLICY_REVOKED");
      const user = this.bucket(this.userBuckets, policy.user_id, policy.user_limit_bps, policy.user_burst_bytes, policy.user_policy_version);
      const connection = this.bucket(this.connectionBuckets, policy.connection_id, policy.connection_limit_bps, policy.connection_burst_bytes, policy.connection_policy_version);
      const maximumChunk = Math.max(1, Math.floor(Math.min(user?.capacity ?? Infinity, connection?.capacity ?? Infinity, config.maxBodyChunkBytes)));
      const bytes = Math.min(remaining, maximumChunk);
      if (user) this.refill(user);
      if (connection) this.refill(connection);
      const userWait = user ? Math.max(0, (bytes - user.tokens) / user.rateBytesPerSecond) : 0;
      const connectionWait = connection ? Math.max(0, (bytes - connection.tokens) / connection.rateBytesPerSecond) : 0;
      const waitSeconds = Math.max(userWait, connectionWait);
      if (waitSeconds <= 0) {
        if (user) user.tokens -= bytes;
        if (connection) connection.tokens -= bytes;
        remaining -= bytes;
        continue;
      }
      const waitStartedAt = performance.now();
      await abortableDelay(Math.max(1, Math.ceil(waitSeconds * 1000)), signal);
      metrics.throttleWaitSecondsTotal += (performance.now() - waitStartedAt) / 1000;
    }
  }
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

const limiter = new HierarchicalLimiter();

type Sample = {
  bucket_start: string;
  bucket_seconds: number;
  user_id: string;
  device_id: string;
  connection_id: string;
  upload_bytes: number;
  download_bytes: number;
  request_count: number;
  error_count: number;
};

type SampleBatchUploader = (samples: Sample[]) => Promise<void>;

async function uploadSampleBatch(batch: Sample[]): Promise<void> {
  const response = await fetch(`${config.controlCenterUrl}/internal/traffic/samples`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-home-tunnel-key": config.internalKey },
    body: JSON.stringify({ batch_id: randomUUID(), samples: batch }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`sample upload returned ${response.status}`);
}

export class SampleCollector {
  private samples = new Map<string, Sample>();
  private lastUploadFailureAt = Number.NEGATIVE_INFINITY;
  private lastUploadFailure = "";
  private lastOverflowLogAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly uploader: SampleBatchUploader = uploadSampleBatch,
    private readonly maxBufferedSamples: number = 5000,
  ) {}

  private bucketStart(): string {
    const bucketMs = config.sampleBucketSeconds * 1000;
    return new Date(Math.floor(this.now() / bucketMs) * bucketMs).toISOString();
  }

  private current(policy: Policy): Sample {
    const start = this.bucketStart();
    const key = `${policy.connection_id}:${start}`;
    const existing = this.samples.get(key);
    const sample = existing && existing.user_id === policy.user_id && existing.device_id === policy.device_id
      ? existing
      : {
      bucket_start: start,
      bucket_seconds: config.sampleBucketSeconds,
      user_id: policy.user_id,
      device_id: policy.device_id,
      connection_id: policy.connection_id,
      upload_bytes: 0,
      download_bytes: 0,
      request_count: 0,
      error_count: 0,
    };
    this.samples.set(key, sample);
    this.evictOverflow();
    return sample;
  }

  // 上传长期失败时丢弃最旧 bucket 的样本，避免缓冲无限膨胀
  private evictOverflow(): void {
    if (this.samples.size <= this.maxBufferedSamples) return;
    const currentStart = this.bucketStart();
    let dropped = 0;
    while (this.samples.size > this.maxBufferedSamples) {
      let oldest = "";
      for (const sample of this.samples.values()) {
        if (!oldest || sample.bucket_start < oldest) oldest = sample.bucket_start;
      }
      if (!oldest || oldest === currentStart) break;
      for (const [key, sample] of this.samples) {
        if (sample.bucket_start === oldest) {
          this.samples.delete(key);
          dropped += 1;
        }
      }
    }
    if (!dropped) return;
    const now = this.now();
    if (now - this.lastOverflowLogAt >= 60_000) {
      log("warn", "SAMPLE_BUFFER_OVERFLOW", "Sample buffer exceeded limit, dropped oldest buckets", { dropped_samples: dropped, buffered_samples: this.samples.size });
      this.lastOverflowLogAt = now;
    }
  }

  record(policy: Policy, direction: "upload" | "download", bytes: number): void {
    metrics.bytesTotal[direction] += bytes;
    const sample = this.current(policy);
    if (direction === "upload") sample.upload_bytes += bytes;
    else sample.download_bytes += bytes;
  }

  request(policy: Policy): void {
    metrics.requestsTotal += 1;
    this.current(policy).request_count += 1;
  }

  error(policy: Policy): void {
    metrics.upstreamErrorsTotal += 1;
    this.current(policy).error_count += 1;
  }

  get bufferedSampleCount(): number {
    return this.samples.size;
  }

  async flush(): Promise<void> {
    if (!this.samples.size) return;
    const pending = [...this.samples.entries()].map(([key, sample]) => [key, { ...sample }] as const);
    try {
      await this.uploader(pending.map(([, sample]) => sample));
      this.lastUploadFailure = "";
      const completedAt = this.now();
      for (const [key, uploaded] of pending) {
        const bucketEnd = Date.parse(uploaded.bucket_start) + uploaded.bucket_seconds * 1000;
        const current = this.samples.get(key);
        if (
          bucketEnd <= completedAt &&
          current?.upload_bytes === uploaded.upload_bytes &&
          current.download_bytes === uploaded.download_bytes &&
          current.request_count === uploaded.request_count &&
          current.error_count === uploaded.error_count
        ) {
          this.samples.delete(key);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown sample error";
      const now = this.now();
      if (message !== this.lastUploadFailure || now - this.lastUploadFailureAt >= 60_000) {
        log("warn", "SAMPLE_UPLOAD_FAILED", message, { buffered_samples: this.samples.size });
        this.lastUploadFailure = message;
        this.lastUploadFailureAt = now;
      }
    }
  }
}

export const samples = new SampleCollector();

export class ThrottleTransform extends Transform {
  constructor(
    private readonly connectionId: string,
    private readonly direction: "upload" | "download",
    private readonly controller: AbortController,
    private readonly store: PolicyStore = policies,
    private readonly limits: HierarchicalLimiter = limiter,
    private readonly collector: SampleCollector = samples,
  ) {
    super({ highWaterMark: config.maxBodyChunkBytes });
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    if (this.controller.signal.aborted) {
      callback(new Error("TRANSFER_ABORTED"));
      return;
    }
    const policy = this.store.connection(this.connectionId);
    if (!policy) {
      callback(new Error("POLICY_REVOKED"));
      return;
    }
    // 两级均无限速时走同步快速路径，避免逐块经过 Promise 链
    if (policy.user_limit_bps == null && policy.connection_limit_bps == null) {
      this.collector.record(policy, this.direction, chunk.length);
      callback(null, chunk);
      return;
    }
    void this.limits.acquire(this.connectionId, chunk.length, this.controller.signal)
      .then(() => {
        const current = this.store.connection(this.connectionId);
        if (!current) throw new Error("POLICY_REVOKED");
        this.collector.record(current, this.direction, chunk.length);
        callback(null, chunk);
      })
      .catch((error) => callback(error as Error));
  }
}

function log(level: string, eventCode: string, message: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, component: "traffic-gateway", event_code: eventCode, message, ...fields }));
}

// 可信客户端 IP：取最右 XFF 元素（由唯一可信的直连代理 Caddy 追加，最左元素
// 可被客户端伪造），非法时退回 socket 对端地址。IP 白名单门禁与转发头共用。
function clientIp(request: IncomingMessage): string {
  const forwarded = String(request.headers["x-forwarded-for"] ?? "").split(",").at(-1)?.trim();
  return forwarded && /^[0-9a-f:.]+$/i.test(forwarded)
    ? forwarded
    : (request.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
}

function sanitizedHeaders(request: IncomingMessage, forUpgrade = false, stripAuthorization = false): IncomingHttpHeaders {
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
  ]) delete headers[name];
  // 仅在该连接启用了 Basic Auth 门禁时删除 authorization：它是门禁凭据，不应
  // 泄漏给后端；未启用门禁时保持透传，以免破坏后端自身的鉴权。
  if (stripAuthorization) delete headers.authorization;
  if (!forUpgrade) {
    for (const name of ["connection", "keep-alive", "te", "trailer", "transfer-encoding", "upgrade"]) {
      delete headers[name];
    }
  }
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
  ]) delete output[name];
  return output;
}

// 与 control-center 的 constantTimeStringEqual 同思路：长度不等直接失败（只泄露长度），
// 等长时用 timingSafeEqual 做恒定时间比较
function constantTimeStringEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------- Basic Auth 门禁：scrypt 验证 + 按连接的记忆缓存 ----------

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number, options: {
  N: number;
  r: number;
  p: number;
  maxmem: number;
}) => Promise<Buffer>;

// 观测与测试钩子：scrypt 实际执行次数与缓存命中次数。
export const accessStats = { scryptVerifications: 0, basicCacheHits: 0 };

// 验证控制中心生成的 scrypt$N$r$p$saltB64$hashB64 哈希串。异步 scrypt 跑在
// libuv 线程池里，不阻塞代理事件循环。参数带防御上限，避免异常快照造成
// 内存/CPU 放大。
async function verifyScryptHash(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const cost = Number(parts[1]);
    const blockSize = Number(parts[2]);
    const parallelism = Number(parts[3]);
    if (!Number.isInteger(cost) || cost < 1024 || cost > 65_536 || (cost & (cost - 1)) !== 0) return false;
    if (!Number.isInteger(blockSize) || blockSize < 1 || blockSize > 16) return false;
    if (!Number.isInteger(parallelism) || parallelism < 1 || parallelism > 4) return false;
    const salt = Buffer.from(parts[4] ?? "", "base64");
    const expected = Buffer.from(parts[5] ?? "", "base64");
    if (salt.length < 8 || expected.length < 16 || expected.length > 64) return false;
    const actual = await scryptAsync(password, salt, expected.length, {
      N: cost,
      r: blockSize,
      p: parallelism,
      maxmem: 256 * 1024 * 1024,
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function parseBasicAuthorization(header: string): { username: string; password: string } | null {
  const match = /^basic\s+([a-z0-9+/=_-]+)$/i.exec(header.trim());
  if (!match?.[1]) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(match[1], "base64").toString("utf8");
  } catch {
    return null;
  }
  const colon = decoded.indexOf(":");
  if (colon < 0) return null;
  return { username: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
}

// 记忆缓存：键 = connection_id + access_policy_version + Authorization 原文。
// 命中即放行，避免每个请求都跑一次 scrypt；access_policy_version 变化（改口令
// /关闭门禁）后旧键自然失效。只缓存验证成功的凭据，失败尝试永远走全量
// scrypt（这也天然限制了在线爆破速率）。
const basicAuthCacheTtlMs = 5 * 60 * 1000;
const basicAuthCacheMaxEntries = 1000;
const basicAuthCache = new Map<string, number>();

function basicAuthCacheGet(key: string): boolean {
  const expiresAt = basicAuthCache.get(key);
  if (expiresAt === undefined) return false;
  if (expiresAt <= Date.now()) {
    basicAuthCache.delete(key);
    return false;
  }
  // Map 迭代序即插入序：删除后重插，使迭代首位始终是最久未使用的键（LRU）
  basicAuthCache.delete(key);
  basicAuthCache.set(key, expiresAt);
  return true;
}

function basicAuthCachePut(key: string): void {
  if (basicAuthCache.size >= basicAuthCacheMaxEntries) {
    const oldest = basicAuthCache.keys().next().value;
    if (oldest !== undefined) basicAuthCache.delete(oldest);
  }
  basicAuthCache.set(key, Date.now() + basicAuthCacheTtlMs);
}

async function verifyBasicAuthorization(policy: Policy, header: string): Promise<boolean> {
  if (!policy.access_basic_user || !policy.access_basic_hash) return false;
  const cacheKey = `${policy.connection_id}:${policy.access_policy_version}:${header}`;
  if (basicAuthCacheGet(cacheKey)) {
    accessStats.basicCacheHits += 1;
    return true;
  }
  const credentials = parseBasicAuthorization(header);
  if (!credentials) return false;
  accessStats.scryptVerifications += 1;
  // 用户名不匹配时也照常跑 scrypt，避免通过响应时间枚举用户名
  const usernameMatches = constantTimeStringEqual(credentials.username, policy.access_basic_user);
  const passwordMatches = await verifyScryptHash(credentials.password, policy.access_basic_hash);
  if (!usernameMatches || !passwordMatches) return false;
  basicAuthCachePut(cacheKey);
  return true;
}

function renderMetrics(): string {
  const policyAgeSeconds = policies.lastSuccessAt ? (Date.now() - policies.lastSuccessAt) / 1000 : -1;
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

function controlledError(response: ServerResponse, status: number, errorCode: string, message: string): void {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify({ error_code: errorCode, message }));
}

function basicAuthChallenge(response: ServerResponse): void {
  metrics.accessDeniedTotal.basic += 1;
  if (response.destroyed) return;
  if (response.headersSent) {
    response.destroy();
    return;
  }
  response.writeHead(401, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "www-authenticate": 'Basic realm="Home Tunnel"',
  });
  response.end(JSON.stringify({ error_code: "ACCESS_BASIC_UNAUTHORIZED", message: "该连接要求 Basic Auth 凭据" }));
}

function handleRequest(request: IncomingMessage, response: ServerResponse): void {
  // healthz 仅靠 Host 白名单区分内外（Host 可伪造）：compose 健康检查与
  // control-center 的 GATEWAY_HEALTH_URL 探活均使用 fetch 且不带
  // x-home-tunnel-key（且 fetch 禁止覆盖 Host header），改为强制 key 校验会
  // 破坏现有部署；此端点仅暴露健康状态与策略版本号，泄露风险可接受。
  if (request.url === "/healthz" && [
    "127.0.0.1:8080",
    "localhost:8080",
    "traffic-gateway:8080",
    "home-tunnel-traffic-gateway:8080",
  ].includes(request.headers.host ?? "")) {
    const status = policies.valid() ? 200 : 503;
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: policies.valid() ? "healthy" : "stale", revision: policies.revision, policy_age_seconds: policies.lastSuccessAt ? Math.round((Date.now() - policies.lastSuccessAt) / 1000) : null }));
    return;
  }
  // /metrics 仅凭内部密钥鉴权（Host 不参与判定）：密钥缺失或不匹配时返回与
  // "未分配子域"完全一致的 404 响应，避免向外部探测者暴露端点存在性。
  // 代价是业务隧道无法透传自身的 /metrics 路径，当前没有该需求。
  if (request.url === "/metrics") {
    const providedKey = request.headers["x-home-tunnel-key"];
    if (typeof providedKey !== "string" || !constantTimeStringEqual(providedKey, config.internalKey)) {
      controlledError(response, 404, "CONNECTION_NOT_FOUND", "未分配该业务子域");
      return;
    }
    response.writeHead(200, { "content-type": "text/plain; version=0.0.4; charset=utf-8", "cache-control": "no-store" });
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
  // ---- 访问控制门禁：解析出 policy 之后、代理之前强制执行 ----
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
    // 异步 scrypt 验证期间 request 尚未被 pipe（保持 paused、靠背压缓冲）；
    // 挂 no-op error 监听，防止验证窗口内客户端 RST 触发未处理异常。
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

function proxyRequest(
  request: IncomingMessage,
  response: ServerResponse,
  policy: Policy,
  stripAuthorization: boolean,
): void {
  samples.request(policy);
  const controller = new AbortController();
  const headers = sanitizedHeaders(request, false, stripAuthorization);
  const upstream = http.request({
    host: config.upstreamHost,
    port: config.upstreamPort,
    method: request.method,
    path: request.url,
    headers,
    agent: upstreamAgent,
  });
  // 空闲超时只覆盖等待响应头阶段，响应头到达后清除
  upstream.setTimeout(upstreamHeadersTimeoutMs, () => upstream.destroy(new Error("UPSTREAM_TIMEOUT")));
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
  response.once("close", () => finish(response.writableFinished ? undefined : new Error("CLIENT_CLOSED")));
  request.once("error", (error) => finish(error));
  response.once("error", (error) => finish(error));
  upstream.on("response", (upstreamResponse) => {
    upstream.setTimeout(0);
    const responseHeaders = sanitizedResponseHeaders(upstreamResponse.headers);
    response.writeHead(upstreamResponse.statusCode ?? 502, responseHeaders);
    const throttled = new ThrottleTransform(policy.connection_id, "download", controller);
    throttled.once("error", (error) => finish(error));
    upstreamResponse.once("error", (error) => finish(error));
    upstreamResponse.pipe(throttled).pipe(response);
  });
  upstream.on("error", (error) => {
    if (finished && error.message !== "POLICY_REVOKED") return;
    samples.error(policy);
    log("warn", "UPSTREAM_ERROR", error.message, { connection_id: policy.connection_id });
    controlledError(response, error.message === "POLICY_REVOKED" ? 423 : 502, error.message === "POLICY_REVOKED" ? "CONNECTION_DISABLED" : "UPSTREAM_UNAVAILABLE", "隧道上游暂不可用");
    finish(error);
  });
  const upload = new ThrottleTransform(policy.connection_id, "upload", controller);
  upload.once("error", (error) => {
    controlledError(response, error.message === "POLICY_REVOKED" ? 423 : 502, error.message === "POLICY_REVOKED" ? "CONNECTION_DISABLED" : "UPSTREAM_UNAVAILABLE", "隧道上游暂不可用");
    finish(error);
  });
  request.pipe(upload).pipe(upstream);
}

function writeUpgradeRequest(request: IncomingMessage, upstream: Socket, stripAuthorization: boolean): void {
  const headers = sanitizedHeaders(request, true, stripAuthorization);
  let data = `${request.method ?? "GET"} ${request.url ?? "/"} HTTP/${request.httpVersion}\r\n`;
  for (const [key, value] of Object.entries(headers)) {
    if (value == null) continue;
    if (Array.isArray(value)) for (const item of value) data += `${key}: ${item}\r\n`;
    else data += `${key}: ${value}\r\n`;
  }
  upstream.write(`${data}\r\n`);
}

// 升级路径的门禁拒绝：写出最小响应后确定性拆除 socket（flush 后 destroy），
// 不给半开连接留存活窗口。
function rejectUpgrade(client: Socket, statusLine: string, extraHeaderLines = ""): void {
  if (client.destroyed) return;
  client.write(`HTTP/1.1 ${statusLine}\r\nConnection: close\r\n${extraHeaderLines}Content-Length: 0\r\n\r\n`);
  client.destroySoon();
}

function handleUpgrade(request: IncomingMessage, client: Socket, head: Buffer): void {
  const authorized = policies.host(request.headers.host);
  if (!authorized.policy) {
    client.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    return;
  }
  const policy = authorized.policy;
  // ---- 访问控制门禁（与 handleRequest 同规则）----
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
          rejectUpgrade(client, "401 Unauthorized", 'WWW-Authenticate: Basic realm="Home Tunnel"\r\n');
          return;
        }
        proxyUpgrade(request, client, head, policy, true);
      })
      .catch(() => rejectUpgrade(client, "401 Unauthorized", 'WWW-Authenticate: Basic realm="Home Tunnel"\r\n'));
    return;
  }
  proxyUpgrade(request, client, head, policy, false);
}

function proxyUpgrade(
  request: IncomingMessage,
  client: Socket,
  head: Buffer,
  policy: Policy,
  stripAuthorization: boolean,
): void {
  samples.request(policy);
  const controller = new AbortController();
  const upstream = net.connect(config.upstreamPort, config.upstreamHost);
  // 超时仅覆盖连接建立阶段，建立后清除，避免误杀 WebSocket 长连接
  upstream.setTimeout(upstreamConnectTimeoutMs, () => upstream.destroy(new Error("UPSTREAM_CONNECT_TIMEOUT")));
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
    if (head.length) {
      void limiter.acquire(policy.connection_id, head.length, controller.signal).then(() => {
        samples.record(policy, "upload", head.length);
        upstream.write(head);
      }).catch(close);
    }
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

// 供 main() 与进程内 e2e 测试复用：仅创建并配置 HTTP 服务器，不启动任何
// 定时器或策略同步循环，也不监听端口（由调用方决定地址与生命周期）
export function createGatewayServer(): http.Server {
  const server = http.createServer(handleRequest);
  server.on("upgrade", handleUpgrade);
  server.requestTimeout = 0;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 65_000;
  return server;
}

export async function syncPolicies(): Promise<void> {
  const headers: Record<string, string> = { "x-home-tunnel-key": config.internalKey };
  const fullSnapshotDue = Date.now() - policies.lastFullSuccessAt >= config.policyFullSyncMs;
  if (policies.lastFullSuccessAt && !fullSnapshotDue) headers["if-none-match"] = `"${policies.revision}"`;
  const response = await fetch(`${config.controlCenterUrl}/internal/policies/sync`, {
    headers,
    signal: AbortSignal.timeout(4000),
  });
  if (response.status === 304) {
    const snapshotExpiresAt = response.headers.get("x-policy-snapshot-expires-at");
    if (!snapshotExpiresAt) throw new Error("unchanged policy response is missing expiry");
    policies.touch(snapshotExpiresAt);
    return;
  }
  if (!response.ok) throw new Error(`policy sync returned ${response.status}`);
  const snapshot = await response.json() as PolicySnapshot;
  if (
    !Array.isArray(snapshot.connections) ||
    !snapshot.tunnel_domain ||
    !snapshot.snapshot_expires_at ||
    !Number.isSafeInteger(snapshot.revision) ||
    snapshot.revision < 0
  ) {
    throw new Error("invalid policy snapshot");
  }
  policies.apply(snapshot);
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const finish = () => {
      signal.removeEventListener("abort", stop);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    const stop = () => {
      clearTimeout(timer);
      finish();
    };
    signal.addEventListener("abort", stop, { once: true });
  });
}

async function consumePolicyEvents(response: Response, signal: AbortSignal, onEvent: () => void, connection: AbortController): Promise<void> {
  if (!response.body) throw new Error("policy event stream has no body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!signal.aborted) {
      const idleTimer = setTimeout(() => connection.abort(new Error("policy event stream idle timeout")), policyEventIdleTimeoutMs);
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
        const event = message.split("\n").find((line) => line.startsWith("event:"))?.slice(6).trim();
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
    const connectTimeout = setTimeout(() => connection.abort(new Error("policy event connection timeout")), 10_000);
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
      if (!signal.aborted) {
        log("warn", "POLICY_EVENTS_DISCONNECTED", error instanceof Error ? error.message : "Policy push channel disconnected");
      }
    } finally {
      signal.removeEventListener("abort", forwardAbort);
    }
    if (!signal.aborted) await waitForReconnect(config.policyReconnectMs, signal);
  }
}

// 启动时退避重试，避免与控制中心形成强启动顺序耦合
async function initialPolicySync(): Promise<void> {
  let delayMs = 1000;
  for (;;) {
    try {
      await syncPolicies();
      return;
    } catch (error) {
      log("warn", "POLICY_SYNC_FAILED", error instanceof Error ? error.message : "Unknown policy error", { retry_in_ms: delayMs });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      delayMs = Math.min(delayMs * 2, 30_000);
    }
  }
}

async function main(): Promise<void> {
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
    })().catch((error) => log("warn", "POLICY_SYNC_FAILED", error instanceof Error ? error.message : "Unknown policy error")).finally(() => {
      syncing = false;
      if (syncAgain) requestSync();
    });
  };
  const policyEvents = new AbortController();
  void watchPolicyEvents(policyEvents.signal, requestSync);
  const policyTimer = setInterval(requestSync, config.policyFullSyncMs);
  const sampleTimer = setInterval(() => void samples.flush(), config.sampleBucketSeconds * 1000);
  const expiryTimer = setInterval(() => {
    if (policies.enforceExpiry()) log("warn", "POLICY_AUTHORIZATION_EXPIRED", "Expired policy authorization closed active streams");
  }, 1000);
  const server = createGatewayServer();
  await new Promise<void>((resolve) => server.listen(config.port, "0.0.0.0", resolve));
  log("info", "SERVER_STARTED", "Traffic gateway started", { port: config.port, revision: policies.revision });

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

const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isDirectRun) {
  void main().catch((error) => {
    log("fatal", "STARTUP_FAILED", error instanceof Error ? error.message : "Unknown startup error");
    process.exit(1);
  });
}
