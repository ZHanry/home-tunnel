import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
process.env.NODE_ENV = "test";
process.env.SQLITE_PATH = ":memory:";
process.env.INTERNAL_SERVICE_KEY ??= "11".repeat(32);
process.env.FRPS_PLUGIN_KEY ??= "22".repeat(32);
process.env.LEASE_SIGNING_KEY ??= "33".repeat(32);
process.env.COOKIE_SECURE = "false";

const { reservedSubdomains } = await import("./security.js");
const { publicConnection, publicHostPort } = await import("./domain.js");

type Contract = {
  reserved_subdomains: string[];
  rest: {
    auth: { client_types: string[] };
    client_sync: {
      path: string;
      request_fields: string[];
      response_fields: string[];
      connection_fields: string[];
    };
  };
  websocket: {
    path: string;
    events: string[];
    realtime_connected_fields: string[];
    envelope_fields: string[];
  };
};

const contract = JSON.parse(
  readFileSync(new URL("../../contracts/home-tunnel.v1.json", import.meta.url), "utf8"),
) as Contract;

function exactKeys(value: Record<string, unknown>, expected: string[]): void {
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
}

test("shared reserved-subdomain contract matches the control center", () => {
  assert.deepEqual([...reservedSubdomains].sort(), [...contract.reserved_subdomains].sort());
});

test("raw public endpoints format DNS, IPv4, and IPv6 authorities", () => {
  assert.equal(publicHostPort("frps.example.com", 10001), "frps.example.com:10001");
  assert.equal(publicHostPort("203.0.113.10", 10001), "203.0.113.10:10001");
  assert.equal(publicHostPort("2001:db8::10", 10001), "[2001:db8::10]:10001");
  assert.equal(publicHostPort("[2001:db8::10]", 10001), "[2001:db8::10]:10001");
});

test("REST and WebSocket compatibility contract preserves the v1 surface", () => {
  assert.deepEqual(contract.rest.auth.client_types, [
    "web",
    "windows",
    "linux",
    "macos",
    "android",
    "mobile",
  ]);
  assert.equal(contract.rest.client_sync.path, "/api/v1/client/sync");
  assert.deepEqual(contract.rest.client_sync.request_fields, [
    "device_id",
    "last_config_version",
    "supports_optional_lease",
    "lease_expires_at",
    "supported_proxy_types",
  ]);
  assert.deepEqual(contract.rest.client_sync.response_fields, [
    "device_id",
    "full_sync",
    "from_config_version",
    "target_config_version",
    "connections",
    "content_hash",
    "lease",
    "server_time",
  ]);
  const representativeConnection = JSON.parse(
    JSON.stringify({
      ...publicConnection({
        id: "22222222-2222-4222-8222-222222222222",
        user_id: "33333333-3333-4333-8333-333333333333",
        device_id: "11111111-1111-4111-8111-111111111111",
        name: "Home service",
        subdomain: "home",
        local_scheme: "http",
        local_host: "127.0.0.1",
        local_port: 8080,
        transport_type: "http",
        remote_port: null,
        enabled: true,
        version: 7,
        deleted_at: null,
        created_at: new Date("2026-08-13T00:00:00.000Z"),
        updated_at: new Date("2026-08-13T00:00:00.000Z"),
      }),
      proxy_name: "ht_22222222222242228222222222222222_v7",
    }),
  ) as Record<string, unknown>;
  exactKeys(representativeConnection, contract.rest.client_sync.connection_fields);
  assert.ok(!contract.rest.client_sync.connection_fields.includes("username"));
  assert.ok(!contract.rest.client_sync.connection_fields.includes("device_name"));
  assert.equal(contract.websocket.path, "/api/v1/ws");
  for (const event of [
    "realtime.connected",
    "config.version.changed",
    "connection.command",
    "subject.revoked",
  ]) {
    assert.ok(contract.websocket.events.includes(event));
  }
  assert.deepEqual(contract.websocket.envelope_fields, [
    "event",
    "resource_type",
    "resource_id",
    "resource_version",
    "payload",
    "at",
  ]);
  const representativeConnectedEvent = {
    event: "realtime.connected",
    at: "2026-08-13T00:00:00.000Z",
  };
  exactKeys(representativeConnectedEvent, contract.websocket.realtime_connected_fields);
  const representativeRequest = {
    device_id: "11111111-1111-4111-8111-111111111111",
    last_config_version: 7,
    supports_optional_lease: true,
    lease_expires_at: null,
    supported_proxy_types: ["http", "tcp", "udp"],
  };
  exactKeys(representativeRequest, contract.rest.client_sync.request_fields);
  const representativeResponse = {
    device_id: representativeRequest.device_id,
    full_sync: false,
    from_config_version: 7,
    target_config_version: 7,
    connections: [],
    content_hash: "sha256",
    lease: null,
    server_time: "2026-08-13T00:00:00.000Z",
  };
  exactKeys(representativeResponse, contract.rest.client_sync.response_fields);
  const representativeEvent = {
    event: "config.version.changed",
    resource_type: "Device",
    resource_id: representativeRequest.device_id,
    resource_version: 7,
    payload: { device_id: representativeRequest.device_id },
    at: "2026-08-13T00:00:00.000Z",
  };
  exactKeys(representativeEvent, contract.websocket.envelope_fields);
});
