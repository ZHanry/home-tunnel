import type { DatabaseClient } from "./db.js";
import { config } from "./config.js";
import { HttpError } from "./http.js";
import { normalizeSubdomain, normalizeUsername, validateSubdomain } from "./security.js";

export type PrefixPolicy = "off" | "suggest" | "enforce";

export function parsePrefixPolicy(value: string | null | undefined): PrefixPolicy {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "off" || normalized === "suggest" || normalized === "enforce") return normalized;
  return config.subdomainPrefixPolicy;
}

export async function getPrefixPolicy(client?: DatabaseClient): Promise<PrefixPolicy> {
  if (!client) return config.subdomainPrefixPolicy;
  const row = await client.query<{ value: string }>(
    "SELECT value FROM deployment_settings WHERE key='subdomain_prefix_policy'",
  );
  return parsePrefixPolicy(row.rows[0]?.value);
}

export async function setPrefixPolicy(client: DatabaseClient, policy: PrefixPolicy): Promise<void> {
  await client.query(
    `INSERT INTO deployment_settings(key, value, updated_at)
     VALUES('subdomain_prefix_policy', ?, home_tunnel_now())
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=home_tunnel_now()`,
    [policy],
  );
}

export function usernamePrefix(username: string): string {
  return `${normalizeUsername(username)}-`;
}

export function suggestedSubdomain(name: string, username: string): string {
  const slug = normalizeSubdomain(name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const base = slug || "app";
  const prefixed = `${normalizeUsername(username)}-${base}`.slice(0, 63).replace(/-+$/g, "");
  return prefixed || `${normalizeUsername(username)}-app`;
}

export function suggestionCandidates(desired: string, username: string): string[] {
  const base =
    normalizeSubdomain(desired)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "app";
  const user = normalizeUsername(username) || "user";
  return [
    `${user}-${base}`,
    `${base}-2`,
    `${base}-3`,
    `my-${base}`,
    `${user}-${base}-2`,
  ]
    .map((value) => value.slice(0, 63).replace(/-+$/g, ""))
    .filter((value, index, all) => value !== base && all.indexOf(value) === index);
}

export async function assertSubdomainPolicy(
  client: DatabaseClient,
  userId: string,
  subdomain: string,
): Promise<void> {
  const policy = await getPrefixPolicy(client);
  if (policy !== "enforce") return;
  const user = await client.query<{ username: string }>("SELECT username FROM users WHERE id=?", [
    userId,
  ]);
  const username = user.rows[0]?.username;
  if (!username) return;
  const prefix = usernamePrefix(username);
  if (!normalizeSubdomain(subdomain).startsWith(prefix)) {
    throw new HttpError(400, "SUBDOMAIN_PREFIX_REQUIRED", `子域必须以 ${prefix} 开头`, {
      field_errors: { subdomain: `当前部署要求子域以 ${prefix} 开头` },
    });
  }
}

export type SubdomainAvailability = {
  name: string;
  available: boolean;
  reason: "ok" | "invalid" | "reserved" | "conflict" | "prefix";
  message: string;
  suggestions: string[];
  occupant?: { username: string } | null;
};

export async function checkSubdomainAvailability(
  client: DatabaseClient,
  rawName: string,
  options: { username: string; isAdmin: boolean; userId: string },
): Promise<SubdomainAvailability> {
  const name = normalizeSubdomain(rawName);
  const invalid = name ? validateSubdomain(name) : "请输入子域";
  if (!name || invalid) {
    return {
      name,
      available: false,
      reason: invalid?.includes("保留") ? "reserved" : "invalid",
      message: invalid ?? "请输入子域",
      suggestions: await availableSuggestions(client, suggestionCandidates(name || "app", options.username)),
    };
  }
  try {
    await assertSubdomainPolicy(client, options.userId, name);
  } catch (error) {
    if (error instanceof HttpError && error.errorCode === "SUBDOMAIN_PREFIX_REQUIRED") {
      return {
        name,
        available: false,
        reason: "prefix",
        message: error.message,
        suggestions: await availableSuggestions(
          client,
          suggestionCandidates(name, options.username).map((item) =>
            item.startsWith(usernamePrefix(options.username))
              ? item
              : suggestedSubdomain(item, options.username),
          ),
        ),
      };
    }
    throw error;
  }
  const occupied = await client.query<{ username: string }>(
    `SELECT u.username FROM connections c JOIN users u ON u.id=c.user_id
      WHERE lower(c.subdomain)=lower(?) AND c.deleted_at IS NULL LIMIT 1`,
    [name],
  );
  if (occupied.rows[0]) {
    return {
      name,
      available: false,
      reason: "conflict",
      message: "这个地址已被使用",
      suggestions: await availableSuggestions(client, suggestionCandidates(name, options.username)),
      occupant: options.isAdmin ? { username: occupied.rows[0].username } : null,
    };
  }
  return {
    name,
    available: true,
    reason: "ok",
    message: `将发布为 https://${name}.${config.tunnelDomain}`,
    suggestions: [],
  };
}

async function availableSuggestions(client: DatabaseClient, candidates: string[]): Promise<string[]> {
  const unique = [...new Set(candidates.filter((item) => !validateSubdomain(item)))];
  if (!unique.length) return [];
  const occupied = await client.query<{ subdomain: string }>(
    `SELECT lower(subdomain) AS subdomain FROM connections
      WHERE deleted_at IS NULL AND lower(subdomain) IN (${unique.map(() => "?").join(",")})`,
    unique,
  );
  const taken = new Set(occupied.rows.map((row) => row.subdomain));
  return unique.filter((item) => !taken.has(item)).slice(0, 3);
}
