import { randomBytes, randomUUID } from "node:crypto";
import { resolveCname, resolveTxt } from "node:dns/promises";
import type { DatabaseClient } from "./db.js";
import { config } from "./config.js";
import { bumpDeviceConfig } from "./domain.js";
import { HttpError } from "./http.js";

const labelPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export type CustomDomainRow = {
  id: string;
  connection_id: string;
  domain: string;
  verification_token: string;
  status: "pending" | "verified";
  verified_at: Date | null;
  last_checked_at: Date | null;
  created_at: Date;
  updated_at: Date;
  subdomain?: string;
  user_id?: string;
  device_id?: string;
  connection_version?: string | number;
};

export type DnsResolver = {
  resolveTxt(name: string): Promise<string[][]>;
  resolveCname(name: string): Promise<string[]>;
};

const systemResolver: DnsResolver = { resolveTxt, resolveCname };
let dnsResolver: DnsResolver = systemResolver;

// 仅供单元/集成测试注入确定性 DNS 结果；生产环境始终使用 node:dns。
export function setDnsResolverForTests(resolver: DnsResolver | null): void {
  if (config.nodeEnv !== "test") throw new Error("DNS resolver injection is test-only");
  dnsResolver = resolver ?? systemResolver;
}

export function normalizeCustomDomain(value: string): string {
  return value.trim().replace(/\.$/, "").toLowerCase();
}

export function validateCustomDomain(value: string): string | null {
  const domain = normalizeCustomDomain(value);
  if (domain.length < 4 || domain.length > 253 || !domain.includes("."))
    return "请输入合法的完整域名";
  if (
    domain.includes("..") ||
    domain.startsWith("*.") ||
    domain.split(".").some((label) => !labelPattern.test(label))
  ) {
    return "域名格式无效，仅支持 ASCII 字母、数字、连字符和点";
  }
  const managed = config.tunnelDomain.toLowerCase();
  const consoleDomain = new URL(config.publicBaseUrl).hostname.toLowerCase();
  if (domain === managed || domain.endsWith(`.${managed}`) || domain === consoleDomain) {
    return "不能把 Home Tunnel 自身域名作为自定义域名";
  }
  return null;
}

export function txtRecordName(domain: string): string {
  return `_home-tunnel.${normalizeCustomDomain(domain)}`;
}

export function txtRecordValue(token: string): string {
  return `home-tunnel-verification=${token}`;
}

export function cnameTarget(subdomain: string): string {
  return `${subdomain.toLowerCase()}.${config.tunnelDomain.toLowerCase()}`;
}

export function publicCustomDomain(row: CustomDomainRow) {
  const target = cnameTarget(row.subdomain ?? "");
  return {
    id: row.id,
    connection_id: row.connection_id,
    domain: row.domain,
    status: row.status,
    verification: {
      txt_name: txtRecordName(row.domain),
      txt_value: txtRecordValue(row.verification_token),
      cname_target: target,
    },
    verified_at: row.verified_at,
    last_checked_at: row.last_checked_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function dnsErrorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return "DNS_ERROR";
}

async function withinTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(Object.assign(new Error("DNS lookup timed out"), { code: "ETIMEOUT" })),
          5_000,
        );
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function inspectCustomDomainDns(
  row: Pick<CustomDomainRow, "domain" | "verification_token" | "subdomain">,
) {
  const txtName = txtRecordName(row.domain);
  const expectedTxt = txtRecordValue(row.verification_token);
  const expectedCname = cnameTarget(row.subdomain ?? "");
  const [txtResult, cnameResult] = await Promise.allSettled([
    withinTimeout(dnsResolver.resolveTxt(txtName)),
    withinTimeout(dnsResolver.resolveCname(row.domain)),
  ]);
  const txtValues =
    txtResult.status === "fulfilled" ? txtResult.value.map((parts) => parts.join("")) : [];
  const cnameValues =
    cnameResult.status === "fulfilled"
      ? cnameResult.value.map((value) => normalizeCustomDomain(value))
      : [];
  return {
    ok: txtValues.includes(expectedTxt) && cnameValues.includes(expectedCname),
    txt: {
      name: txtName,
      expected: expectedTxt,
      matched: txtValues.includes(expectedTxt),
      error_code: txtResult.status === "rejected" ? dnsErrorCode(txtResult.reason) : null,
    },
    cname: {
      name: row.domain,
      expected: expectedCname,
      matched: cnameValues.includes(expectedCname),
      error_code: cnameResult.status === "rejected" ? dnsErrorCode(cnameResult.reason) : null,
    },
  };
}

