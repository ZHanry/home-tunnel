process.env.RUN_INTEGRATION_DIRECT = "1";

try {
  const { runIntegrationSuite } = await import("../dist/integration.test.js");
  await runIntegrationSuite();
  console.log("POSTGRES_INTEGRATION=passed");
  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
}
