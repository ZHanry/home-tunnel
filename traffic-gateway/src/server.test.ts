import assert from "node:assert/strict";
import test from "node:test";

process.env.INTERNAL_SERVICE_KEY = "11".repeat(32);
process.env.SAMPLE_BUCKET_SECONDS = "10";
process.env.MAX_BODY_CHUNK_BYTES = String(64 * 1024);

const { HierarchicalLimiter, PolicyStore, SampleCollector, ThrottleTransform } = await import("./server.js");

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
    user_limit_bps: (8 * 1024 * 1024) as number | null,
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

test("sample buffer drops oldest buckets when the cap is exceeded", async () => {
  let now = 1000;
  let fail = true;
  const uploads: Array<Array<Record<string, unknown>>> = [];
  const collector = new SampleCollector(
    () => now,
    async (items) => {
      if (fail) throw new Error("control center down");
      uploads.push(items.map((item) => ({ ...item })));
    },
    3,
  );
  const first = policy("connection-1", "first");
  const second = policy("connection-2", "second");
  collector.record(first, "upload", 1);
  collector.record(second, "upload", 1);
  await collector.flush();
  now = 11_000;
  collector.record(first, "upload", 2);
  now = 21_000;
  collector.record(first, "upload", 3);
  fail = false;
  now = 31_000;
  await collector.flush();
  assert.equal(uploads.length, 1);
  const batch = uploads[0] ?? [];
  assert.equal(batch.length, 2);
  assert.deepEqual(batch.map((item) => item.upload_bytes), [2, 3]);
  assert.ok(!batch.some((item) => item.connection_id === "connection-2"));
});

test("sample buffer never evicts the current bucket", async () => {
  const now = 1000;
  let fail = true;
  const uploads: Array<Array<Record<string, unknown>>> = [];
  const collector = new SampleCollector(
    () => now,
    async (items) => {
      if (fail) throw new Error("control center down");
      uploads.push(items.map((item) => ({ ...item })));
    },
    1,
  );
  collector.record(policy("connection-1", "first"), "upload", 1);
  collector.record(policy("connection-2", "second"), "upload", 2);
  fail = false;
  await collector.flush();
  assert.equal(uploads[0]?.length, 2);
});

test("unlimited connections take the synchronous fast path and skip the limiter", async () => {
  const store = new PolicyStore();
  const unlimited = { ...policy("connection-1", "service"), user_limit_bps: null, connection_limit_bps: null };
  const limited = policy("connection-2", "second");
  store.apply(snapshot([unlimited, limited]));
  const limiter = new HierarchicalLimiter(store);
  let acquireCalls = 0;
  const originalAcquire = limiter.acquire.bind(limiter);
  limiter.acquire = async (connectionId, requestedBytes, signal) => {
    acquireCalls += 1;
    return originalAcquire(connectionId, requestedBytes, signal);
  };
  let now = 1000;
  const uploads: Array<Array<Record<string, unknown>>> = [];
  const collector = new SampleCollector(
    () => now,
    async (items) => {
      uploads.push(items.map((item) => ({ ...item })));
    },
  );
  const fast = new ThrottleTransform("connection-1", "download", new AbortController(), store, limiter, collector);
  const received = new Promise<Buffer>((resolve) => fast.once("data", resolve));
  fast.write(Buffer.from("hello"));
  assert.equal((await received).toString(), "hello");
  assert.equal(acquireCalls, 0);
  now = 11_000;
  await collector.flush();
  assert.equal(uploads[0]?.[0]?.download_bytes, 5);

  const slow = new ThrottleTransform("connection-2", "download", new AbortController(), store, limiter, collector);
  const slowReceived = new Promise<Buffer>((resolve) => slow.once("data", resolve));
  slow.write(Buffer.from("world"));
  await slowReceived;
  assert.equal(acquireCalls, 1);
});

test("the fast path still enforces policy revocation", async () => {
  const store = new PolicyStore();
  const unlimited = { ...policy("connection-1", "service"), user_limit_bps: null, connection_limit_bps: null };
  store.apply(snapshot([unlimited]));
  const transform = new ThrottleTransform("connection-1", "download", new AbortController(), store, new HierarchicalLimiter(store), new SampleCollector(() => 1000, async () => undefined));
  transform.resume();
  store.apply(snapshot([{ ...unlimited, enabled: false }]));
  const failure = new Promise<Error>((resolve) => transform.once("error", resolve));
  transform.write(Buffer.from("blocked"));
  assert.equal((await failure).message, "POLICY_REVOKED");
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
