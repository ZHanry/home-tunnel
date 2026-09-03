import assert from "node:assert/strict";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.SQLITE_PATH = ":memory:";
process.env.INTERNAL_SERVICE_KEY ??= "11".repeat(32);
process.env.FRPS_PLUGIN_KEY ??= "22".repeat(32);
process.env.LEASE_SIGNING_KEY ??= "33".repeat(32);
process.env.COOKIE_SECURE = "false";

const { suggestedSubdomain, suggestionCandidates, usernamePrefix, parsePrefixPolicy } =
  await import("./subdomain-policy.js");

test("suggested subdomains prefix the account username", () => {
  assert.equal(usernamePrefix("Alice"), "alice-");
  assert.equal(suggestedSubdomain("家庭 NAS", "bob"), "bob-nas");
  assert.equal(suggestedSubdomain("Home Assistant", "bob"), "bob-home-assistant");
});

test("conflict suggestions stay unique and valid", () => {
  const suggestions = suggestionCandidates("nas", "bob");
  assert.ok(suggestions.includes("bob-nas"));
  assert.ok(suggestions.includes("nas-2"));
  assert.equal(new Set(suggestions).size, suggestions.length);
});

test("prefix policy parser falls back to the deployment default", () => {
  assert.equal(parsePrefixPolicy("enforce"), "enforce");
  assert.equal(parsePrefixPolicy("off"), "off");
  assert.equal(parsePrefixPolicy("nope"), "suggest");
});
