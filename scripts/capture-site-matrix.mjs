/**
 * Full-page Home Tunnel site matrix.
 * Requires Node 22+ and uses installed Edge DevTools. Does not invent screenshots.
 *
 *   node scripts/capture-site-matrix.mjs --base-url http://127.0.0.1:8766 --out <dir>
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile, rm, readFile, rename, realpath, mkdtemp } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const EDGE = process.env.HOME_TUNNEL_BROWSER || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const ROUTES = [
  { locale: "zh-CN", page: "landing", path: "/index.html", faq: true, status: true },
  { locale: "en", page: "landing", path: "/en/index.html", faq: true, status: true },
  { locale: "zh-CN", page: "privacy", path: "/privacy.html", faq: false, status: false },
  { locale: "en", page: "privacy", path: "/en/privacy.html", faq: false, status: false },
  { locale: "zh-CN", page: "preview", path: "/preview.html", faq: false, status: false },
  { locale: "en", page: "preview", path: "/en/preview.html", faq: false, status: false },
  { locale: "zh-CN", page: "downloads", path: "/downloads.html", faq: false, status: true },
  { locale: "en", page: "downloads", path: "/en/downloads.html", faq: false, status: true },
];
const THEMES = [
  { name: "light", query: "light", scheme: "light", bg: "rgb(244, 245, 240)" },
  { name: "dark", query: "dark", scheme: "dark", bg: "rgb(17, 28, 25)" },
  { name: "system-light", query: "system", scheme: "light", bg: "rgb(244, 245, 240)" },
  { name: "system-dark", query: "system", scheme: "dark", bg: "rgb(17, 28, 25)" },
];
const DESKTOP = { name: "desktop", width: 1440, height: 900, dsf: 1 };
const TABLET = { name: "tablet", width: 768, height: 1024, dsf: 1 };
const MOBILE = { name: "mobile", width: 390, height: 844, dsf: 1 };
const NARROW = { name: "narrow", width: 320, height: 720, dsf: 1 };
// Layout reflow, browser zoom and OS text scaling are different measurements.
const REFLOW_NARROW = { name: "reflow-195", width: 195, height: 720, dsf: 1 };
const REFLOW_DESKTOP = { name: "reflow-720", width: 720, height: 900, dsf: 1 };
const LANDSCAPE = { name: "landscape-mobile", width: 844, height: 390, dsf: 1 };
const MAIN = [DESKTOP, TABLET, MOBILE];
const SNIPPET = {
  "zh-CN": { ready: "稳定下载是", loading: "正在读取", error: "没有读到", offline: "离线" },
  en: { ready: "Stable downloads are", loading: "Reading the download manifest", error: "could not be read", offline: "offline" },
};

function arg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}
function has(name) { return process.argv.includes(name); }

function themeByName(name) { return THEMES.find((theme) => theme.name === name); }

function makeCase(route, viewport, theme, state, interaction, extra = {}) {
  const themeInfo = typeof theme === "string" ? themeByName(theme) : theme;
  return {
    id: `site.${route.locale}.${route.page}.${viewport.name}.${themeInfo.name}.${state}.${interaction}`,
    locale: route.locale,
    page: route.page,
    path: route.path,
    faq: route.faq,
    statusRegion: route.status,
    viewport: viewport.name,
    width: viewport.width,
    height: viewport.height,
    dsf: extra.dsf || viewport.dsf || 1,
    theme: themeInfo.name,
    themeQuery: extra.themeQuery || themeInfo.query,
    scheme: extra.scheme || themeInfo.scheme,
    expectBg: extra.expectBg || themeInfo.bg,
    state,
    interaction,
    originalFocus: extra.originalFocus || null,
  };
}

function buildCases() {
  const cases = [];
  const add = (item) => {
    if (!cases.some((existing) => existing.id === item.id)) cases.push(item);
  };
  for (const route of ROUTES) {
    for (const theme of THEMES) {
      for (const viewport of MAIN) add(makeCase(route, viewport, theme, "ready", "default"));
      if (route.status) {
        for (const viewport of [DESKTOP, MOBILE]) {
          for (const state of ["loading", "error", "offline"]) add(makeCase(route, viewport, theme, state, "default"));
        }
      }
    }
    for (const theme of [themeByName("light"), themeByName("dark")]) {
      for (const viewport of [MOBILE, TABLET]) add(makeCase(route, viewport, theme, "ready", "nav-open"));
      add(makeCase(route, NARROW, theme, "ready", "default"));
    }
    add(makeCase(route, REFLOW_NARROW, "light", "ready", "default"));
    add(makeCase(route, REFLOW_DESKTOP, "light", "ready", "default"));
    add(makeCase(route, LANDSCAPE, "light", "ready", "default"));
    add(makeCase(route, { name: "desktop-dpi2", width: 1440, height: 900, dsf: 2 }, "light", "ready", "default", { dsf: 2 }));
  }
  for (const route of ROUTES.filter((route) => route.faq)) {
    for (const theme of THEMES) {
      for (const viewport of [DESKTOP, MOBILE]) add(makeCase(route, viewport, theme, "ready", "faq-open"));
    }
  }
  for (const route of ROUTES) {
    for (const theme of THEMES) {
      for (const viewport of [DESKTOP, MOBILE]) {
        add(makeCase(route, viewport, theme, "ready", "focus-theme", { originalFocus: "theme-light" }));
        if (route.page === "downloads") {
          for (const state of ["error", "offline"]) {
            add(makeCase(route, viewport, theme, state, "focus-theme", { originalFocus: "theme-light" }));
          }
        }
      }
    }
  }
  for (const route of ROUTES.filter((route) => route.page === "landing")) {
    for (const viewport of [DESKTOP, MOBILE]) {
      add(makeCase(route, viewport, "light", "ready", "focus-skip"));
      add(makeCase(route, viewport, "dark", "ready", "focus-summary"));
    }
  }
  for (const route of ROUTES.filter((route) => route.status)) {
    add(makeCase(route, DESKTOP, "light", "ready", "focus-primary"));
    add(makeCase(route, MOBILE, "dark", "ready", "focus-primary"));
    for (const viewport of [DESKTOP, MOBILE]) {
      add(makeCase(route, viewport, "light", "ready", "online-recovery"));
    }
  }
  for (const route of ROUTES.filter((route) => route.page === "landing" || route.page === "downloads")) {
    add(makeCase(route, MOBILE, "light", "ready", "focus-nav"));
    add(makeCase(route, MOBILE, "dark", "ready", "nav-escape"));
  }
  add(makeCase(ROUTES[0], DESKTOP, "light", "ready", "theme-beats-system", { scheme: "dark", expectBg: "rgb(244, 245, 240)" }));
  add(makeCase(ROUTES[1], DESKTOP, "dark", "ready", "theme-beats-system", { scheme: "light", expectBg: "rgb(17, 28, 25)" }));
  add(makeCase(ROUTES[0], NARROW, "system-dark", "ready", "default"));
  add(makeCase(ROUTES[6], NARROW, "system-light", "ready", "default"));
  add(makeCase(ROUTES[0], REFLOW_NARROW, "dark", "ready", "default"));
  add(makeCase(ROUTES[7], REFLOW_DESKTOP, "dark", "ready", "default"));
  add(makeCase(ROUTES[0], MOBILE, "system-dark", "ready", "nav-open"));
  add(makeCase(ROUTES[7], TABLET, "system-light", "ready", "nav-open"));

  const notApplicable = [
    { area: "dialog", reason: "The site has no dialog or modal. Escape closes the disclosure navigation, which is captured as nav-escape." },
    { area: "ime", reason: "No text field is rendered, so an input method editor cannot attach." },
    { area: "role", reason: "Pages are public and have one audience. There is no signed-in role switch." },
    { area: "collapsed-nav-desktop", reason: "Above 800 CSS pixels the menu button is hidden and navigation is always visible. Narrower viewports use the disclosure menu." },
    { area: "faq-other-pages", reason: "The FAQ disclosure is only on the landing pages. Privacy, preview, and downloads link to it." },
    { area: "download-states-privacy-preview", reason: "Privacy and preview do not render #download-status. Loading, error, and offline apply to landing and downloads." },
    { area: "reduced-motion-screenshot", reason: "The site has no motion design other than smooth scrolling. Captures emulate prefers-reduced-motion: reduce and the a11y check records scroll-behavior." },
    { area: "installer-steps", reason: "This site links to published 9.0.0 files. It does not render an installer or update wizard." },
    { area: "v10-product-screenshots", reason: "assets/v10 slots stay empty until real product captures exist. They are visible inside landing and preview full pages and are not invented here." },
  ];
  const original = [];
  for (const locale of ["zh-CN", "en"]) {
    for (const page of ["landing", "privacy", "preview", "downloads"]) {
      for (const viewport of ["desktop", "mobile"]) {
        for (const theme of ["light", "dark", "system"]) {
          const states = page === "downloads" ? ["ready", "offline", "error"] : ["ready"];
          for (const state of states) {
            for (const focus of ["none", "theme-light"]) {
              const id = `${locale}-${page}-${viewport}-${theme}-${state}-focus-${focus}`;
              const themes = theme === "system" ? ["system-light", "system-dark"] : [theme];
              const interaction = focus === "none" ? "default" : "focus-theme";
              const covers = themes.map((item) => `site.${locale}.${page}.${viewport}.${item}.${state}.${interaction}`);
              const missing = covers.filter((caseId) => !cases.some((item) => item.id === caseId));
              original.push({ id, covers, missing, status: missing.length ? "gap" : "covered" });
            }
          }
        }
      }
    }
  }
  return { cases, notApplicable, original };
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function stamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

async function launchEdge(profileRoot) {
  const profile = await mkdtemp(join(profileRoot, "edge-"));
  const child = spawn(EDGE, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--remote-debugging-port=0",
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${profile}`,
    "about:blank",
  ], { stdio: "ignore", windowsHide: true });
  let ws;
  try {
  let version;
  let port;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      port = Number((await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid owned browser port");
      version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      break;
    } catch { await sleep(200); }
  }
  if (!version) {
    throw new Error("Edge DevTools did not start");
  }
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((target) => target.type === "page");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let seq = 0;
  const pending = new Map();
  let onEvent = () => {};
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`DevTools timeout: ${method}`)); }, 20000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
      else waiter.resolve(message.result);
    } else if (message.method) onEvent(message);
  };
  ws.onclose = () => {
    for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error("Owned browser disconnected")); }
    pending.clear();
  };
  const session = { child, profile, profileRoot, port, version, ws, send, set onEvent(fn) { onEvent = fn; } };
  return session;
  } catch (error) {
    await closeEdge({ child, profile, profileRoot, ws });
    throw error;
  }
}

async function closeEdge(session) {
  session.ws?.close();
  if (session.child.exitCode === null) {
    await new Promise((done) => {
      const cleanup = spawn("taskkill", ["/PID", String(session.child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      cleanup.once("exit", done); cleanup.once("error", done);
    });
  }
  const full = await realpath(session.profile);
  const parent = await realpath(session.profileRoot);
  if (full !== resolve(session.profile) || dirname(full) !== parent) throw new Error("Browser profile cleanup target changed");
  await rm(full, { recursive: true, force: true });
}

function gitValue(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
}

async function main() {
  const repo = fileURLToPath(new URL("..", import.meta.url));
  const base = arg("--base-url", "http://127.0.0.1:8766").replace(/\/$/, "");
  const outputArgument = arg("--out");
  const out = outputArgument ? resolve(outputArgument) : null;
  const filter = arg("--filter");
  const { cases, notApplicable, original } = buildCases();
  const selected = filter ? cases.filter((item) => item.id.includes(filter) || item.interaction === filter || item.viewport === filter) : cases;
  if (has("--list")) {
    const by = {};
    for (const item of cases) by[item.interaction] = (by[item.interaction] || 0) + 1;
    console.log(JSON.stringify({
      cases: cases.length,
      selected: selected.length,
      by,
      original: original.length,
      originalGaps: original.filter((item) => item.status === "gap").length,
      notApplicable: notApplicable.length,
    }, null, 2));
    return;
  }
  if (!out) throw new Error("--out is required");
  if (typeof globalThis.WebSocket !== "function") throw new Error("Capture requires Node 22 or newer with native WebSocket support");
  if (!selected.length) throw new Error("Filter selected no cases");
  const source = gitValue(repo, ["rev-parse", "HEAD"]);
  const tree = gitValue(repo, ["rev-parse", "HEAD^{tree}"]);
  if ((arg("--source-sha") && arg("--source-sha") !== source) || (arg("--tree-sha") && arg("--tree-sha") !== tree)) throw new Error("Caller-supplied source identity differs from the actual checkout");
  const dirty = gitValue(repo, ["status", "--porcelain"]);
  if (dirty) throw new Error("Refusing to bind captures to a dirty tree; commit the reviewed source first");
  const fileNames = execFileSync("git", ["-C", repo, "ls-files", "-z", "docs/site"], { encoding: "utf8" }).split("\0").filter(Boolean);
  const siteHashes = {};
  for (const name of fileNames) {
    const expected = await readFile(join(repo, name));
    const response = await fetch(`${base}/${name.replace(/^docs\/site\//, "")}`, { cache: "no-store" });
    if (!response.ok || !Buffer.from(await response.arrayBuffer()).equals(expected)) throw new Error(`Served bytes differ from this checkout: ${name}`);
    siteHashes[name] = createHash("sha256").update(expected).digest("hex");
  }
  await mkdir(join(out, "images"), { recursive: true });
  const binding = JSON.stringify({ source_sha: source, tree_sha: tree, source_dirty: false, site_files: siteHashes }, null, 2);
  const sourceManifestHash = createHash("sha256").update(binding).digest("hex");
  await writeFile(join(out, "source.json"), binding, { flag: "wx" });
  const imageDir = join(out, "images");
  const gaps = original.filter((item) => item.status === "gap");
  if (gaps.length && !filter) throw new Error(`Original inventory gaps: ${gaps.slice(0, 5).map((item) => item.id).join(", ")}`);

  const profileRoot = join(out, "browser-profiles");
  await mkdir(profileRoot);
  const session = await launchEdge(profileRoot);
  const records = [];
  let completed = false;
  let sourceIntegrity = "verified";
  async function persist() {
    const manifest = {
      task: "site-ui", review_stage: "development", formal_acceptance: false,
      source_sha: source, tree_sha: tree, source_dirty: false, source_manifest_sha256: sourceManifestHash,
      source_integrity: sourceIntegrity,
      base_url: base, browser: session.version.Browser, updated_at: new Date().toISOString(),
      completed, applicable_case_count: cases.length, selected_case_count: selected.length,
      attempted: records.length, captured: records.filter((item) => item.status === "captured").length,
      pending: selected.length - records.filter((item) => item.status === "captured").length,
      gemini_review: "not_run", cases: records, selected_cases: selected.map(publicCase),
      not_applicable: notApplicable, original_inventory: original,
      limits: ["CSS viewport reflow is not browser zoom or font enlargement.", "deviceScaleFactor is emulation, not a Windows desktop DPI test.", "Screenshots and browser interaction checks do not establish product/package acceptance."]
    };
    const temp = join(out, `.manifest-${Date.now()}.tmp`);
    await writeFile(temp, JSON.stringify(manifest, null, 2), { flag: "wx" });
    await rename(temp, join(out, "manifest.json"));
  }
  await persist();
  try {
  const held = new Set();
  let fetchMode = "continue";
  let loadWait = null;
  session.onEvent = (message) => {
    if (message.method === "Page.loadEventFired" && loadWait) loadWait();
    if (message.method === "Fetch.requestPaused") {
      const requestId = message.params.requestId;
      if (fetchMode === "hold") held.add(requestId);
      else if (fetchMode === "fail") session.send("Fetch.failRequest", { requestId, errorReason: "ConnectionRefused" }).catch(() => {});
      else session.send("Fetch.continueRequest", { requestId }).catch(() => {});
    }
  };
  await session.send("Page.enable");
  await session.send("Runtime.enable");
  await session.send("Network.enable");
  await session.send("Fetch.enable", { patterns: [
    { urlPattern: "*releases.json*", requestStage: "Request" },
    { urlPattern: "*candidate.json*", requestStage: "Request" },
  ] });
  await session.send("Page.addScriptToEvaluateOnNewDocument", { source: "try{localStorage.clear()}catch(e){}" });

  async function evaluate(expression) {
    const result = await session.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "evaluate failed");
    return result.result.value;
  }
  async function key(name, code, vk) {
    const baseEvent = { key: name, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
    await session.send("Input.dispatchKeyEvent", { type: "keyDown", ...baseEvent });
    await session.send("Input.dispatchKeyEvent", { type: "keyUp", ...baseEvent });
  }
  async function tabUntil(selector, max = 40) {
    await evaluate("document.body.setAttribute('tabindex','-1'); document.body.focus();");
    for (let step = 0; step < max; step += 1) {
      await key("Tab", "Tab", 9);
      const hit = await evaluate(`!!document.activeElement && document.activeElement.matches(${JSON.stringify(selector)})`);
      if (hit) return;
    }
    throw new Error(`Tab did not reach ${selector}`);
  }
  async function releaseHeld() {
    for (const requestId of held) {
      await session.send("Fetch.continueRequest", { requestId }).catch(() => {});
    }
    held.clear();
  }

  for (const item of selected) {
    const started = new Date();
    try {
      fetchMode = item.state === "loading" ? "hold" : item.state === "error" ? "fail" : "continue";
      await session.send("Emulation.setDeviceMetricsOverride", {
        width: item.width,
        height: item.height,
        deviceScaleFactor: item.dsf,
        mobile: item.width < 900,
      });
      await session.send("Emulation.setEmulatedMedia", { features: [
        { name: "prefers-color-scheme", value: item.scheme },
        { name: "prefers-reduced-motion", value: "reduce" },
      ] });
      await session.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      });
      const loaded = new Promise((resolve) => { loadWait = resolve; });
      await session.send("Page.navigate", { url: `${base}${item.path}?theme=${item.themeQuery}` });
      await Promise.race([loaded, sleep(12000)]);
      loadWait = null;
      await evaluate("document.fonts&&document.fonts.ready");
      const networkTransitions = [];
      if (item.state === "offline" || item.interaction === "online-recovery") {
        await waitFor(() => evaluate("document.getElementById('download-status').dataset.tone==='ready'"));
        await session.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
        await waitFor(() => evaluate("navigator.onLine===false && document.getElementById('download-status').dataset.tone==='offline'"));
        networkTransitions.push("online-ready", "offline");
        if (item.interaction === "online-recovery") {
          await session.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
          await waitFor(() => evaluate("navigator.onLine===true && document.getElementById('download-status').dataset.tone==='ready'"));
          networkTransitions.push("online-ready");
        }
      }
      if (item.statusRegion) {
        const snippet = SNIPPET[item.locale][item.state];
        await waitFor(() => evaluate(`(() => { const node = document.getElementById('download-status'); return !!(node && node.dataset.tone === ${JSON.stringify(item.state)} && node.textContent.includes(${JSON.stringify(snippet)})); })()`), 8000);
      }
      if (item.interaction === "nav-open" || item.interaction === "focus-nav") {
        if (item.interaction === "focus-nav") {
          await tabUntil(".nav-toggle");
          await key("Enter", "Enter", 13);
        } else {
          await evaluate("document.querySelector('.nav-toggle').click()");
        }
        await waitFor(() => evaluate("document.querySelector('.nav-toggle').getAttribute('aria-expanded')==='true'"));
      }
      if (item.interaction === "faq-open") {
        await evaluate("[...document.querySelectorAll('details > summary')].forEach((node) => { if (!node.parentElement.open) node.click(); })");
        await waitFor(() => evaluate("document.querySelectorAll('details[open]').length >= 4"));
      }
      if (item.interaction === "focus-skip") await tabUntil("a.skip");
      if (item.interaction === "focus-theme") await tabUntil("[data-theme-choice]");
      if (item.interaction === "focus-primary") await tabUntil("main a.button:not(.secondary)");
      if (item.interaction === "focus-summary") {
        await tabUntil("summary");
        await key("Enter", "Enter", 13);
      }
      if (item.interaction === "nav-escape") {
        await evaluate("document.querySelector('.nav-toggle').click()");
        await waitFor(() => evaluate("document.querySelector('.nav-toggle').getAttribute('aria-expanded')==='true'"));
        await key("Escape", "Escape", 27);
        await waitFor(() => evaluate("document.querySelector('.nav-toggle').getAttribute('aria-expanded')==='false' && document.activeElement.matches('.nav-toggle')"));
      }
      const a11y = await evaluate(`(() => {
        const doc = document.documentElement;
        const offenders = [];
        for (const el of document.querySelectorAll('body *')) {
          const rect = el.getBoundingClientRect();
          if (rect.width < 1 || rect.height < 1) continue;
          if (rect.right > doc.clientWidth + 1 || rect.left < -1) {
            offenders.push(el.tagName + (el.id ? '#' + el.id : '') + '.' + String(el.className).slice(0, 24));
            if (offenders.length === 6) break;
          }
        }
        const active = document.activeElement;
        const style = active ? getComputedStyle(active) : null;
        return {
          scroll: doc.scrollWidth, client: doc.clientWidth,
          offenders, lang: doc.lang, h1: document.querySelectorAll('h1').length,
          bg: getComputedStyle(document.body).backgroundColor,
          tone: document.getElementById('download-status') ? document.getElementById('download-status').dataset.tone : null,
          nav: document.querySelector('.nav-toggle') ? document.querySelector('.nav-toggle').getAttribute('aria-expanded') : null,
          faqOpen: document.querySelectorAll('details[open]').length,
          scrollBehavior: getComputedStyle(doc).scrollBehavior,
          active: active ? { tag: active.tagName, id: active.id, className: String(active.className).slice(0, 40), outline: style.outlineStyle, width: style.outlineWidth } : null
        };
      })()`);
      if (a11y.client !== item.width) throw new Error(`viewport ${a11y.client} != ${item.width}`);
      if (a11y.offenders.length || a11y.scroll > a11y.client + 1) throw new Error(`overflow ${JSON.stringify(a11y.offenders)} scroll ${a11y.scroll}`);
      if (a11y.h1 !== 1) throw new Error("expected one h1");
      if (a11y.bg !== item.expectBg) throw new Error(`background ${a11y.bg} != ${item.expectBg}`);
      if (item.interaction.startsWith("focus-") && (!a11y.active || a11y.active.outline === "none")) throw new Error(`focus outline missing ${JSON.stringify(a11y.active)}`);
      const metrics = await session.send("Page.getLayoutMetrics");
      const css = metrics.cssContentSize;
      const slices = [];
      const limit = Math.floor(14000 / item.dsf);
      for (let y = 0; y < css.height; y += limit) {
        const shot = await session.send("Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: true,
          fromSurface: true,
          clip: { x: 0, y, width: css.width, height: Math.min(limit, css.height - y), scale: 1 },
        });
        const bytes = Buffer.from(shot.data, "base64");
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        await writeFile(join(imageDir, `${sha256}.png`), bytes);
        slices.push({ sha256, bytes: bytes.length, y, height: Math.min(limit, css.height - y), width: css.width });
      }
      records.push({
        ...publicCase(item),
        status: "captured",
        gemini_review: "not_run",
        captured_at: stamp(started),
        captured_at_utc: started.toISOString(),
        source_sha: source,
        tree_sha: tree,
        browser: session.version.Browser,
        viewport_css: { width: item.width, height: item.height },
        device_scale_factor: item.dsf,
        prefers_color_scheme: item.scheme,
        prefers_reduced_motion: "reduce",
        screenshot_sha256: slices[0].sha256,
        slices,
        a11y,
        source_dirty: false,
        source_manifest_sha256: sourceManifestHash,
        network_transitions: networkTransitions,
        synthetic_data: false,
        state_driver: item.state === "offline" ? "emulated-offline" : item.state === "error" ? "failed-manifest-request" : item.state === "loading" ? "paused-manifest-request" : "network-ok",
      });
      console.log("ok", item.id, slices[0].sha256.slice(0, 12));
    } catch (error) {
      records.push({
        ...publicCase(item),
        status: "pending",
        gemini_review: "not_run",
        captured_at: stamp(started),
        source_sha: source,
        tree_sha: tree,
        limitation: String(error.message || error),
      });
      console.log("pending", item.id, error.message);
    } finally {
      await releaseHeld();
      await session.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }).catch(() => {});
      if (gitValue(repo, ["rev-parse", "HEAD"]) !== source || gitValue(repo, ["status", "--porcelain"])) {
        sourceIntegrity = "changed";
        throw new Error("Source changed during capture; this run is incomplete");
      }
      await persist();
    }
  }
  completed = true;
  await persist();
  if (records.some((item) => item.status !== "captured")) process.exitCode = 2;
  } finally {
    await persist();
    await closeEdge(session);
  }
}

function publicCase(item) {
  return {
    id: item.id,
    locale: item.locale,
    page: item.page,
    theme: item.theme,
    viewport: item.viewport,
    state: item.state,
    interaction: item.interaction,
    route: `${item.path}?theme=${item.themeQuery}`,
    original_focus: item.originalFocus,
  };
}

async function waitFor(check, timeout = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await check()) return;
    await sleep(40);
  }
  throw new Error("timed out waiting for interaction");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
