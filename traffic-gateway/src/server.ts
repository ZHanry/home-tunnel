import { pathToFileURL } from "node:url";
import { accessStats } from "./access-control.js";
import { log } from "./observability.js";
import {
  cidrContains,
  parseCidr,
  parseIpBytes,
  policies,
  PolicyStore,
  syncPolicies,
} from "./policy.js";
import { HierarchicalLimiter, ThrottleTransform } from "./rate-limit.js";
import { SampleCollector, samples } from "./sampling.js";
import { createGatewayServer, main } from "./server-lifecycle.js";

// Stable compatibility facade for existing imports and tests. Implementations
// live in concern-specific modules; the public API remains unchanged.
export {
  accessStats,
  cidrContains,
  createGatewayServer,
  HierarchicalLimiter,
  parseCidr,
  parseIpBytes,
  policies,
  PolicyStore,
  SampleCollector,
  samples,
  syncPolicies,
  ThrottleTransform,
};

const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;
if (isDirectRun) {
  void main().catch((error) => {
    log(
      "fatal",
      "STARTUP_FAILED",
      error instanceof Error ? error.message : "Unknown startup error",
    );
    process.exit(1);
  });
}
