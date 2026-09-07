import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

test("5.0 owner-aware validation, partial policies and complete pagination", async (t) => {
  process.env.NODE_ENV = "test";
  process.env.SQLITE_PATH = ":memory:";
  process.env.INTERNAL_SERVICE_KEY = "11".repeat(32);
  process.env.FRPS_PLUGIN_KEY = "22".repeat(32);
  process.env.LEASE_SIGNING_KEY = "33".repeat(32);
  process.env.COOKIE_SECURE = "false";
  process.env.BOOTSTRAP_ADMIN_PASSWORD = "Experience-Bootstrap-Q8-safe";
  const { createApplication } = await import("./server.js");
  const { closeDatabase } = await import("./db.js");
  const { usernamePrefix } = await import("./subdomain-policy.js");
  const server = (await createApplication()).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  async function call(
    method: string,
    path: string,
    body?: unknown,
    token?: string,
    version?: number,
  ) {
    const response = await fetch(origin + path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(version ? { "if-match": `"${version}"` } : {}),
      },
      body: body == null ? undefined : JSON.stringify(body),
    });
    // Test fixtures cover heterogeneous route payloads; assertions validate each shape below.
    const data = response.status === 204 ? null : await response.json();
    return { status: response.status, data };
  }
  try {
    const bootstrap = await call("POST", "/api/v1/auth/login", {
      username: "admin",
      password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
      client_type: "linux",
    });
    await call(
      "POST",
      "/api/v1/auth/password/change",
      {
        current_password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
        new_password: "Experience-New-S9-safe",
      },
      bootstrap.data.access_token,
    );
    const admin = (
      await call("POST", "/api/v1/auth/login", {
        username: "admin",
        password: "Experience-New-S9-safe",
        client_type: "linux",
      })
    ).data.access_token;
    const user = (
      await call(
        "POST",
        "/api/v1/admin/users",
        {
          username: "lin",
          display_name: "Experience fixture",
          role: "user",
          bandwidth_limit_bps: 50_000_000,
        },
        admin,
      )
    ).data;
    const first = await call("POST", "/api/v1/auth/login", {
      username: "lin",
      password: user.temporary_password,
      client_type: "linux",
    });
    await call(
      "POST",
      "/api/v1/auth/password/change",
      { current_password: user.temporary_password, new_password: "Private-Experience-S9-safe" },
      first.data.access_token,
    );
    const token = (
      await call("POST", "/api/v1/auth/login", {
        username: "lin",
        password: "Private-Experience-S9-safe",
        client_type: "linux",
      })
    ).data.access_token;
    const device = (
      await call(
        "POST",
        "/api/v1/devices/register",
        {
          name: "Fixture device",
          install_id: "experience-install",
          fingerprint_hash: "ab".repeat(32),
          client_version: "5.0.0",
        },
        token,
      )
    ).data;
    await call("PATCH", "/api/v1/admin/settings", { subdomain_prefix_policy: "enforce" }, admin);
    const input = {
      device_id: device.device_id,
      user_id: user.user.id,
      name: "NAS",
      subdomain: "lin-nas",
      local_scheme: "http",
      local_host: "127.0.0.1",
      local_port: 8080,
      enabled: false,
    };
    await t.test(
      "administrator checks the selected owner and rejects cross-user access",
      async () => {
        const check = await call(
          "GET",
          `/api/v1/client/subdomains/availability?name=lin-nas&user_id=${user.user.id}`,
          undefined,
          admin,
        );
        assert.equal(check.status, 200);
        assert.equal(check.data.available, true);
        const denied = await call(
          "GET",
          "/api/v1/client/subdomains/availability?name=other-app&user_id=other",
          undefined,
          token,
        );
        assert.equal(denied.status, 403);
        assert.equal(usernamePrefix("home.ops"), "home-ops-");
      },
    );
    const connection = await call("POST", "/api/v1/admin/connections", input, admin);
    assert.equal(connection.status, 201);
    await t.test("editing a domain excludes only its authorized connection", async () => {
      const check = await call(
        "GET",
        `/api/v1/client/subdomains/availability?name=lin-nas&connection_id=${connection.data.id}`,
        undefined,
        token,
      );
      assert.equal(check.data.available, true);
      const occupied = await call(
        "GET",
        "/api/v1/client/subdomains/availability?name=lin-nas",
        undefined,
        token,
      );
      assert.equal(occupied.data.available, false);
    });
    await t.test(
      "quota-only patch preserves bandwidth and account exposes its own limits",
      async () => {
        const userRow = (
          await call("GET", "/api/v1/admin/users", undefined, admin)
        ).data.items.find((u: { id: string }) => u.id === user.user.id);
        const update = await call(
          "PATCH",
          `/api/v1/admin/traffic-policies/user/${user.user.id}`,
          { monthly_quota_bytes: 1024 ** 3 },
          admin,
          userRow.policy_version,
        );
        assert.equal(update.status, 200);
        assert.equal(update.data.bandwidth_limit_bps, 50_000_000);
        const me = await call("GET", "/api/v1/auth/me", undefined, token);
        assert.equal(me.data.monthly_quota_bytes, 1024 ** 3);
        assert.equal(me.data.bandwidth_limit_bps, 50_000_000);
        assert.ok(me.data.quota_resets_at);
      },
    );
    await t.test("251 connections remain discoverable through complete pagination", async () => {
      for (let i = 0; i < 250; i++) {
        const created = await call(
          "POST",
          "/api/v1/admin/connections",
          { ...input, name: `Service ${i}`, subdomain: `lin-service-${i}` },
          admin,
        );
        assert.equal(created.status, 201);
      }
      const ids = new Set();
      for (let page = 1; page <= 3; page++) {
        const result = await call(
          "GET",
          `/api/v1/admin/connections?page=${page}&page_size=100`,
          undefined,
          admin,
        );
        assert.equal(result.data.total, 251);
        assert.equal(result.data.total_pages, 3);
        for (const item of result.data.items) ids.add(item.id);
      }
      assert.equal(ids.size, 251);
      const search = await call(
        "GET",
        "/api/v1/admin/connections?search=lin-nas",
        undefined,
        admin,
      );
      assert.equal(search.data.total, 1);
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeDatabase();
  }
});
