import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { once } from "node:events";

const enabled = process.env.RUN_INTEGRATION === "1";

export async function runIntegrationSuite(): Promise<void> {
  assert.ok(process.env.SQLITE_PATH, "SQLITE_PATH is required for integration tests");
  assert.ok(process.env.BOOTSTRAP_ADMIN_PASSWORD, "BOOTSTRAP_ADMIN_PASSWORD is required for integration tests");
  process.env.NODE_ENV = "test";
  process.env.INTERNAL_SERVICE_KEY ??= "11".repeat(32);
  process.env.FRPS_PLUGIN_KEY ??= "22".repeat(32);
  process.env.LEASE_SIGNING_KEY ??= "33".repeat(32);
  process.env.COOKIE_SECURE = "false";
  process.env.ONLINE_LEASE_SECONDS = "86400";

  const [{ createApplication }, database, maintenance] = await Promise.all([
    import("./server.js"),
    import("./db.js"),
    import("./maintenance.js"),
  ]);
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
      payload = contentType.includes("application/json") ? await response.json() : await response.text();
    }
    return { status: response.status, payload, headers: response.headers };
  }

  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const adminNextPassword = `RootOps-${suffix}-M7!safe`;
  const userNextPassword = `Client-${suffix}-Q9!safe`;
  let adminToken = "";
  let adminRefresh = "";

  try {
    const consoleTls = await call("GET", "/internal/tls/allow?domain=console.tunnel.example.com");
    assert.equal(consoleTls.status, 204);
    const unassignedTls = await call("GET", "/internal/tls/allow?domain=unassigned.tunnel.example.com");
    assert.equal(unassignedTls.status, 404);

    const bootstrapLogin = await call("POST", "/api/v1/auth/login", {
      username: "admin",
      password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
      client_type: "windows",
    });
    assert.equal(bootstrapLogin.status, 200);
    assert.equal(bootstrapLogin.payload.password_change_required, true);
    const blocked = await call("GET", "/api/v1/client/connections", undefined, bootstrapLogin.payload.access_token);
    assert.equal(blocked.status, 423);
    assert.equal(blocked.payload.error_code, "PASSWORD_CHANGE_REQUIRED");
    const changedAdmin = await call("POST", "/api/v1/auth/password/change", {
      current_password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
      new_password: adminNextPassword,
    }, bootstrapLogin.payload.access_token);
    assert.equal(changedAdmin.status, 204);

    const adminLogin = await call("POST", "/api/v1/auth/login", {
      username: "admin",
      password: adminNextPassword,
      client_type: "windows",
    });
    assert.equal(adminLogin.status, 200);
    adminToken = adminLogin.payload.access_token;
    adminRefresh = adminLogin.payload.refresh_token;

    const createdUser = await call("POST", "/api/v1/admin/users", {
      username: `user-${suffix}`,
      display_name: "Integration User",
      role: "user",
      bandwidth_limit_bps: 20_000_000,
    }, adminToken);
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
    assert.equal((await call("POST", "/api/v1/auth/password/change", {
      current_password: temporaryPassword,
      new_password: userNextPassword,
    }, initialUserLogin.payload.access_token)).status, 204);

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
    const registered = await call("POST", "/api/v1/devices/register", {
      name: "Integration Device",
      install_id: `install-${suffix}`,
      fingerprint_hash: "ab".repeat(32),
      client_version: "2.0.0-test",
    }, userToken);
    assert.equal(registered.status, 201);
    const deviceId = registered.payload.device_id as string;
    const deviceCredential = registered.payload.device_credential as string;

    const createdConnection = await call("POST", "/api/v1/client/connections", {
      device_id: deviceId,
      name: "Integration Tunnel",
      subdomain: `it-${suffix}`,
      local_scheme: "http",
      local_host: "127.0.0.1",
      local_port: 18080,
      enabled: true,
      bandwidth_limit_bps: 10_000_000,
    }, userToken);
    assert.equal(createdConnection.status, 201);
    const connectionId = createdConnection.payload.id as string;

    const policyEvents = await fetch(origin + "/internal/policies/events", {
      headers: { "x-home-tunnel-key": process.env.INTERNAL_SERVICE_KEY!, accept: "text/event-stream" },
    });
    assert.equal(policyEvents.status, 200);
    assert.ok(policyEvents.body);
    const policyReader = policyEvents.body.getReader();
    const decoder = new TextDecoder();
    const readyEvent = await policyReader.read();
    assert.match(decoder.decode(readyEvent.value), /event: ready/);
    const pushedPolicyEvent = policyReader.read();

    const firstUpdate = await call("PATCH", `/api/v1/client/connections/${connectionId}`, {
      name: "Integration Tunnel Updated",
    }, userToken, { "if-match": '"1"' });
    assert.equal(firstUpdate.status, 200);
    assert.equal(firstUpdate.payload.version, 2);
    const pushed = await Promise.race([
      pushedPolicyEvent,
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("policy push timed out")), 2_000)),
    ]);
    assert.match(decoder.decode(pushed.value), /event: policy/);
    await policyReader.cancel();
    const staleUpdate = await call("PATCH", `/api/v1/client/connections/${connectionId}`, {
      name: "Stale Update Must Not Win",
    }, userToken, { "if-match": '"1"' });
    assert.equal(staleUpdate.status, 409);
    assert.equal(staleUpdate.payload.error_code, "VERSION_CONFLICT");

    const sync = await call("POST", "/api/v1/client/sync", {
      device_id: deviceId,
      last_config_version: 0,
    }, userToken);
    assert.equal(sync.status, 200);
    assert.equal(sync.payload.connections.length, 1);
    const lease = sync.payload.lease.lease as string;
    const proxyName = sync.payload.connections[0].proxy_name as string;
    const legacyUnchangedSync = await call("POST", "/api/v1/client/sync", {
      device_id: deviceId,
      last_config_version: sync.payload.target_config_version,
    }, userToken);
    assert.equal(legacyUnchangedSync.status, 200);
    assert.ok(legacyUnchangedSync.payload.lease?.lease, "legacy clients continue receiving a lease");
    const optimizedUnchangedSync = await call("POST", "/api/v1/client/sync", {
      device_id: deviceId,
      last_config_version: sync.payload.target_config_version,
      supports_optional_lease: true,
      lease_expires_at: legacyUnchangedSync.payload.lease.expires_at,
    }, userToken);
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
        custom_domains: [`it-${suffix}.tunnel.example.com`],
        subdomain: "",
      },
    });
    assert.equal(pluginProxy.payload.reject, false);
    const forgedProxy = await call("POST", `${pluginBase}?version=0.1.0&op=NewProxy`, {
      version: "0.1.0",
      op: "NewProxy",
      content: {
        user: { user: deviceId, metas: { home_tunnel_lease: lease }, run_id: "integration-run" },
        proxy_name: `${deviceId}.${proxyName}`,
        proxy_type: "http",
        custom_domains: ["forged.tunnel.example.com"],
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

    const policiesBefore = await call("GET", "/internal/policies/sync", undefined, undefined, {
      "x-home-tunnel-key": process.env.INTERNAL_SERVICE_KEY!,
    });
    assert.equal(policiesBefore.status, 200);
    assert.equal(policiesBefore.payload.connections.find((item: any) => item.connection_id === connectionId)?.enabled, true);
    assert.ok(policiesBefore.payload.connections.find((item: any) => item.connection_id === connectionId)?.device_lease_expires_at);
    const unchangedPolicies = await call("GET", "/internal/policies/sync", undefined, undefined, {
      "x-home-tunnel-key": process.env.INTERNAL_SERVICE_KEY!,
      "if-none-match": policiesBefore.headers.get("etag") ?? "",
    });
    assert.equal(unchangedPolicies.status, 304);

    const bucketStart = new Date(Math.floor(Date.now() / 10_000) * 10_000).toISOString();
    const sampleBatch = await call("POST", "/internal/traffic/samples", {
      batch_id: randomUUID(),
      samples: [
        { bucket_start: bucketStart, bucket_seconds: 10, user_id: userId, device_id: deviceId, connection_id: connectionId, upload_bytes: 100, download_bytes: 50, request_count: 1, error_count: 0 },
        { bucket_start: bucketStart, bucket_seconds: 10, user_id: randomUUID(), device_id: deviceId, connection_id: connectionId, upload_bytes: 999, download_bytes: 999, request_count: 9, error_count: 9 },
      ],
    }, undefined, { "x-home-tunnel-key": process.env.INTERNAL_SERVICE_KEY! });
    assert.equal(sampleBatch.status, 202);
    assert.equal(sampleBatch.payload.accepted, 1);
    assert.equal(sampleBatch.payload.dropped, 1);
    const storedSample = await database.query<{ upload_bytes: string }>(
      "SELECT upload_bytes::text FROM traffic_samples WHERE connection_id=$1 AND bucket_start=$2",
      [connectionId, bucketStart],
    );
    assert.equal(Number(storedSample[0]?.upload_bytes), 100);

    const oldBucket = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    oldBucket.setUTCSeconds(0, 0);
    await database.query(
      `INSERT INTO traffic_samples(batch_id,bucket_start,bucket_seconds,user_id,device_id,connection_id,upload_bytes,download_bytes,request_count,error_count)
       VALUES($1,$2,10,$3,$4,$5,7,8,1,0)`,
      [randomUUID(), oldBucket, userId, deviceId, connectionId],
    );
    const maintenanceResult = await maintenance.runDataMaintenance();
    assert.ok((maintenanceResult?.traffic_samples_archived ?? 0) >= 1);
    const archivedSample = await database.query<{ upload_bytes: string }>(
      "SELECT upload_bytes::text FROM traffic_hourly WHERE connection_id=$1 AND bucket_start=date_trunc('hour',$2::timestamptz)",
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
    assert.equal(policiesAfter.payload.connections.find((item: any) => item.connection_id === connectionId)?.enabled, false);

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
    assert.equal(devicesAfterDelete.payload.items.some((item: any) => item.id === deviceId), false);
    const storedDevice = await database.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM devices WHERE id=$1",
      [deviceId],
    );
    const storedConnections = await database.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM connections WHERE device_id=$1",
      [deviceId],
    );
    const storedTraffic = await database.query<{ count: string }>(
      `SELECT (SELECT count(*) FROM traffic_samples WHERE device_id=$1) +
              (SELECT count(*) FROM traffic_hourly WHERE device_id=$1) AS count`,
      [deviceId],
    );
    assert.equal(Number(storedDevice[0]?.count), 0);
    assert.equal(Number(storedConnections[0]?.count), 0);
    assert.equal(Number(storedTraffic[0]?.count), 0);
    const policiesAfterDelete = await call("GET", "/internal/policies/sync", undefined, undefined, {
      "x-home-tunnel-key": process.env.INTERNAL_SERVICE_KEY!,
    });
    assert.equal(policiesAfterDelete.status, 200);
    assert.equal(policiesAfterDelete.payload.connections.some((item: any) => item.connection_id === connectionId), false);

    const auditEvents = await call("GET", "/api/v1/admin/audit-events?limit=200", undefined, adminToken);
    assert.equal(auditEvents.status, 200);
    assert.ok(auditEvents.payload.items.some((item: any) => item.action === "DeviceSessionRevoked"));
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

    const stored = await database.query<{ password_hash: string }>("SELECT password_hash FROM users WHERE id=$1", [userId]);
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
