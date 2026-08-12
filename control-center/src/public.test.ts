import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

function request(url: string, headers: Record<string, string> = {}): Promise<{
  status: number;
  headers: import("node:http").IncomingHttpHeaders;
  body: Buffer;
}> {
  return new Promise((resolvePromise, rejectPromise) => {
    const outgoing = get(url, { headers: { connection: "close", ...headers } }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => resolvePromise({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }));
    });
    outgoing.on("error", rejectPromise);
  });
}

test("public landing page and GitHub-hosted EXE redirects stay available without a session", async () => {
  const downloads = await mkdtemp(join(tmpdir(), "home-tunnel-public-test-"));
  const fileName = "HomeTunnel-Setup-2.3.0-x64.exe";
  const executableHeader = Buffer.from("MZ", "ascii");
  await writeFile(
    join(downloads, "latest.json"),
    JSON.stringify({
      version: "2.3.0",
      platform: "windows",
      architecture: "x64",
      file_name: fileName,
      size_bytes: executableHeader.length,
      sha256: createHash("sha256").update(executableHeader).digest("hex"),
      released_at: "2026-08-09T00:00:00Z",
    }),
  );

  process.env.NODE_ENV = "test";
  process.env.DOWNLOADS_DIRECTORY = downloads;
  process.env.SQLITE_PATH = ":memory:";
  process.env.INTERNAL_SERVICE_KEY ??= "11".repeat(32);
  process.env.FRPS_PLUGIN_KEY ??= "22".repeat(32);
  process.env.LEASE_SIGNING_KEY ??= "33".repeat(32);
  process.env.COOKIE_SECURE = "false";

  const [{ createApplication }, { closeDatabase }] = await Promise.all([import("./server.js"), import("./db.js")]);
  const app = await createApplication(false);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;

  try {
    const landing = await request(origin + "/", { cookie: "ht_access=revoked-session" });
    assert.equal(landing.status, 200);
    assert.equal(landing.headers["cache-control"], "no-cache");
    assert.match(landing.body.toString("utf8"), /Windows 图形客户端/);
    assert.match(landing.body.toString("utf8"), /Linux 无界面服务/);
    assert.match(landing.body.toString("utf8"), /systemctl status home-tunnel-client/);
    assert.match(landing.body.toString("utf8"), /app\.js\?v=2\.3\.0-ui3/);
    assert.match(landing.body.toString("utf8"), /v2\.css\?v=2\.3\.0-ui3/);
    assert.doesNotMatch(landing.body.toString("utf8"), /实时同步正常|系统健康|受管请求路径/);
    assert.match(landing.body.toString("utf8"), /id="page-actions"/);
    assert.match(
      landing.body.toString("utf8"),
      /href="https:\/\/github\.com\/ZHanry\/home-tunnel"[\s\S]*?GitHub 仓库/,
    );

    const publicConfig = await request(origin + "/api/v1/public/config");
    assert.equal(publicConfig.status, 200);
    const publicConfigValue = JSON.parse(publicConfig.body.toString("utf8")) as Record<string, unknown>;
    assert.equal(publicConfigValue.tunnel_domain, "tunnel.example.com");
    assert.equal(publicConfigValue.public_base_url, "https://console.tunnel.example.com");
    assert.equal(publicConfigValue.frps_host, "203.0.113.10");
    assert.equal(publicConfigValue.frps_port, 7000);

    const stylesheet = await request(origin + "/v2.css?v=2.3.0-ui3");
    assert.equal(stylesheet.status, 200);
    assert.equal(stylesheet.headers["cache-control"], "public, max-age=31536000, immutable");

    const applicationScript = await request(origin + "/app.js?v=2.3.0-ui3");
    assert.equal(applicationScript.status, 200);
    assert.equal(applicationScript.headers["cache-control"], "public, max-age=31536000, immutable");
    assert.match(applicationScript.body.toString("utf8"), /data-action="delete-device"/);
    assert.match(applicationScript.body.toString("utf8"), /凭据、会话、租约、连接和流量明细将被删除/);
    assert.match(applicationScript.body.toString("utf8"), /api\/v1\/admin\/system\/health/);
    assert.match(applicationScript.body.toString("utf8"), /Windows 图形客户端或 Linux 无界面服务/);
    assert.doesNotMatch(applicationScript.body.toString("utf8"), /data-action="revoke-device"/);

    const admin = await request(origin + "/admin");
    assert.equal(admin.status, 200);
    assert.match(admin.body.toString("utf8"), /id="auth-screen"/);

    const latest = await request(origin + "/api/v1/public/releases/latest", { cookie: "ht_access=revoked-session" });
    assert.equal(latest.status, 200);
    assert.equal(latest.headers["cache-control"], "public, max-age=5, must-revalidate");
    assert.ok(latest.headers.etag);
    const metadata = JSON.parse(latest.body.toString("utf8")) as Record<string, unknown>;
    assert.equal(metadata.file_name, fileName);
    assert.equal(metadata.download_url, `https://github.com/ZHanry/home-tunnel/releases/download/v2.3.0/${fileName}`);
    assert.equal(metadata.stable_download_url, "https://github.com/ZHanry/home-tunnel/releases/latest");
    const unchangedLatest = await request(origin + "/api/v1/public/releases/latest", { "if-none-match": latest.headers.etag! });
    assert.equal(unchangedLatest.status, 304);

    for (const path of [`/downloads/${fileName}`, "/downloads/HomeTunnel-Setup-x64.exe"]) {
      const download = await request(origin + path);
      assert.equal(download.status, 302);
      assert.equal(download.headers.location, `https://github.com/ZHanry/home-tunnel/releases/download/v2.3.0/${fileName}`);
      assert.equal(download.body.includes(executableHeader), false);
    }

    const missing = await request(origin + "/downloads/HomeTunnel-Setup-9.9.9-x64.exe");
    assert.equal(missing.status, 404);
  } finally {
    server.close();
    await once(server, "close");
    await closeDatabase();
    await rm(downloads, { recursive: true, force: true });
  }
});
