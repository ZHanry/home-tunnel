import assert from "node:assert/strict";
import test from "node:test";

process.env.INTERNAL_SERVICE_KEY = "11".repeat(32);
process.env.SAMPLE_BUCKET_SECONDS = "10";
process.env.MAX_BODY_CHUNK_BYTES = String(64 * 1024);

const { HierarchicalLimiter, PolicyStore, SampleCollector } = await import("./server.js");

function policy(id: string, subdomain: string, enabled = true) {
  return {
    connection_id: id,
    user_id: "user-1",
    device_id: "device-1",
    subdomain,
    enabled,
    device_lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
    connection_version: 1,
    connection_limit_bps: null,
    connection_burst_bytes: null,
    connection_policy_version: 1,
    user_limit_bps: 8 * 1024 * 1024,
    user_burst_bytes: null,
    user_policy_version: 1,
  };
}

function snapshot(connections: ReturnType<typeof policy>[], expiresInMs = 60_000) {
  return {
    revision: 1,
    generated_at: new Date().toISOString(),
    snapshot_expires_at: new Date(Date.now() + expiresInMs).toISOString(),
    tunnel_domain: "tunnel.example.com",
    connections,
  };
}

test("host authorization accepts one managed label and rejects unsafe hosts", () => {
  const store = new PolicyStore();
  store.apply(snapshot([policy("connection-1", "service")]))
  assert.equal(store.host("service.tunnel.example.com").policy?.connection_id, "connection-1");
  assert.equal(store.host("SERVICE.tunnel.example.com:443").policy?.connection_id, "connection-1");
  assert.equal(store.host("service.other.example").error, "invalid");
  assert.equal(store.host("two.labels.tunnel.example.com").error, "invalid");
  assert.equal(store.host("console.tunnel.example.com").error, "reserved");
  assert.equal(store.host("missing.tunnel.example.com").error, "not_found");
  assert.equal(store.host("service.tunnel.example.com,evil.example").error, "invalid");
});

test("policy disable, version change, and snapshot expiry close active streams", async () => {
  const store = new PolicyStore();
  const original = policy("connection-1", "service");
  store.apply(snapshot([original]));
  let closes = 0;
  store.register(original.connection_id, () => closes++);
  store.apply(snapshot([{ ...original, enabled: false }]));
  assert.equal(closes, 1);

  store.apply(snapshot([original]));
  store.register(original.connection_id, () => closes++);
  store.apply(snapshot([{ ...original, connection_version: 2 }]));
  assert.equal(closes, 2);

  store.apply(snapshot([original], 30));
  store.register(original.connection_id, () => closes++);
  await new Promise((resolve) => setTimeout(resolve, 45));
  assert.equal(store.enforceExpiry(), true);
  assert.equal(closes, 3);
  assert.equal(store.connection(original.connection_id), undefined);
});

test("lease expiry closes active streams and unchanged responses refresh only snapshot freshness", async () => {
  const store = new PolicyStore();
  const original = { ...policy("connection-1", "service"), device_lease_expires_at: new Date(Date.now() + 30).toISOString() };
  store.apply(snapshot([original]));
  const fullSuccess = store.lastFullSuccessAt;
  store.touch(new Date(Date.now() + 120_000).toISOString());
  assert.equal(store.lastFullSuccessAt, fullSuccess);
  let closes = 0;
  store.register(original.connection_id, () => closes++);
  await new Promise((resolve) => setTimeout(resolve, 45));
  assert.equal(store.enforceExpiry(), true);
  assert.equal(closes, 1);
});

test("one user bucket is shared by concurrent connections and applies backpressure", async () => {
  const store = new PolicyStore();
  const first = policy("connection-1", "first");
  const second = policy("connection-2", "second");
  store.apply(snapshot([first, second]));
  const limiter = new HierarchicalLimiter(store);
  const signal = new AbortController().signal;
  await limiter.acquire(first.connection_id, 1024 * 1024, signal);
  const started = performance.now();
  await limiter.acquire(second.connection_id, 64 * 1024, signal);
  const elapsed = performance.now() - started;
  assert.ok(elapsed >= 35, `expected shared-bucket wait, observed ${elapsed.toFixed(1)}ms`);
  assert.ok(elapsed < 1500);
});

test("sample retries send cumulative bucket totals without double counting", async () => {
  let now = 1000;
  const uploads: Array<Array<Record<string, unknown>>> = [];
  const collector = new SampleCollector(
    () => now,
    async (items) => {
      uploads.push(items.map((item) => ({ ...item })));
    },
  );
  const current = policy("connection-1", "service");
  collector.record(current, "upload", 100);
  collector.request(current);
  await collector.flush();
  now = 2000;
  collector.record(current, "upload", 50);
  collector.record(current, "download", 25);
  collector.error(current);
  now = 10_001;
  await collector.flush();
  await collector.flush();
  assert.equal(uploads.length, 2);
  assert.equal(uploads[0]?.[0]?.upload_bytes, 100);
  assert.equal(uploads[1]?.[0]?.upload_bytes, 150);
  assert.equal(uploads[1]?.[0]?.download_bytes, 25);
  assert.equal(uploads[1]?.[0]?.request_count, 1);
  assert.equal(uploads[1]?.[0]?.error_count, 1);
});

test("sample identity changes replace a stale bucket instead of poisoning its batch", async () => {
  let now = 1000;
  const uploads: Array<Array<Record<string, unknown>>> = [];
  const collector = new SampleCollector(
    () => now,
    async (items) => {
      uploads.push(items.map((item) => ({ ...item })));
    },
  );
  const original = policy("connection-1", "service");
  collector.record(original, "upload", 100);
  collector.record({ ...original, user_id: "user-2", device_id: "device-2" }, "upload", 50);
  now = 10_001;
  await collector.flush();
  assert.equal(uploads[0]?.[0]?.user_id, "user-2");
  assert.equal(uploads[0]?.[0]?.device_id, "device-2");
  assert.equal(uploads[0]?.[0]?.upload_bytes, 50);
});
