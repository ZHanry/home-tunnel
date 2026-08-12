import assert from "node:assert/strict";
import test from "node:test";
import type { AlertEvent } from "./notifications.js";

process.env.NODE_ENV = "test";
process.env.SQLITE_PATH = ":memory:";
process.env.INTERNAL_SERVICE_KEY ??= "11".repeat(32);
process.env.FRPS_PLUGIN_KEY ??= "22".repeat(32);
process.env.LEASE_SIGNING_KEY ??= "33".repeat(32);

const { AlertDispatcher } = await import("./notifications.js");

const sampleEvent: AlertEvent = {
  event_type: "quota.suspended",
  severity: "critical",
  title: "配额超限",
  message: "用户已超出月度配额",
  subject_id: "user-1:2026-08",
  details: { user_id: "user-1" },
};

test("webhook and telegram payloads are formatted per channel", async () => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetchImplementation = async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
    return { ok: true, status: 200 };
  };
  const dispatcher = new AlertDispatcher(
    [
      { kind: "webhook", url: "https://hook.example.test/alert" },
      { kind: "telegram", botToken: "TOKEN", chatId: "CHAT" },
    ],
    { fetchImplementation },
  );
  const outcome = await dispatcher.send(sampleEvent);
  assert.equal(outcome.delivered, true);
  assert.equal(outcome.deduplicated, false);
  assert.equal(outcome.results.length, 2);
  const webhook = calls.find((entry) => entry.url.includes("hook.example.test"));
  assert.ok(webhook);
  assert.equal(webhook.body.event_type, "quota.suspended");
  assert.equal(webhook.body.severity, "critical");
  assert.equal(typeof webhook.body.at, "string");
  const telegram = calls.find((entry) => entry.url.includes("api.telegram.org"));
  assert.ok(telegram);
  assert.match(telegram.url, /\/botTOKEN\/sendMessage$/);
  assert.equal(telegram.body.chat_id, "CHAT");
  assert.match(String(telegram.body.text), /\[critical\]/);
  assert.equal(dispatcher.deliveryCounts().webhook.ok, 1);
  assert.equal(dispatcher.deliveryCounts().telegram.ok, 1);
});

test("delivery failures retry once, count errors, and never throw", async () => {
  let attempts = 0;
  const fetchImplementation = async () => {
    attempts += 1;
    throw new Error("network down");
  };
  const dispatcher = new AlertDispatcher(
    [{ kind: "webhook", url: "https://hook.example.test/x" }],
    { fetchImplementation },
  );
  const outcome = await dispatcher.send(sampleEvent);
  assert.equal(outcome.delivered, false);
  assert.equal(outcome.results[0]?.ok, false);
  assert.equal(attempts, 2);
  assert.equal(dispatcher.deliveryCounts().webhook.error, 1);
});

test("non-2xx responses are treated as failures", async () => {
  const dispatcher = new AlertDispatcher(
    [{ kind: "webhook", url: "https://hook.example.test/x" }],
    { fetchImplementation: async () => ({ ok: false, status: 500 }) },
  );
  const outcome = await dispatcher.send(sampleEvent);
  assert.equal(outcome.delivered, false);
  assert.match(outcome.results[0]?.error ?? "", /HTTP 500/);
});

test("duplicate events within the window are suppressed, distinct subjects are not", async () => {
  let calls = 0;
  const dispatcher = new AlertDispatcher(
    [{ kind: "webhook", url: "https://hook.example.test/x" }],
    {
      fetchImplementation: async () => {
        calls += 1;
        return { ok: true, status: 200 };
      },
      deduplicationWindowMs: 10_000,
    },
  );
  const first = await dispatcher.send(sampleEvent);
  const second = await dispatcher.send(sampleEvent);
  assert.equal(first.deduplicated, false);
  assert.equal(second.deduplicated, true);
  assert.equal(calls, 1);
  const other = await dispatcher.send({ ...sampleEvent, subject_id: "user-2:2026-08" });
  assert.equal(other.deduplicated, false);
  assert.equal(calls, 2);
});

test("no configured channels delivers nothing", async () => {
  const dispatcher = new AlertDispatcher([]);
  const outcome = await dispatcher.send(sampleEvent);
  assert.equal(outcome.delivered, false);
  assert.equal(outcome.results.length, 0);
  assert.deepEqual(dispatcher.configuredChannels(), { webhook: false, telegram: false });
});
