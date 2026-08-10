process.env.NODE_ENV = "development";
process.env.PGPASSWORD ??= "local-preview-only";
process.env.INTERNAL_SERVICE_KEY ??= "11".repeat(32);
process.env.FRPS_PLUGIN_KEY ??= "22".repeat(32);
process.env.LEASE_SIGNING_KEY ??= "33".repeat(32);
process.env.COOKIE_SECURE = "false";

const port = Number.parseInt(process.env.PREVIEW_PORT ?? "4173", 10);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("PREVIEW_PORT is invalid");

const [{ createApplication }, { closeDatabase }] = await Promise.all([
  import("../dist/server.js"),
  import("../dist/db.js"),
]);
const app = await createApplication(false);
const server = app.listen(port, "127.0.0.1", () => {
  console.log(`Home Tunnel preview: http://127.0.0.1:${port}`);
});

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await new Promise((resolve) => server.close(resolve));
  await closeDatabase();
}

process.on("SIGINT", () => void stop().then(() => process.exit(0)));
process.on("SIGTERM", () => void stop().then(() => process.exit(0)));
