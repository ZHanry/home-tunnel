import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

process.env.INTERNAL_SERVICE_KEY ??= "11".repeat(32);

const { reservedSubdomains } = await import("./policy.js");

const contract = JSON.parse(
  readFileSync(new URL("../../contracts/home-tunnel.v1.json", import.meta.url), "utf8"),
) as { reserved_subdomains: string[] };

test("shared reserved-subdomain contract matches the traffic gateway", () => {
  assert.deepEqual([...reservedSubdomains].sort(), [...contract.reserved_subdomains].sort());
});