export async function createCustomDomain(
  client: DatabaseClient,
  connectionId: string,
  rawDomain: string,
  ownerUserId?: string,
): Promise<CustomDomainRow> {
  const domain = normalizeCustomDomain(rawDomain);
  const validationError = validateCustomDomain(domain);
  if (validationError) {
    throw new HttpError(400, "VALIDATION_ERROR", validationError, {
      field_errors: { domain: validationError },
    });
  }
  const connection = await client.query<{
    id: string;
    subdomain: string;
    user_id: string;
    device_id: string;
    proxy_type: string;
    deleted_at: Date | null;
  }>(
    "SELECT id,subdomain,user_id,device_id,proxy_type,deleted_at FROM connections WHERE id=? AND deleted_at IS NULL",
    [connectionId],
  );
  const subject = connection.rows[0];
  if (!subject || (ownerUserId && subject.user_id !== ownerUserId)) {
    throw new HttpError(404, "OWNERSHIP_MISMATCH", "连接不存在");
  }
  if (subject.proxy_type !== "http") {
    throw new HttpError(409, "PROXY_TYPE_UNSUPPORTED", "TCP 隧道不支持自定义域名");
  }
  const count = await client.query<{ count: string }>(
    "SELECT count(*) AS count FROM custom_domains WHERE connection_id=?",
    [connectionId],
  );
  if (Number(count.rows[0]?.count ?? 0) >= 100) {
    throw new HttpError(409, "CUSTOM_DOMAIN_LIMIT", "单条连接最多绑定 100 个自定义域名");
  }
  try {
    const created = await client.query<CustomDomainRow>(
      `INSERT INTO custom_domains(id,connection_id,domain,verification_token)
       VALUES(?,?,?,?) RETURNING *`,
      [randomUUID(), connectionId, domain, randomBytes(24).toString("base64url")],
    );
    return { ...created.rows[0]!, subdomain: subject.subdomain };
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) {
      throw new HttpError(409, "CUSTOM_DOMAIN_CONFLICT", "该域名已被其他连接绑定");
    }
    throw error;
  }
}

export async function applyVerifiedCustomDomain(
  client: DatabaseClient,
  domainId: string,
  checkedDomain: string,
  checkedToken: string,
  ownerUserId?: string,
): Promise<CustomDomainRow> {
  const loaded = await client.query<CustomDomainRow>(
    `SELECT cd.*,c.subdomain,c.user_id,c.device_id,c.version AS connection_version
       FROM custom_domains cd JOIN connections c ON c.id=cd.connection_id
      WHERE cd.id=? AND c.deleted_at IS NULL`,
    [domainId],
  );
  const current = loaded.rows[0];
  if (!current || (ownerUserId && current.user_id !== ownerUserId)) {
    throw new HttpError(404, "OWNERSHIP_MISMATCH", "自定义域名不存在");
  }
  if (current.status === "verified") return current;
  if (
    current.domain !== normalizeCustomDomain(checkedDomain) ||
    current.verification_token !== checkedToken
  ) {
    throw new HttpError(409, "STATE_CONFLICT", "域名状态已发生变化");
  }
  const verified = await client.query<CustomDomainRow>(
    `UPDATE custom_domains SET status='verified',verified_at=home_tunnel_now(),
       last_checked_at=home_tunnel_now(),updated_at=home_tunnel_now()
      WHERE id=? AND status='pending' RETURNING *`,
    [domainId],
  );
  if (!verified.rows[0]) throw new HttpError(409, "STATE_CONFLICT", "域名状态已发生变化");
  const version = await client.query<{ version: string }>(
    `UPDATE connections SET version=version+1,updated_at=home_tunnel_now()
      WHERE id=? AND deleted_at IS NULL RETURNING version`,
    [current.connection_id],
  );
  const nextVersion = Number(version.rows[0]?.version ?? 0);
  await client.query(
    `UPDATE runtime_states SET desired_version=?,state='Applying',last_error_code=NULL,updated_at=home_tunnel_now()
      WHERE connection_id=?`,
    [nextVersion, current.connection_id],
  );
  await bumpDeviceConfig(
    client,
    current.device_id!,
    "custom-domain.verified",
    "CustomDomain",
    domainId,
    nextVersion,
    current.user_id!,
    { connection_id: current.connection_id, domain: current.domain },
  );
  return { ...verified.rows[0], subdomain: current.subdomain };
}

