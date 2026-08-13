import { config } from "./config.js";
import { log } from "./observability.js";

export type Policy = {
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

export type PolicySnapshot = {
  revision: number;
  generated_at: string;
  snapshot_expires_at: string;
  tunnel_domain: string;
  connections: Policy[];
};

function parseIpv4Bytes(text: string): number[] | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || (part.length > 1 && part.startsWith("0"))) return null;
    const value = Number(part);
    if (value > 255) return null;
    bytes.push(value);
  }
  return bytes;
}

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
  for (let index = 0; index < fullBytes; index += 1)
    if (rule.bytes[index] !== ip[index]) return false;
  const remainder = rule.prefixBits & 7;
  if (!remainder) return true;
  const mask = (0xff << (8 - remainder)) & 0xff;
  return (((rule.bytes[fullBytes] ?? 0) ^ (ip[fullBytes] ?? 0)) & mask) === 0;
}

type ActiveClose = () => void;
export const reservedSubdomains = new Set([
  "console",
  "admin",
  "api",
  "auth",
  "caddy",
  "frp",
  "frps",
  "gateway",
  "status",
  "tunnel",
  "www",
]);

export class PolicyStore {
  private bySubdomain = new Map<string, Policy>();
  private byCustomDomain = new Map<string, Policy>();
  private byConnection = new Map<string, Policy>();
  private active = new Map<string, Set<ActiveClose>>();
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
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now())
      throw new Error("policy snapshot is already expired");
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
      if (nextBySubdomain.has(subdomain) || nextByConnection.has(policy.connection_id))
        throw new Error("duplicate policy identity in snapshot");
      if (
        policy.device_lease_expires_at !== null &&
        !Number.isFinite(Date.parse(policy.device_lease_expires_at))
      ) {
        throw new Error("invalid device lease expiry in policy snapshot");
      }
      policy.custom_domains = Array.isArray(policy.custom_domains)
        ? policy.custom_domains
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => entry.trim().replace(/\.$/, "").toLowerCase())
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
      policy.access_ip_allowlist = Array.isArray(policy.access_ip_allowlist)
        ? policy.access_ip_allowlist.filter((entry): entry is string => typeof entry === "string")
        : null;
      policy.access_basic_user =
        typeof policy.access_basic_user === "string" && policy.access_basic_user
          ? policy.access_basic_user
          : null;
      policy.access_basic_hash =
        typeof policy.access_basic_hash === "string" && policy.access_basic_hash
          ? policy.access_basic_hash
          : null;
      policy.access_policy_version = Number.isFinite(policy.access_policy_version)
        ? Number(policy.access_policy_version)
        : 1;
      if (policy.access_ip_allowlist) {
        const rules: CidrRule[] = [];
        for (const entry of policy.access_ip_allowlist) {
          const rule = parseCidr(entry);
          if (rule) rules.push(rule);
          else
            log("warn", "ACCESS_ALLOWLIST_ENTRY_INVALID", "Ignoring unparsable allowlist entry", {
              connection_id: policy.connection_id,
              entry,
            });
        }
        nextAllowRules.set(policy.connection_id, rules);
      }
      nextBySubdomain.set(subdomain, policy);
      nextByConnection.set(policy.connection_id, policy);
    }
    for (const [connectionId, closers] of this.active) {
      const before = this.byConnection.get(connectionId);
      const after = nextByConnection.get(connectionId);
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

  ipAllowed(policy: Policy, clientIpText: string): boolean {
    if (policy.access_ip_allowlist == null) return true;
    const ip = parseIpBytes(clientIpText);
    if (!ip) return false;
    return (this.allowRules.get(policy.connection_id) ?? []).some((rule) => cidrContains(rule, ip));
  }

  touch(snapshotExpiresAt: string): void {
    const expiresAt = Date.parse(snapshotExpiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() || !this.lastFullSuccessAt)
      throw new Error("invalid unchanged policy response");
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
      for (const closers of active) for (const close of closers) close();
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
  host(hostHeader: string | undefined): {
    policy?: Policy;
    error?: "invalid" | "reserved" | "not_found" | "stale";
  } {
    if (!this.valid()) return { error: "stale" };
    if (!hostHeader || hostHeader.includes(",") || /[\s/\\]/.test(hostHeader))
      return { error: "invalid" };
    const host = hostHeader.replace(/:\d+$/, "").toLowerCase();
    const suffix = `.${this.domain}`;
    if (!host.endsWith(suffix)) {
      const customPolicy = this.byCustomDomain.get(host);
      return this.authorized(customPolicy) ? { policy: customPolicy } : { error: "invalid" };
    }
    const subdomain = host.slice(0, -suffix.length);
    if (
      !subdomain ||
      subdomain.includes(".") ||
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain)
    )
      return { error: "invalid" };
    if (reservedSubdomains.has(subdomain)) return { error: "reserved" };
    const policy = this.bySubdomain.get(subdomain);
    return this.authorized(policy) ? { policy } : { error: "not_found" };
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

export async function syncPolicies(): Promise<void> {
  const headers: Record<string, string> = { "x-home-tunnel-key": config.internalKey };
  const fullSnapshotDue = Date.now() - policies.lastFullSuccessAt >= config.policyFullSyncMs;
  if (policies.lastFullSuccessAt && !fullSnapshotDue)
    headers["if-none-match"] = `"${policies.revision}"`;
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
  const snapshot = (await response.json()) as PolicySnapshot;
  if (
    !Array.isArray(snapshot.connections) ||
    !snapshot.tunnel_domain ||
    !snapshot.snapshot_expires_at ||
    !Number.isSafeInteger(snapshot.revision) ||
    snapshot.revision < 0
  )
    throw new Error("invalid policy snapshot");
  policies.apply(snapshot);
}
