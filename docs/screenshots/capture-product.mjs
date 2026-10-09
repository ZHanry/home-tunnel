/** Capture the released Web UI, using the server's local example-data preview. */
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const sourceSha = "a85acca9335fa977c01e3ac25e3f99169a4f3649";
const server = resolve(process.argv[2] || "../home-tunnel-server");
const out = resolve(process.argv[3] || "product-captures-13");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const port = Number(process.env.UI_PREVIEW_PORT || 4175);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid preview port");
const git = (...args) => execFileSync("git", ["-C", server, ...args], { encoding: "utf8" }).trim();
if (git("rev-parse", "HEAD") !== sourceSha)
  throw new Error(`Use the v13.0.0 server source ${sourceSha}`);
if (
  git(
    "status",
    "--porcelain",
    "--",
    "control-center/public",
    "control-center/scripts/ui-preview.mjs",
  )
) {
  throw new Error("The UI and preview fixture must be unmodified");
}
const controlCenter = join(server, "control-center");
const require = createRequire(join(controlCenter, "package.json"));
const { chromium, expect } = require("@playwright/test");
const base = `http://127.0.0.1:${port}`;
let logs = "";
const preview = spawn(process.execPath, ["scripts/ui-preview.mjs"], {
  cwd: controlCenter,
  env: { ...process.env, UI_PREVIEW_PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
preview.stdout.on("data", (chunk) => {
  logs += chunk;
});
preview.stderr.on("data", (chunk) => {
  logs += chunk;
});
let browser;
try {
  await new Promise((accept, reject) => {
    const deadline = setTimeout(() => {
      clearInterval(poll);
      reject(new Error(`Preview failed to start: ${logs}`));
    }, 10000);
    const poll = setInterval(() => {
      if (logs.includes(`nestlink UI preview: ${base}`)) {
        clearTimeout(deadline);
        clearInterval(poll);
        accept();
      } else if (preview.exitCode !== null) {
        clearTimeout(deadline);
        clearInterval(poll);
        reject(new Error(logs));
      }
    }, 100);
    preview.once("error", (error) => {
      clearTimeout(deadline);
      clearInterval(poll);
      reject(error);
    });
  });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROME_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROME_EXECUTABLE }
      : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    locale: "zh-CN",
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  // These two missing preview endpoints supply an empty remote device list only.
  // No host, connected-session state, stream, or successful remote operation is fabricated.
  await context.route("**/api/v1/public/capabilities", (route) =>
    route.fulfill({ json: { remote_desktop: { enabled: true, stun_urls: [] } } }),
  );
  await context.route("**/api/v1/rd/endpoints?**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mkdir(out, { recursive: true });
  const captures = [];
  const ready = async (hash) => {
    await page.goto(`${base}/admin#${hash}`);
    await expect(page.locator("#app-shell")).toBeVisible();
    await expect(page.locator("#view-content")).toHaveAttribute("aria-busy", "false");
  };
  const capture = async (file, description) => {
    if (errors.length) throw new Error(`Page errors: ${errors.join("; ")}`);
    await expect(page.locator("#version-button")).toContainText("13.0.0");
    await expect(page.locator(".toast")).toHaveCount(0);
    await page.screenshot({ path: join(out, file), fullPage: true, animations: "disabled" });
    const bytes = await readFile(join(out, file));
    if (bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a")
      throw new Error(`Not a PNG: ${file}`);
    captures.push({
      file,
      description,
      sha256: digest(bytes),
      bytes: bytes.length,
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
    });
  };
  await ready("dashboard");
  await expect(page.locator(".overview-metric")).toHaveCount(4);
  await capture("admin-console.png", "13.0.0 Web console; first-party local preview example data");
  await ready("connections");
  await page.locator('[data-action="create-connection"]').click();
  await expect(page.locator("#modal-title")).toHaveText("发布内网服务");
  await page.locator("#modal-client-preset").selectOption("home-assistant");
  await page.locator("#modal-name").fill("Home Assistant 示例");
  await capture(
    "tunnel-wizard.png",
    "13.0.0 Web publishing wizard; device and template step; example data; nothing published",
  );
  await page.locator("#modal button[type=submit]").click();
  await expect(page.locator("#modal-local_port")).toHaveValue("8123");
  await page.locator("#modal-close").click();
  await ready("remote");
  await expect(page.locator(".remote-device-grid .remote-device")).toHaveCount(1);
  await capture(
    "remote-entry.png",
    "13.0.0 Web remote directory; example device fixture; no actual host or remote session",
  );
  await writeFile(
    join(out, "manifest.json"),
    JSON.stringify(
      {
        schema_version: 1,
        product_version: "13.0.0",
        source_repository: "https://github.com/ZHanry/home-tunnel-server",
        source_sha: sourceSha,
        source_tag: "v13.0.0",
        fixture_sha256: digest(await readFile(join(controlCenter, "scripts/ui-preview.mjs"))),
        lockfile_sha256: digest(await readFile(join(controlCenter, "pnpm-lock.yaml"))),
        capture_script_sha256: digest(await readFile(fileURLToPath(import.meta.url))),
        captured_at: new Date().toISOString(),
        browser: await browser.version(),
        viewport: [1440, 960],
        full_page: true,
        locale: "zh-CN",
        fixture:
          "Unmodified control-center/scripts/ui-preview.mjs plus an enabled remote capability and empty remote endpoint list",
        actual_product_ui: true,
        capture_kind: "web-ui",
        fixture_data: true,
        installed_application: false,
        synthetic_data: true,
        ui_source_modified: false,
        remote_session_verified: false,
        windows_capture: false,
        capture_status: "captured-awaiting-visual-review",
        ci:
          process.env.GITHUB_ACTIONS === "true"
            ? {
                repository: process.env.GITHUB_REPOSITORY,
                run_id: process.env.GITHUB_RUN_ID,
                run_attempt: process.env.GITHUB_RUN_ATTEMPT,
                workflow_sha: process.env.GITHUB_SHA,
              }
            : null,
        captures,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `Captured ${captures.length} actual Web UI screenshots in ${out}. Inspect every image before publication.`,
  );
} finally {
  try {
    await browser?.close();
  } finally {
    preview.kill("SIGTERM");
  }
}
