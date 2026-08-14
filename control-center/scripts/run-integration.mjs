import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "home-tunnel-sqlite-integration-"));
process.env.RUN_INTEGRATION_DIRECT = "1";
process.env.SQLITE_PATH = join(directory, "home-tunnel.db");
process.env.BOOTSTRAP_ADMIN_PASSWORD ??= "Integration-Bootstrap-Q8-safe";

try {
  const { runIntegrationSuite } = await import("../dist/integration.test.js");
  await runIntegrationSuite();
  console.log("SQLITE_INTEGRATION=passed");
  process.exitCode = 0;
} catch (error) {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