// DNS 查询可能等待数秒，必须在 SQLite 写事务之外执行。返回规范化域名作为
// finalize 阶段的短期凭据；事务内会重新加载并核对，避免绑定记录被替换。
export async function verifyCustomDomainDns(
  domainId: string,
  ownerUserId?: string,
): Promise<CustomDomainRow> {
  const { one, query } = await import("./db.js");
  const current = await one<CustomDomainRow>(
    `SELECT cd.*,c.subdomain,c.user_id,c.device_id,c.version AS connection_version
       FROM custom_domains cd JOIN connections c ON c.id=cd.connection_id
      WHERE cd.id=? AND c.deleted_at IS NULL`,
    [domainId],
  );
  if (!current || (ownerUserId && current.user_id !== ownerUserId)) {
    throw new HttpError(404, "OWNERSHIP_MISMATCH", "自定义域名不存在");
  }
  if (current.status === "verified") return current;
  const checked = await inspectCustomDomainDns(current);
  await query(
    "UPDATE custom_domains SET last_checked_at=home_tunnel_now(),updated_at=home_tunnel_now() WHERE id=?",
    [domainId],
  );
  if (!checked.ok) {
    throw new HttpError(409, "DNS_VERIFICATION_FAILED", "DNS TXT 或 CNAME 记录尚未生效", checked);
  }
  return current;
}

export async function deleteCustomDomain(
  client: DatabaseClient,
  domainId: string,
  ownerUserId?: string,
): Promise<CustomDomainRow> {
  const loaded = await client.query<CustomDomainRow>(
    `SELECT cd.*,c.subdomain,c.user_id,c.device_id,c.version AS connection_version
       FROM custom_domains cd JOIN connections c ON c.id=cd.connection_id
      WHERE cd.id=? AND c.deleted_at IS NULL`,
    [domainId],
  );
  const current = loaded.rows[0];
  if (!current || (ownerUserId && current.user_id !== ownerUserId)) {
    throw new HttpError(404, "OWNERSHIP_MISMATCH", "自定义域名不存在");
  }
  await client.query("DELETE FROM custom_domains WHERE id=?", [domainId]);
  if (current.status === "verified") {
    const version = await client.query<{ version: string }>(
      `UPDATE connections SET version=version+1,updated_at=home_tunnel_now()
        WHERE id=? AND deleted_at IS NULL RETURNING version`,
      [current.connection_id],
    );
    const nextVersion = Number(version.rows[0]?.version ?? 0);
    await client.query(
      `UPDATE runtime_states SET desired_version=?,state='Applying',last_error_code=NULL,updated_at=home_tunnel_now()
        WHERE connection_id=?`,
      [nextVersion, current.connection_id],
    );
    await bumpDeviceConfig(
      client,
      current.device_id!,
      "custom-domain.deleted",
      "CustomDomain",
      domainId,
      nextVersion,
      current.user_id!,
      { connection_id: current.connection_id, domain: current.domain },
    );
  }
  return current;
}
