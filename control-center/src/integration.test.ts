import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { once } from "node:events";

const enabled = process.env.RUN_INTEGRATION === "1";

export async function runIntegrationSuite(): Promise<void> {
  assert.ok(process.env.SQLITE_PATH, "SQLITE_PATH is required for integration tests");
  assert.ok(
    process.env.BOOTSTRAP_ADMIN_PASSWORD,
    "BOOTSTRAP_ADMIN_PASSWORD is required for integration tests",
  );
  process.env.NODE_ENV = "test";
  process.env.INTERNAL_SERVICE_KEY ??= "11".repeat(32);
  process.env.FRPS_PLUGIN_KEY ??= "22".repeat(32);
  process.env.LEASE_SIGNING_KEY ??= "33".repeat(32);
  process.env.COOKIE_SECURE = "false";
  process.env.ONLINE_LEASE_SECONDS = "86400";
  process.env.TCP_TUNNEL_ENABLED = "true";
  process.env.TCP_PORT_START = "10000";
  process.env.TCP_PORT_END = "10099";

  const [{ createApplication }, database, maintenance, quota, customDomains] = await Promise.all([
    import("./server.js"),
    import("./db.js"),
    import("./maintenance.js"),
    import("./quota.js"),
    import("./custom-domains.js"),
  ]);
  const noopAlert = async () => ({ delivered: false, deduplicated: false, results: [] });
  const app = await createApplication(true);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;

  async function call(
    method: string,
    path: string,
    body?: unknown,
    token?: string,
    headers: Record<string, string> = {},
  ) {
    const response = await fetch(origin + path, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        connection: "close",
        "x-request-id": randomUUID(),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const contentType = response.headers.get("content-type") ?? "";
    let payload: any = null;
    if (response.status !== 204) {
      payload = contentType.includes("application/json")
        ? await response.json()
        : await response.text();
    }
    return { status: response.status, payload, headers: response.headers };
  }

  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const adminNextPassword = `RootOps-${suffix}-M7!safe`;
  const userNextPassword = `Client-${suffix}-Q9!safe`;
  let adminToken = "";
  let adminRefresh = "";

  try {
    // 未配置 FRPS_TLS_CERT_FILE 时公开配置不得出现证书字段（向后兼容）。
    const publicConfig = await call("GET", "/api/v1/public/config");
    assert.equal(publicConfig.status, 200);
    assert.ok(!("frps_tls_certificate_pem" in publicConfig.payload));

    const consoleTls = await call("GET", "/internal/tls/allow?domain=console.tunnel.example.com");
    assert.equal(consoleTls.status, 204);
    const unassignedTls = await call(
      "GET",
      "/internal/tls/allow?domain=unassigned.tunnel.example.com",
    );
    assert.equal(unassignedTls.status, 404);

    const bootstrapLogin = await call("POST", "/api/v1/auth/login", {
      username: "admin",
      password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
      client_type: "windows",
    });
    assert.equal(bootstrapLogin.status, 200);
    assert.equal(bootstrapLogin.payload.password_change_required, true);
    const blocked = await call(
      "GET",
      "/api/v1/client/connections",
      undefined,
      bootstrapLogin.payload.access_token,
    );
    assert.equal(blocked.status, 423);
    assert.equal(blocked.payload.error_code, "PASSWORD_CHANGE_REQUIRED");
    const changedAdmin = await call(
      "POST",
      "/api/v1/auth/password/change",
      {
        current_password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
        new_password: adminNextPassword,
      },
      bootstrapLogin.payload.access_token,
    );
    assert.equal(changedAdmin.status, 204);

    const adminLogin = await call("POST", "/api/v1/auth/login", {
      username: "admin",
      password: adminNextPassword,
      client_type: "windows",
    });
    assert.equal(adminLogin.status, 200);
    adminToken = adminLogin.payload.access_token;
    adminRefresh = adminLogin.payload.refresh_token;

    const createdUser = await call(
      "POST",
      "/api/v1/admin/users",
      {
        username: `user-${suffix}`,
        display_name: "Integration User",
        role: "user",
        bandwidth_limit_bps: 20_000_000,
      },
      adminToken,
    );
    assert.equal(createdUser.status, 201);
    const temporaryPassword = createdUser.payload.temporary_password as string;
    const userId = createdUser.payload.user.id as string;
    assert.ok(temporaryPassword.length >= 12);

    const initialUserLogin = await call("POST", "/api/v1/auth/login", {
      username: `user-${suffix}`,
      password: temporaryPassword,
      client_type: "windows",
    });
    assert.equal(initialUserLogin.status, 200);
    assert.equal(initialUserLogin.payload.password_change_required, true);
    assert.equal(
      (
        await call(
          "POST",
          "/api/v1/auth/password/change",
          {
            current_password: temporaryPassword,
            new_password: userNextPassword,
          },
          initialUserLogin.payload.access_token,
        )
      ).status,
      204,
    );

    const userLogin = await call("POST", "/api/v1/auth/login", {
      username: `user-${suffix}`,
      password: userNextPassword,
      client_type: "linux",
    });
    assert.equal(userLogin.status, 200);
    assert.equal(typeof userLogin.payload.access_token, "string");
    assert.equal(typeof userLogin.payload.refresh_token, "string");
    const linuxRefresh = await call("POST", "/api/v1/auth/refresh", {
      refresh_token: userLogin.payload.refresh_token,
      client_type: "linux",
    });
    assert.equal(linuxRefresh.status, 200);
    assert.equal(typeof linuxRefresh.payload.access_token, "string");
    assert.equal(typeof linuxRefresh.payload.refresh_token, "string");
    const userToken = linuxRefresh.payload.access_token as string;

    const ordinaryWebLogin = await call("POST", "/api/v1/auth/login", {
      username: `user-${suffix}`,
      password: userNextPassword,
      client_type: "web",
    });
    assert.equal(ordinaryWebLogin.status, 403);
    assert.equal(ordinaryWebLogin.payload.error_code, "FORBIDDEN");
    const registered = await call(
      "POST",
      "/api/v1/devices/register",
      {
        name: "Integration Device",
        install_id: `install-${suffix}`,
        fingerprint_hash: "ab".repeat(32),
        client_version: "2.0.0-test",
      },
      userToken,
    );
    assert.equal(registered.status, 201);
    const deviceId = registered.payload.device_id as string;
    const deviceCredential = registered.payload.device_credential as string;

    const createdConnection = await call(
      "POST",
      "/api/v1/client/connections",
      {
        device_id: deviceId,
        name: "Integration Tunnel",
        subdomain: `it-${suffix}`,
        local_scheme: "http",
        local_host: "127.0.0.1",
        local_port: 18080,
        enabled: true,
        bandwidth_limit_bps: 10_000_000,
      },
      userToken,
    );
    assert.equal(createdConnection.status, 201);
    const connectionId = createdConnection.payload.id as string;

    // ---- 自定义域名（功能 3）：TXT + CNAME 双验证，测试解析器不出网 ----
    const customDomain = `home-${suffix}.example.net`;
    const pendingDomain = await call(
      "POST",
      `/api/v1/client/connections/${connectionId}/custom-domains`,
      {
        domain: customDomain,
      },
      userToken,
    );
    assert.equal(pendingDomain.status, 201);
    assert.equal(pendingDomain.payload.status, "pending");
    assert.equal(pendingDomain.payload.verification.txt_name, `_home-tunnel.${customDomain}`);
    assert.equal(
      pendingDomain.payload.verification.cname_target,
      `it-${suffix}.tunnel.example.com`,
    );
    const customDomainId = pendingDomain.payload.id as string;
    customDomains.setDnsResolverForTests({
      resolveTxt: async (name: string) =>
        name === pendingDomain.payload.verification.txt_name
          ? [[pendingDomain.payload.verification.txt_value]]
          : [],
      resolveCname: async (name: string) =>
        name === customDomain ? [pendingDomain.payload.verification.cname_target + "."] : [],
    });
    const verifiedDomain = await call(
      "POST",
      `/api/v1/client/custom-domains/${customDomainId}/verify`,
      {},
      userToken,
    );
    assert.equal(verifiedDomain.status, 200);
    assert.equal(verifiedDomain.payload.status, "verified");
    customDomains.setDnsResolverForTests(null);
    const customTls = await call(
      "GET",
      `/internal/tls/allow?domain=${encodeURIComponent(customDomain)}`,
    );
    assert.equal(customTls.status, 204);
    const verifiedConnectionVersion = Number(
      (
        await database.query<{ version: string }>("SELECT version FROM connections WHERE id=?", [
          connectionId,
        ])
      )[0]?.version,
    );
    assert.equal(verifiedConnectionVersion, 2);

    const policyEvents = await fetch(origin + "/internal/policies/events", {
      headers: {
        "x-home-tunnel-key": process.env.INTERNAL_SERVICE_KEY!,
        accept: "text/event-stream",
      },
    });
    assert.equal(policyEvents.status, 200);
    assert.ok(policyEvents.body);
    const policyReader = policyEvents.body.getReader();
    const decoder = new TextDecoder();
    const readyEvent = await policyReader.read();
    assert.match(decoder.decode(readyEvent.value), /event: ready/);
    const pushedPolicyEvent = policyReader.read();

    const firstUpdate = await call(
      "PATCH",
      `/api/v1/client/connections/${connectionId}`,
      {
        name: "Integration Tunnel Updated",
      },
      userToken,
      { "if-match": `"${verifiedConnectionVersion}"` },
    );
    assert.equal(firstUpdate.status, 200);
    assert.equal(firstUpdate.payload.version, 3);
    const pushed = await Promise.race([
      pushedPolicyEvent,
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error("policy push timed out")), 2_000),
      ),
    ]);
    assert.match(decoder.decode(pushed.value), /event: policy/);
    await policyReader.cancel();
    const staleUpdate = await call(
      "PATCH",
      `/api/v1/client/connections/${connectionId}`,
      {
        name: "Stale Update Must Not Win",
      },
      userToken,
      { "if-match": `"${verifiedConnectionVersion}"` },
    );
    assert.equal(staleUpdate.status, 409);
    assert.equal(staleUpdate.payload.error_code, "VERSION_CONFLICT");

    // ---- 网关访问控制（功能 1）：schema 校验、ACL-only 编辑、快照契约 ----
    const invalidCidr = await call(
      "PATCH",
      `/api/v1/client/connections/${connectionId}`,
      {
        access: { ip_allowlist: ["not-a-cidr"] },
      },
      userToken,
      { "if-match": '"3"' },
    );
    assert.equal(invalidCidr.status, 400);
    assert.equal(invalidCidr.payload.error_code, "VALIDATION_ERROR");
    const shortGatePassword = await call(
      "PATCH",
      `/api/v1/client/connections/${connectionId}`,
      {
        access: { basic_auth: { username: "svc", password: "short" } },
      },
      userToken,
      { "if-match": '"3"' },
    );
    assert.equal(shortGatePassword.status, 400);
    const colonGateUser = await call(
      "PATCH",
      `/api/v1/client/connections/${connectionId}`,
      {
        access: { basic_auth: { username: "svc:bad", password: "long enough pass" } },
      },
      userToken,
      { "if-match": '"3"' },
    );
    assert.equal(colonGateUser.status, 400);

    const configVersionBeforeAcl = Number(
      (
        await database.query<{ config_version: string }>(
          "SELECT config_version FROM devices WHERE id=?",
          [deviceId],
        )
      )[0]?.config_version,
    );
    const policiesBeforeAcl = await call("GET", "/internal/policies/sync", undefined, undefined, {
      "x-home-tunnel-key": process.env.INTERNAL_SERVICE_KEY!,
    });
    assert.equal(policiesBeforeAcl.status, 200);

    const aclUpdate = await call(
      "PATCH",
      `/api/v1/client/connections/${connectionId}`,
      {
        access: {
          ip_allowlist: ["203.0.113.0/24", "2001:db8::/64"],
          basic_auth: { username: "svc", password: "gate pass 42!" },
        },
      },
      userToken,
      { "if-match": '"3"' },
    );
    assert.equal(aclUpdate.status, 200);
    // ACL-only 编辑：连接 version 不变（Agent 无需重配），只有门禁版本递增
    assert.equal(aclUpdate.payload.version, 3);
    assert.equal(aclUpdate.payload.access_policy_version, 2);
    assert.deepEqual(aclUpdate.payload.access_ip_allowlist, ["203.0.113.0/24", "2001:db8::/64"]);
    assert.equal(aclUpdate.payload.access_basic_auth_enabled, true);
    const aclUpdateSerialized = JSON.stringify(aclUpdate.payload);
    assert.ok(
      !aclUpdateSerialized.includes("access_basic_hash"),
      "public payload must not expose the hash column",
    );
    assert.ok(
      !aclUpdateSerialized.includes("scrypt$"),
      "public payload must not leak hash material",
    );
    assert.ok(
      !aclUpdateSerialized.includes("gate pass 42!"),
      "public payload must not leak the plaintext password",
    );

    const configVersionAfterAcl = Number(
      (
        await database.query<{ config_version: string }>(
          "SELECT config_version FROM devices WHERE id=?",
          [deviceId],
        )
      )[0]?.config_version,
    );
    assert.equal(
      configVersionAfterAcl,
      configVersionBeforeAcl,
      "ACL-only edits must not bump device config_version",
    );
    const aclOutbox = await database.query<{ count: string }>(
      "SELECT count(*) AS count FROM outbox_events WHERE event_type='access.policy.changed' AND resource_id=?",
      [connectionId],
    );
    assert.equal(
      Number(aclOutbox[0]?.count),
      1,
      "ACL edits must enqueue an access.policy.changed outbox event",
    );

    // outbox 前进使快照 revision 变化：携带旧 ETag 必须拿到 200 新快照而非 304
    const policiesAfterAcl = await call("GET", "/internal/policies/sync", undefined, undefined, {
      "x-home-tunnel-key": process.env.INTERNAL_SERVICE_KEY!,
      "if-none-match": policiesBeforeAcl.headers.get("etag") ?? "",
    });
    assert.equal(policiesAfterAcl.status, 200);
    const aclSnapshotEntry = policiesAfterAcl.payload.connections.find(
      (item: any) => item.connection_id === connectionId,
    );
    assert.deepEqual(aclSnapshotEntry.access_ip_allowlist, ["203.0.113.0/24", "2001:db8::/64"]);
    assert.equal(aclSnapshotEntry.access_basic_user, "svc");
    assert.match(aclSnapshotEntry.access_basic_hash, /^scrypt\$16384\$8\$1\$/);
    assert.ok(
      !aclSnapshotEntry.access_basic_hash.includes("gate pass 42!"),
      "snapshot must never contain plaintext",
    );
    assert.equal(aclSnapshotEntry.access_policy_version, 2);
    const protectedMetrics = await call("GET", "/internal/metrics", undefined, undefined, {
      "x-home-tunnel-key": process.env.INTERNAL_SERVICE_KEY!,
    });
    assert.match(
      protectedMetrics.payload as string,
      /^home_tunnel_connections_access_protected_total 1$/m,
    );

    // 关闭 Basic Auth（basic_auth: null）：白名单保留，门禁版本再次递增
    const aclClearBasic = await call(
      "PATCH",
      `/api/v1/client/connections/${connectionId}`,
      {
        access: { basic_auth: null },
      },
      userToken,
      { "if-match": '"3"' },
    );
    assert.equal(aclClearBasic.status, 200);
    assert.equal(aclClearBasic.payload.version, 3);
    assert.equal(aclClearBasic.payload.access_policy_version, 3);
    assert.equal(aclClearBasic.payload.access_basic_auth_enabled, false);
    assert.deepEqual(aclClearBasic.payload.access_ip_allowlist, [
      "203.0.113.0/24",
      "2001:db8::/64",
    ]);

    // 清除白名单（ip_allowlist: null）：连接回到完全开放
    const aclClearAllowlist = await call(
      "PATCH",
      `/api/v1/client/connections/${connectionId}`,
      {
        access: { ip_allowlist: null },
      },
      userToken,
      { "if-match": '"3"' },
    );
    assert.equal(aclClearAllowlist.status, 200);
    assert.equal(aclClearAllowlist.payload.access_ip_allowlist, null);
    assert.equal(aclClearAllowlist.payload.access_policy_version, 4);
    const clearedSnapshot = await call("GET", "/internal/policies/sync", undefined, undefined, {
      "x-home-tunnel-key": process.env.INTERNAL_SERVICE_KEY!,
    });
    const clearedEntry = clearedSnapshot.payload.connections.find(
      (item: any) => item.connection_id === connectionId,
    );
    assert.equal(clearedEntry.access_ip_allowlist, null);
    assert.equal(clearedEntry.access_basic_user, null);
    assert.equal(clearedEntry.access_basic_hash, null);
    const configVersionAfterClear = Number(
      (
        await database.query<{ config_version: string }>(
          "SELECT config_version FROM devices WHERE id=?",
          [deviceId],
        )
      )[0]?.config_version,
    );
    assert.equal(
      configVersionAfterClear,
      configVersionBeforeAcl,
      "clearing ACLs must not bump device config_version either",
    );

    const sync = await call(
      "POST",
      "/api/v1/client/sync",
      {
        device_id: deviceId,
        last_config_version: 0,
      },
      userToken,
    );
    assert.equal(sync.status, 200);
    assert.equal(sync.payload.connections.length, 1);
    assert.deepEqual(sync.payload.connections[0].custom_domains, [customDomain]);
    const lease = sync.payload.lease.lease as string;
    const proxyName = sync.payload.connections[0].proxy_name as string;
    const legacyUnchangedSync = await call(
      "POST",
      "/api/v1/client/sync",
      {
        device_id: deviceId,
        last_config_version: sync.payload.target_config_version,
      },
      userToken,
    );
    assert.equal(legacyUnchangedSync.status, 200);
    assert.ok(
      legacyUnchangedSync.payload.lease?.lease,
      "legacy clients continue receiving a lease",
    );
    const optimizedUnchangedSync = await call(
      "POST",
      "/api/v1/client/sync",
      {
        device_id: deviceId,
        last_config_version: sync.payload.target_config_version,
        supports_optional_lease: true,
        lease_expires_at: legacyUnchangedSync.payload.lease.expires_at,
      },
      userToken,
    );
    assert.equal(optimizedUnchangedSync.status, 200);
    assert.equal(optimizedUnchangedSync.payload.full_sync, false);
    assert.equal(optimizedUnchangedSync.payload.connections.length, 0);
    assert.equal(optimizedUnchangedSync.payload.lease, null);

    const pluginBase = `/internal/frps/plugin/${encodeURIComponent(process.env.FRPS_PLUGIN_KEY!)}`;
    const pluginDenied = await call(
      "POST",
      `/internal/frps/plugin/${"00".repeat(32)}?token=${encodeURIComponent(process.env.FRPS_PLUGIN_KEY!)}&version=0.1.0&op=Login`,
      { version: "0.1.0", op: "Login", content: {} },
    );
    assert.equal(pluginDenied.payload.reject, true);
    assert.equal(pluginDenied.payload.reject_reason, "PLUGIN_AUTH_INVALID");
    const pluginLogin = await call("POST", `${pluginBase}?version=0.1.0&op=Login`, {
      version: "0.1.0",
      op: "Login",
      content: { user: deviceId, metas: { home_tunnel_lease: lease } },
    });
    assert.equal(pluginLogin.status, 200);
    assert.equal(pluginLogin.payload.reject, false);
    const pluginProxy = await call("POST", `${pluginBase}?version=0.1.0&op=NewProxy`, {
      version: "0.1.0",
      op: "NewProxy",
      content: {
        user: { user: deviceId, metas: { home_tunnel_lease: lease }, run_id: "integration-run" },
        proxy_name: `${deviceId}.${proxyName}`,
        proxy_type: "http",
        custom_domains: [`it-${suffix}.tunnel.example.com`, customDomain],
        subdomain: "",
      },
    });
    assert.equal(pluginProxy.payload.reject, false);
    const customPolicy = await call("GET", "/internal/policies/sync", undefined, undefined, {
      "x-home-tunnel-key": process.env.INTERNAL_SERVICE_KEY!,
    });
    assert.deepEqual(
      customPolicy.payload.connections.find((item: any) => item.connection_id === connectionId)
        ?.custom_domains,
      [customDomain],
    );
    const forgedProxy = await call("POST", `${pluginBase}?version=0.1.0&op=NewProxy`, {
      version: "0.1.0",
      op: "NewProxy",
      content: {
        user: { user: deviceId, metas: { home_tunnel_lease: lease }, run_id: "integration-run" },
        proxy_name: `${deviceId}.${proxyName}`,
        proxy_type: "http",
        custom_domains: [`it-${suffix}.tunnel.example.com`, "forged.example.net"],
      },
    });
    assert.equal(forgedProxy.payload.reject, true);
    assert.equal(forgedProxy.payload.reject_reason, "PROXY_NOT_ALLOWED");
    const forgedPrefix = await call("POST", `${pluginBase}?version=0.1.0&op=NewProxy`, {
      version: "0.1.0",
      op: "NewProxy",
      content: {
        user: { user: deviceId, metas: { home_tunnel_lease: lease }, run_id: "integration-run" },
        proxy_name: `${randomUUID()}.${proxyName}`,
        proxy_type: "http",
        custom_domains: [`it-${suffix}.tunnel.example.com`],
      },
    });
    assert.equal(forgedPrefix.payload.reject, true);
    assert.equal(forgedPrefix.payload.reject_reason, "PROXY_NOT_ALLOWED");

    const pluginClose = await call("POST", `${pluginBase}?version=0.1.0&op=CloseProxy`, {
      version: "0.1.0",
      op: "CloseProxy",
      content: {
        user: { user: deviceId, metas: { home_tunnel_lease: lease }, run_id: "integration-run" },
        proxy_name: `${deviceId}.${proxyName}`,
      },
    });
    assert.equal(pluginClose.payload.reject, false);

    // 功能 4：只有管理员可以分配 TCP 公网端口；同步、FRPS 插件两端都按
    // 服务端固定端口校验，不能由客户端替换或夹带 HTTP 域名字段。
    const clientTcpDenied = await call(
      "POST",
      "/api/v1/client/connections",
      {
        device_id: deviceId,
        name: "forbidden-tcp",
        subdomain: `forbidden-${suffix}`,
        proxy_type: "tcp",
        tcp_remote_port: 10001,
        local_scheme: "http",
        local_host: "127.0.0.1",
        local_port: 22,
        enabled: true,
      },
      userToken,
    );
    assert.equal(clientTcpDenied.status, 400);

    const adminTcp = await call(
      "POST",
      "/api/v1/admin/connections",
      {
        user_id: userId,
        device_id: deviceId,
        name: "admin-tcp",
        subdomain: `tcp-${suffix}`,
        proxy_type: "tcp",
        tcp_remote_port: 10001,
        local_scheme: "http",
        local_host: "127.0.0.1",
        local_port: 22,
        enabled: true,
      },
      adminToken,
    );
    assert.equal(adminTcp.status, 201);
    assert.equal(adminTcp.payload.proxy_type, "tcp");
    assert.equal(adminTcp.payload.public_endpoint, "203.0.113.10:10001");
    const tcpId = adminTcp.payload.id as string;

    const duplicateTcp = await call(
      "POST",
      "/api/v1/admin/connections",
      {
        user_id: userId,
        device_id: deviceId,
        name: "duplicate-tcp",
        subdomain: `tcp-duplicate-${suffix}`,
        proxy_type: "tcp",
        tcp_remote_port: 10001,
        local_scheme: "http",
        local_host: "127.0.0.1",
        local_port: 2222,
        enabled: true,
      },
      adminToken,
    );
    assert.equal(duplicateTcp.status, 409);
    assert.equal(duplicateTcp.payload.error_code, "TCP_PORT_CONFLICT");

    const tcpDomainDenied = await call(
      "POST",
      `/api/v1/admin/connections/${tcpId}/custom-domains`,
      {
        domain: `tcp-${suffix}.example.net`,
      },
      adminToken,
    );
    assert.equal(tcpDomainDenied.status, 409);

    const tcpSync = await call(
      "POST",
      "/api/v1/client/sync",
      {
        device_id: deviceId,
        last_config_version: 0,
      },
      userToken,
    );
    const tcpConnection = tcpSync.payload.connections.find((item: any) => item.id === tcpId);
    assert.equal(tcpConnection.proxy_type, "tcp");
    assert.equal(tcpConnection.tcp_remote_port, 10001);
    const tcpLease = tcpSync.payload.lease.lease as string;
    const tcpProxyName = tcpConnection.proxy_name as string;
    const tcpProxy = await call("POST", `${pluginBase}?version=0.1.0&op=NewProxy`, {
      version: "0.1.0",
      op: "NewProxy",
      content: {
        user: { user: deviceId, metas: { home_tunnel_lease: tcpLease }, run_id: "tcp-run" },
        proxy_name: `${deviceId}.${tcpProxyName}`,
        proxy_type: "tcp",
        remote_port: 10001,
      },
    });
    assert.equal(tcpProxy.payload.reject, false);
    await database.query("UPDATE connections SET tcp_remote_port=9999 WHERE id=?", [tcpId]);
    const outOfRangeTcp = await call("POST", `${pluginBase}?version=0.1.0&op=NewProxy`, {
      version: "0.1.0",
      op: "NewProxy",
      content: {
        user: { user: deviceId, metas: { home_tunnel_lease: tcpLease }, run_id: "tcp-run" },
        proxy_name: `${deviceId}.${tcpProxyName}`,
        proxy_type: "tcp",
        remote_port: 9999,
      },
    });
    assert.equal(outOfRangeTcp.payload.reject, true);
    assert.equal(outOfRangeTcp.payload.reject_reason, "PROXY_NOT_ALLOWED");
    await database.query("UPDATE connections SET tcp_remote_port=10001 WHERE id=?", [tcpId]);
    const forgedTcp = await call("POST", `${pluginBase}?version=0.1.0&op=NewProxy`, {
      version: "0.1.0",
      op: "NewProxy",
      content: {
        user: { user: deviceId, metas: { home_tunnel_lease: tcpLease }, run_id: "tcp-run" },
        proxy_name: `${deviceId}.${tcpProxyName}`,
        proxy_type: "tcp",
        remote_port: 10002,
      },
    });
    assert.equal(forgedTcp.payload.reject, true);
    assert.equal(forgedTcp.payload.reject_reason, "PROXY_NOT_ALLOWED");

    const tcpPolicySnapshot = await call("GET", "/internal/policies/sync", undefined, undefined, {
      "x-home-tunnel-key": process.env.INTERNAL_SERVICE_KEY!,
    });
    assert.equal(
      tcpPolicySnapshot.payload.connections.some((item: any) => item.connection_id === tcpId),
      false,
    );

    const policiesBefore = await call("GET", "/internal/policies/sync", undefined, undefined, {
      "x-home-tunnel-key": process.env.INTERNAL_SERVICE_KEY!,
    });
    assert.equal(policiesBefore.status, 200);
    assert.equal(
      policiesBefore.payload.connections.find((item: any) => item.connection_id === connectionId)
        ?.enabled,
      true,
    );
    assert.ok(
      policiesBefore.payload.connections.find((item: any) => item.connection_id === connectionId)
        ?.device_lease_expires_at,
    );
    const unchangedPolicies = await call("GET", "/internal/policies/sync", undefined, undefined, {
      "x-home-tunnel-key": process.env.INTERNAL_SERVICE_KEY!,
      "if-none-match": policiesBefore.headers.get("etag") ?? "",
    });
    assert.equal(unchangedPolicies.status, 304);

    const metricsDenied = await call("GET", "/internal/metrics");
    assert.equal(metricsDenied.status, 401);
    const metrics = await call("GET", "/internal/metrics", undefined, undefined, {
      "x-home-tunnel-key": process.env.INTERNAL_SERVICE_KEY!,
    });
    assert.equal(metrics.status, 200);
    assert.match(metrics.headers.get("content-type") ?? "", /^text\/plain; version=0\.0\.4/);
    const metricsText = metrics.payload as string;
    assert.match(metricsText, /^home_tunnel_up 1$/m);
    assert.match(metricsText, /^home_tunnel_uptime_seconds \d+$/m);
    assert.match(metricsText, /^home_tunnel_users_total 2$/m);
    assert.match(metricsText, /^home_tunnel_devices_total 1$/m);
    assert.match(metricsText, /^home_tunnel_connections_total\{enabled="true"\} 2$/m);
    assert.match(metricsText, /^home_tunnel_connections_total\{enabled="false"\} 0$/m);
    assert.match(metricsText, /^home_tunnel_connections_access_protected_total 0$/m);
    assert.match(metricsText, /^home_tunnel_active_sessions_total \d+$/m);
    assert.match(metricsText, /^home_tunnel_websocket_clients 0$/m);
    assert.match(metricsText, /^home_tunnel_http_requests_total\{class="2xx"\} [1-9]\d*$/m);
    assert.match(metricsText, /^home_tunnel_http_requests_total\{class="5xx"\} \d+$/m);
    assert.match(metricsText, /^home_tunnel_backup_last_success_timestamp_seconds 0$/m);
    assert.match(metricsText, /^home_tunnel_quota_suspended_users_total \d+$/m);
    assert.match(metricsText, /^home_tunnel_devices_offline_total \d+$/m);
    assert.match(
      metricsText,
      /^home_tunnel_alerts_sent_total\{channel="webhook",result="ok"\} \d+$/m,
    );
    assert.match(
      metricsText,
      /^home_tunnel_alerts_sent_total\{channel="telegram",result="error"\} \d+$/m,
    );

    const bucketStart = new Date(Math.floor(Date.now() / 10_000) * 10_000).toISOString();
    const sampleBatch = await call(
      "POST",
      "/internal/traffic/samples",
      {
        batch_id: randomUUID(),
        samples: [
          {
            bucket_start: bucketStart,
            bucket_seconds: 10,
            user_id: userId,
            device_id: deviceId,
            connection_id: connectionId,
            upload_bytes: 100,
            download_bytes: 50,
            request_count: 1,
            error_count: 0,
          },
          {
            bucket_start: bucketStart,
            bucket_seconds: 10,
            user_id: randomUUID(),
            device_id: deviceId,
            connection_id: connectionId,
            upload_bytes: 999,
            download_bytes: 999,
            request_count: 9,
            error_count: 9,
          },
        ],
      },
      undefined,
      { "x-home-tunnel-key": process.env.INTERNAL_SERVICE_KEY! },
    );
    assert.equal(sampleBatch.status, 202);
    assert.equal(sampleBatch.payload.accepted, 1);
    assert.equal(sampleBatch.payload.dropped, 1);
    const storedSample = await database.query<{ upload_bytes: string }>(
      "SELECT upload_bytes FROM traffic_samples WHERE connection_id=? AND bucket_start=?",
      [connectionId, bucketStart],
    );
    assert.equal(Number(storedSample[0]?.upload_bytes), 100);

    // 功能 2：月度配额端到端。此刻该用户当月已写入 150 字节（100+50）。
    // 用基线-增量断言，避免依赖此处连接是否恰好处于 enabled 基线状态。
    const preQuotaSnapshot = await call("GET", "/internal/policies/sync", undefined, undefined, {
      "x-home-tunnel-key": process.env.INTERNAL_SERVICE_KEY!,
    });
    const enabledBaseline = preQuotaSnapshot.payload.connections.find(
      (item: any) => item.connection_id === connectionId,
    )?.enabled;
    const quotaPolicy = await call(
      "GET",
      `/api/v1/admin/traffic-policies/user/${userId}`,
      undefined,
      adminToken,
    );
    assert.equal(quotaPolicy.status, 200);
    const quotaSetLow = await call(
      "PATCH",
      `/api/v1/admin/traffic-policies/user/${userId}`,
      { bandwidth_limit_bps: quotaPolicy.payload.bandwidth_limit_bps, monthly_quota_bytes: 100 },
      adminToken,
      { "if-match": `"${quotaPolicy.payload.version}"` },
    );
    assert.equal(quotaSetLow.status, 200);
    assert.equal(quotaSetLow.payload.monthly_quota_bytes, 100);
    // 设置配额时 PATCH 已异步触发一次检查；这里再同步跑一次确保状态确定（幂等），
    // 并断言最终状态而非某次调用的计数，避免与异步触发竞争。计数行为由 quota.test.ts 覆盖。
    await quota.runQuotaEnforcement(noopAlert);
    const suspendedSnapshot = await call("GET", "/internal/policies/sync", undefined, undefined, {
      "x-home-tunnel-key": process.env.INTERNAL_SERVICE_KEY!,
    });
    assert.equal(
      suspendedSnapshot.payload.connections.find((item: any) => item.connection_id === connectionId)
        ?.enabled,
      false,
    );
    const suspendedUser = await call("GET", `/api/v1/admin/users/${userId}`, undefined, adminToken);
    assert.equal(suspendedUser.payload.quota_suspended, true);
    assert.ok(Number(suspendedUser.payload.month_to_date_bytes) >= 150);
    assert.equal(suspendedUser.payload.monthly_quota_bytes, 100);
    // 取消配额（置 null）后，超额挂起应在下次检查中自动解除，连接回到基线状态。
    const quotaAfterSuspend = await call(
      "GET",
      `/api/v1/admin/traffic-policies/user/${userId}`,
      undefined,
      adminToken,
    );
    const quotaClear = await call(
      "PATCH",
      `/api/v1/admin/traffic-policies/user/${userId}`,
      {
        bandwidth_limit_bps: quotaAfterSuspend.payload.bandwidth_limit_bps,
        monthly_quota_bytes: null,
      },
      adminToken,
      { "if-match": `"${quotaAfterSuspend.payload.version}"` },
    );
    assert.equal(quotaClear.status, 200);
    assert.equal(quotaClear.payload.monthly_quota_bytes, null);
    await quota.runQuotaEnforcement(noopAlert);
    const restoredUser = await call("GET", `/api/v1/admin/users/${userId}`, undefined, adminToken);
    assert.equal(restoredUser.payload.quota_suspended, false);
    const restoredSnapshot = await call("GET", "/internal/policies/sync", undefined, undefined, {
      "x-home-tunnel-key": process.env.INTERNAL_SERVICE_KEY!,
    });
    assert.equal(
      restoredSnapshot.payload.connections.find((item: any) => item.connection_id === connectionId)
        ?.enabled,
      enabledBaseline,
    );
    // 连接级策略不接受月度配额字段。
    const quotaOnConnection = await call(
      "PATCH",
      `/api/v1/admin/traffic-policies/connection/${connectionId}`,
      { bandwidth_limit_bps: null, monthly_quota_bytes: 1000 },
      adminToken,
      { "if-match": `"1"` },
    );
    assert.equal(quotaOnConnection.status, 400);
    // 测试环境未配置任何告警通道：测试端点返回 409。
    const alertTest = await call("POST", "/api/v1/admin/alerts/test", {}, adminToken);
    assert.equal(alertTest.status, 409);
    assert.equal(alertTest.payload.error_code, "NO_ALERT_CHANNEL");

    const oldBucket = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    oldBucket.setUTCSeconds(0, 0);
    await database.query(
      `INSERT INTO traffic_samples(batch_id,bucket_start,bucket_seconds,user_id,device_id,connection_id,upload_bytes,download_bytes,request_count,error_count)
       VALUES(?,?,10,?,?,?,7,8,1,0)`,
      [randomUUID(), oldBucket, userId, deviceId, connectionId],
    );
    const maintenanceResult = await maintenance.runDataMaintenance();
    assert.ok((maintenanceResult?.traffic_samples_archived ?? 0) >= 1);
    const archivedSample = await database.query<{ upload_bytes: string }>(
      "SELECT upload_bytes FROM traffic_hourly WHERE connection_id=? AND bucket_start=home_tunnel_hour(?)",
      [connectionId, oldBucket.toISOString()],
    );
    assert.equal(Number(archivedSample[0]?.upload_bytes), 7);

    assert.equal((await call("POST", "/api/v1/auth/logout", {}, userToken)).status, 204);
    const oldDeviceCredential = await call("POST", "/api/v1/auth/device", {
      device_id: deviceId,
      device_credential: deviceCredential,
    });
    assert.equal(oldDeviceCredential.status, 401);
    const policiesAfter = await call("GET", "/internal/policies/sync", undefined, undefined, {
      "x-home-tunnel-key": process.env.INTERNAL_SERVICE_KEY!,
    });
    assert.equal(
      policiesAfter.payload.connections.find((item: any) => item.connection_id === connectionId)
        ?.enabled,
      false,
    );

    const stalePing = await call("POST", `${pluginBase}?version=0.1.0&op=Ping`, {
      version: "0.1.0",
      op: "Ping",
      content: {
        user: { user: deviceId, metas: { home_tunnel_lease: lease }, run_id: "integration-run" },
        timestamp: Math.floor(Date.now() / 1000),
      },
    });
    assert.equal(stalePing.payload.reject, true);
    assert.equal(stalePing.payload.reject_reason, "LEASE_EXPIRED");

    const deletedDevice = await call("DELETE", `/api/v1/admin/devices/${deviceId}`, {}, adminToken);
    assert.equal(deletedDevice.status, 204);
    const devicesAfterDelete = await call("GET", "/api/v1/admin/devices", undefined, adminToken);
    assert.equal(devicesAfterDelete.status, 200);
    assert.equal(
      devicesAfterDelete.payload.items.some((item: any) => item.id === deviceId),
      false,
    );
    const storedDevice = await database.query<{ count: string }>(
      "SELECT count(*) AS count FROM devices WHERE id=?",
      [deviceId],
    );
    const storedConnections = await database.query<{ count: string }>(
      "SELECT count(*) AS count FROM connections WHERE device_id=?",
      [deviceId],
    );
    const storedTraffic = await database.query<{ count: string }>(
      `SELECT (SELECT count(*) FROM traffic_samples WHERE device_id=?) +
              (SELECT count(*) FROM traffic_hourly WHERE device_id=?) AS count`,
      [deviceId, deviceId],
    );
    assert.equal(Number(storedDevice[0]?.count), 0);
    assert.equal(Number(storedConnections[0]?.count), 0);
    assert.equal(Number(storedTraffic[0]?.count), 0);
    const policiesAfterDelete = await call("GET", "/internal/policies/sync", undefined, undefined, {
      "x-home-tunnel-key": process.env.INTERNAL_SERVICE_KEY!,
    });
    assert.equal(policiesAfterDelete.status, 200);
    assert.equal(
      policiesAfterDelete.payload.connections.some(
        (item: any) => item.connection_id === connectionId,
      ),
      false,
    );

    const auditEvents = await call(
      "GET",
      "/api/v1/admin/audit-events?limit=200",
      undefined,
      adminToken,
    );
    assert.equal(auditEvents.status, 200);
    assert.ok(
      auditEvents.payload.items.some((item: any) => item.action === "DeviceSessionRevoked"),
    );
    assert.ok(auditEvents.payload.items.some((item: any) => item.action === "ConnectionUpdated"));
    assert.ok(auditEvents.payload.items.some((item: any) => item.action === "DeviceDeleted"));

    const filteredAudit = await call(
      "GET",
      "/api/v1/admin/audit-events?page=1&page_size=1&action=ConnectionUpdated&target_type=Connection&q=Connection",
      undefined,
      adminToken,
    );
    assert.equal(filteredAudit.status, 200);
    assert.equal(filteredAudit.payload.page, 1);
    assert.equal(filteredAudit.payload.page_size, 1);
    assert.ok(filteredAudit.payload.total >= 1);
    assert.equal(filteredAudit.payload.items.length, 1);
    assert.equal(filteredAudit.payload.items[0].action, "ConnectionUpdated");
    assert.equal(filteredAudit.payload.items[0].target_type, "Connection");

    const stored = await database.query<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE id=?",
      [userId],
    );
    assert.notEqual(stored[0]?.password_hash, temporaryPassword);
    assert.notEqual(stored[0]?.password_hash, userNextPassword);

    const rotated = await call("POST", "/api/v1/auth/refresh", {
      refresh_token: adminRefresh,
      client_type: "windows",
    });
    assert.equal(rotated.status, 200);
    const replayed = await call("POST", "/api/v1/auth/refresh", {
      refresh_token: adminRefresh,
      client_type: "windows",
    });
    assert.equal(replayed.status, 401);
    assert.equal(replayed.payload.error_code, "SESSION_REVOKED");
  } finally {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await database.closeDatabase();
  }
}

if (process.env.RUN_INTEGRATION_DIRECT !== "1") {
  test(
    "SQLite API, lease, FRPS plugin, optimistic lock, and revocation closure",
    { skip: !enabled, timeout: 120_000 },
    runIntegrationSuite,
  );
}
