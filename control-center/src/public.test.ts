import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

function request(
  url: string,
  headers: Record<string, string> = {},
): Promise<{
  status: number;
  headers: import("node:http").IncomingHttpHeaders;
  body: Buffer;
}> {
  return new Promise((resolvePromise, rejectPromise) => {
    const outgoing = get(url, { headers: { connection: "close", ...headers } }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () =>
        resolvePromise({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks),
        }),
      );
    });
    outgoing.on("error", rejectPromise);
  });
}

test("public landing page stays available while Windows release metadata is absent", async () => {
  const downloads = await mkdtemp(join(tmpdir(), "home-tunnel-public-test-"));

  const frpsCertificatePem =
    "-----BEGIN CERTIFICATE-----\ntest-only-frps-certificate\n-----END CERTIFICATE-----\n";
  const frpsCertificatePath = join(downloads, "frps_tls_cert.pem");
  await writeFile(frpsCertificatePath, frpsCertificatePem);

  process.env.NODE_ENV = "test";
  process.env.DOWNLOADS_DIRECTORY = downloads;
  process.env.SQLITE_PATH = ":memory:";
  process.env.INTERNAL_SERVICE_KEY ??= "11".repeat(32);
  process.env.FRPS_PLUGIN_KEY ??= "22".repeat(32);
  process.env.LEASE_SIGNING_KEY ??= "33".repeat(32);
  process.env.COOKIE_SECURE = "false";
  // config.ts 在模块加载时求值，必须在 import server.js 之前设置。
  process.env.FRPS_TLS_CERT_FILE = frpsCertificatePath;

  const [{ createApplication }, { closeDatabase }] = await Promise.all([
    import("./server.js"),
    import("./db.js"),
  ]);
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
    assert.match(landing.body.toString("utf8"), /Linux \/ macOS 无界面服务/);
    assert.match(
      landing.body.toString("utf8"),
      /Windows EXE 为自签名 Experimental；安装时会提示未知发布者/,
    );
    assert.match(
      landing.body.toString("utf8"),
      /id="hero-download"[^>]*HomeTunnel-Setup-3\.2\.0-x64\.exe/,
    );
    assert.match(landing.body.toString("utf8"), /home-tunnel-client status/);
    assert.match(landing.body.toString("utf8"), /app\.js\?v=3\.2\.0-modules1/);
    assert.match(landing.body.toString("utf8"), /type="module"/);
    assert.match(landing.body.toString("utf8"), /v2\.css\?v=3\.2\.0-ui5/);
    assert.match(landing.body.toString("utf8"), /theme\.js\?v=3\.2\.0-locale/);
    assert.match(landing.body.toString("utf8"), /data-locale-toggle/);
    assert.doesNotMatch(landing.body.toString("utf8"), /实时同步正常|系统健康|受管请求路径/);
    assert.match(landing.body.toString("utf8"), /id="page-actions"/);
    assert.match(
      landing.body.toString("utf8"),
      /href="https:\/\/github\.com\/ZHanry\/home-tunnel"[\s\S]*?GitHub 仓库/,
    );

    const publicConfig = await request(origin + "/api/v1/public/config");
    assert.equal(publicConfig.status, 200);
    const publicConfigValue = JSON.parse(publicConfig.body.toString("utf8")) as Record<
      string,
      unknown
    >;
    assert.equal(publicConfigValue.tunnel_domain, "tunnel.example.com");
    assert.equal(publicConfigValue.public_base_url, "https://console.tunnel.example.com");
    assert.equal(publicConfigValue.frps_host, "203.0.113.10");
    assert.equal(publicConfigValue.frps_port, 7000);
    assert.equal(publicConfigValue.frps_tls_certificate_pem, frpsCertificatePem);

    const stylesheet = await request(origin + "/v2.css?v=3.2.0-ui5");
    assert.equal(stylesheet.status, 200);
    assert.equal(stylesheet.headers["cache-control"], "public, max-age=31536000, immutable");

    const themeScript = await request(origin + "/theme.js?v=3.2.0-locale");
    assert.equal(themeScript.status, 200);
    assert.match(themeScript.body.toString("utf8"), /ht_locale/);

    const applicationScript = await request(origin + "/app.js?v=3.2.0-modules1");
    assert.equal(applicationScript.status, 200);
    assert.match(
      applicationScript.body.toString("utf8"),
      /\.\/modules\/api\.js\?v=3\.2\.0-modules1/,
    );
    assert.match(
      applicationScript.body.toString("utf8"),
      /\.\/modules\/locale\.js\?v=3\.2\.0-modules1/,
    );
    assert.match(
      applicationScript.body.toString("utf8"),
      /\.\/modules\/realtime\.js\?v=3\.2\.0-modules1/,
    );
    assert.match(applicationScript.body.toString("utf8"), /toLocaleString\(localeTag\(\)/);
    assert.equal(applicationScript.headers["cache-control"], "public, max-age=31536000, immutable");
    assert.match(applicationScript.body.toString("utf8"), /data-action="delete-device"/);
    assert.match(
      applicationScript.body.toString("utf8"),
      /凭据、会话、租约、连接和流量明细将被删除/,
    );
    assert.match(applicationScript.body.toString("utf8"), /api\/v1\/admin\/system\/health/);
    assert.match(
      applicationScript.body.toString("utf8"),
      /Windows 图形客户端或 Linux\/macOS 无界面服务/,
    );
    assert.match(applicationScript.body.toString("utf8"), /TCP（RTSP \/ SSH \/ RDP \/ 数据库等）/);
    assert.match(applicationScript.body.toString("utf8"), /UDP（固定端口）/);
    assert.doesNotMatch(applicationScript.body.toString("utf8"), /data-action="revoke-device"/);

    const localeModule = await request(origin + "/modules/locale.js?v=3.2.0-modules1");
    assert.equal(localeModule.status, 200);
    assert.match(localeModule.body.toString("utf8"), /const zhToEn =/);
    assert.match(localeModule.body.toString("utf8"), /Switch to English/);
    assert.match(localeModule.body.toString("utf8"), /function updateDocumentMetadata\(\)/);
    assert.match(
      localeModule.body.toString("utf8"),
      /Home Tunnel — Secure access to services at home/,
    );
    assert.match(localeModule.body.toString("utf8"), /record\.type === "characterData"/);
    assert.equal(localeModule.headers["cache-control"], "public, max-age=31536000, immutable");

    const realtimeModule = await request(origin + "/modules/realtime.js?v=3.2.0-modules1");
    assert.equal(realtimeModule.status, 200);
    assert.match(realtimeModule.body.toString("utf8"), /config\.version\.changed/);
    assert.match(realtimeModule.body.toString("utf8"), /export function disconnectRealtime/);

    const admin = await request(origin + "/admin");
    assert.equal(admin.status, 200);
    assert.match(admin.body.toString("utf8"), /id="auth-screen"/);

    for (const path of [
      "/api/v1/public/releases/latest",
      "/downloads/HomeTunnel-Setup-x64.exe",
      "/downloads/HomeTunnel-Setup-9.9.9-x64.exe",
    ]) {
      const unavailable = await request(origin + path, { cookie: "ht_access=revoked-session" });
      assert.equal(unavailable.status, 404);
      assert.match(unavailable.body.toString("utf8"), /RELEASE_UNAVAILABLE/);
    }
  } finally {
    server.close();
    await once(server, "close");
    await closeDatabase();
    await rm(downloads, { recursive: true, force: true });
  }
});
