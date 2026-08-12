const state = {
  csrf: "",
  me: null,
  users: [],
  devices: [],
  connections: [],
  tunnelDomain: "tunnel.example.com",
  currentView: "dashboard",
  socket: null,
  refreshTimer: null,
  renderId: 0,
  socketReconnectTimer: null,
  audit: {
    page: 1,
    pageSize: 25,
    query: "",
    action: "",
    targetType: "",
  },
};

const landingScreen = document.querySelector("#landing-screen");
const authScreen = document.querySelector("#auth-screen");
const appShell = document.querySelector("#app-shell");
const loginForm = document.querySelector("#login-form");
const passwordForm = document.querySelector("#password-form");
const viewContent = document.querySelector("#view-content");
const pageTitle = document.querySelector("#page-title");
const pageEyebrow = document.querySelector("#page-eyebrow");
const pageActions = document.querySelector("#page-actions");
const modal = document.querySelector("#modal");
const modalForm = document.querySelector("#modal-form");
const modalBody = document.querySelector("#modal-body");
const modalFooter = document.querySelector("#modal-footer");
const modalTitle = document.querySelector("#modal-title");
const modalEyebrow = document.querySelector("#modal-eyebrow");
const modalError = document.querySelector("#modal-error");
const toastRegion = document.querySelector("#toast-region");
const skipLink = document.querySelector("#skip-link");
const sidebarScrim = document.querySelector(".sidebar-scrim");

const themeStorageKey = "ht_theme";

function currentTheme() {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function applyTheme(theme, persist = true) {
  const normalized = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = normalized;
  document.documentElement.style.colorScheme = normalized;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", normalized === "dark" ? "#0f172a" : "#f8fafc");
  document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    const isDark = normalized === "dark";
    const label = isDark ? "切换至浅色主题" : "切换至深色主题";
    button.setAttribute("aria-pressed", String(isDark));
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
  });
  if (persist) {
    try { window.localStorage.setItem(themeStorageKey, normalized); } catch {}
  }
}

document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
  button.addEventListener("click", () => applyTheme(currentTheme() === "dark" ? "light" : "dark"));
});

window.addEventListener("storage", (event) => {
  if (event.key === themeStorageKey && (event.newValue === "light" || event.newValue === "dark")) {
    applyTheme(event.newValue, false);
  }
});

applyTheme(currentTheme(), false);

const viewMeta = {
  dashboard: ["系统总览", "运行状态"],
  users: ["用户管理", "身份与权限"],
  devices: ["设备管理", "设备信任"],
  connections: ["连接管理", "受管隧道"],
  audit: ["审计事件", "操作轨迹"],
};

async function navigateTo(view, replace = false) {
  if (!viewMeta[view]) return;
  const hash = `#${view}`;
  if (location.hash !== hash) {
    if (replace) history.replaceState(null, "", hash);
    else history.pushState(null, "", hash);
  }
  await renderView(view);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatBytes(value) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(amount) / Math.log(1024)));
  return `${(amount / 1024 ** index).toLocaleString("zh-CN", { maximumFractionDigits: index ? 1 : 0 })} ${units[index]}`;
}

async function loadLatestRelease() {
  const releaseNote = document.querySelector("#hero-release-note");
  try {
    const response = await fetch("/api/v1/public/releases/latest", {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error("RELEASE_UNAVAILABLE");
    const release = await response.json();
    document.querySelectorAll(".download-button").forEach((link) => {
      link.href = release.download_url;
      link.classList.remove("is-disabled");
      link.removeAttribute("aria-disabled");
    });
    const shaNode = document.querySelector("#release-sha");
    shaNode.textContent = release.sha256;
    shaNode.title = release.sha256;
    releaseNote.textContent = `Windows v${release.version} · ${release.architecture} · ${formatBytes(release.size_bytes)}`;
  } catch {
    releaseNote.textContent = "前往 GitHub Releases 获取最新版本";
  }
}

async function loadPublicConfig() {
  try {
    const response = await fetch("/api/v1/public/config", {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    if (!response.ok) return;
    const value = await response.json();
    if (typeof value.tunnel_domain !== "string" || !/^[a-z0-9.-]{1,253}$/.test(value.tunnel_domain)) return;
    state.tunnelDomain = value.tunnel_domain;
    document.querySelectorAll("[data-example-subdomain]").forEach((node) => {
      node.textContent = `https://${node.dataset.exampleSubdomain}.${state.tunnelDomain}`;
    });
  } catch {}
}

function formatBps(value) {
  if (value == null) return "不限速";
  const amount = Number(value);
  if (amount >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(1)} Gbps`;
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)} Mbps`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)} Kbps`;
  return `${amount} bps`;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN", { hour12: false });
}

function statusBadge(status) {
  const normalized = String(status ?? "unknown").toLowerCase();
  const tone = ["active", "healthy", "online", "normal"].includes(normalized)
    ? "ok"
    : ["pending", "applying", "degraded", "must_change", "unknown"].includes(normalized)
      ? "warn"
      : ["offline", "disabled"].includes(normalized)
        ? "neutral"
        : "error";
  const label = {
    active: "启用",
    disabled: "已禁用",
    revoked: "已撤销",
    healthy: "健康",
    unhealthy: "异常",
    degraded: "降级",
    unknown: "待确认",
    normal: "正常",
    must_change: "待改密",
    pending: "待应用",
    applying: "应用中",
    online: "在线",
    offline: "离线",
  }[normalized] ?? normalized;
  return `<span class="status-badge ${tone}">${escapeHtml(label)}</span>`;
}

function componentLabel(component) {
  return {
    "control-center": "控制中心",
    sqlite: "SQLite",
    outbox: "策略队列",
    "traffic-gateway": "流量网关",
    frps: "FRPS",
    caddy: "Caddy",
    backup: "备份",
  }[component] ?? component;
}

function configState(device) {
  const applied = Number(device.applied_config_version ?? 0);
  const target = Number(device.config_version ?? 0);
  const inSync = applied === target;
  return `<span class="config-state"><strong class="${inSync ? "" : "drift"}">${inSync ? "已同步" : "待应用"}</strong><small>应用 v${applied} · 目标 v${target}</small></span>`;
}

function toast(message, type = "success") {
  const item = document.createElement("div");
  item.className = `toast ${type === "error" ? "error" : ""}`;
  item.textContent = message;
  toastRegion.append(item);
  window.setTimeout(() => item.remove(), 4500);
}

async function parseResponse(response) {
  if (response.status === 204) return null;
  const type = response.headers.get("content-type") ?? "";
  return type.includes("application/json") ? response.json() : response.text();
}

async function refreshSession() {
  const response = await fetch("/api/v1/auth/refresh", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_type: "web" }),
  });
  if (!response.ok) throw new Error("SESSION_REVOKED");
  const data = await response.json();
  state.csrf = data.csrf_token;
  return data;
}

async function api(path, options = {}, canRefresh = true) {
  const method = options.method ?? "GET";
  const headers = new Headers(options.headers ?? {});
  if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && state.csrf) headers.set("x-csrf-token", state.csrf);
  headers.set("x-request-id", crypto.randomUUID());
  const response = await fetch(path, { ...options, method, headers, credentials: "same-origin" });
  const data = await parseResponse(response);
  if (response.status === 401 && canRefresh && !path.startsWith("/api/v1/auth/")) {
    await refreshSession();
    return api(path, options, false);
  }
  if (!response.ok) {
    const error = new Error(data?.message ?? `请求失败 (${response.status})`);
    error.code = data?.error_code;
    error.details = data;
    error.status = response.status;
    throw error;
  }
  return data;
}

// 登录后待改密时，登录密码保存在闭包变量中传递，避免写入隐藏的 DOM 输入框。
let pendingCurrentPassword = null;

function setPendingCurrentPassword(password) {
  pendingCurrentPassword = password;
  const input = document.querySelector("#current-password");
  input.value = "";
  input.required = password == null;
  input.closest(".field").classList.toggle("hidden", password != null);
}

function showLogin(message = "") {
  document.body.classList.add("auth-active");
  state.me = null;
  state.csrf = "";
  setPendingCurrentPassword(null);
  window.clearTimeout(state.socketReconnectTimer);
  state.socketReconnectTimer = null;
  state.socket?.close();
  state.socket = null;
  landingScreen.classList.add("hidden");
  appShell.classList.add("hidden");
  authScreen.classList.remove("hidden");
  skipLink.href = "#auth-screen";
  document.title = "登录后台 — Home Tunnel";
  loginForm.classList.remove("hidden");
  passwordForm.classList.add("hidden");
  document.querySelector("#login-error").textContent = message;
  window.setTimeout(() => document.querySelector("#login-username").focus(), 0);
}

async function showApp() {
  document.body.classList.remove("auth-active");
  state.me = await api("/api/v1/auth/me");
  if (state.me.role !== "admin") {
    showLogin("该账号没有管理员后台权限");
    return;
  }
  landingScreen.classList.add("hidden");
  authScreen.classList.add("hidden");
  appShell.classList.remove("hidden");
  skipLink.href = "#main-content";
  document.title = "Home Tunnel 控制中心";
  document.querySelector("#current-user").textContent = state.me.display_name;
  document.querySelector(".user-chip small").textContent = state.me.username;
  document.querySelector("#user-avatar").textContent = state.me.display_name.slice(0, 1).toUpperCase();
  connectRealtime();
  const hash = location.hash.replace("#", "");
  if (!viewMeta[hash]) history.replaceState(null, "", "#dashboard");
  await renderView(viewMeta[hash] ? hash : "dashboard");
}

function loadingView(view) {
  viewContent.setAttribute("aria-busy", "true");
  viewContent.innerHTML = view === "dashboard"
    ? `<div class="metrics-grid" aria-hidden="true"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div><div class="skeleton skeleton-table" aria-hidden="true"></div>`
    : `<div class="skeleton skeleton-table" aria-hidden="true"></div>`;
}

function renderPageActions(view) {
  const actions = {
    dashboard: `<button class="button button-secondary" data-action="refresh-view">刷新数据</button>`,
    users: `<button class="button button-primary" data-action="create-user">创建用户</button>`,
    devices: `<button class="button button-secondary" data-action="refresh-view">刷新状态</button>`,
    connections: `<button class="button button-primary" data-action="create-connection">创建连接</button>`,
    audit: `<button class="button button-secondary" data-action="refresh-view">刷新事件</button>`,
  };
  pageActions.innerHTML = actions[view] ?? "";
}

async function renderView(view) {
  const renderId = ++state.renderId;
  state.currentView = view;
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  const [title, eyebrow] = viewMeta[view];
  pageTitle.textContent = title;
  pageEyebrow.textContent = eyebrow;
  renderPageActions(view);
  loadingView(view);
  try {
    if (view === "dashboard") await renderDashboard(renderId);
    if (view === "users") await renderUsers(renderId);
    if (view === "devices") await renderDevices(renderId);
    if (view === "connections") await renderConnections(renderId);
    if (view === "audit") await renderAudit(renderId);
    if (renderId !== state.renderId) return;
    viewContent.setAttribute("aria-busy", "false");
    document.querySelector("#main-content").focus({ preventScroll: true });
  } catch (error) {
    if (renderId !== state.renderId) return;
    viewContent.setAttribute("aria-busy", "false");
    if (error.code === "SESSION_REVOKED") {
      showLogin("会话已失效，请重新登录");
      return;
    }
    viewContent.innerHTML = `<div class="panel"><div class="empty-state"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg><strong>无法加载数据</strong><span>${escapeHtml(error.message)}</span><button class="button button-secondary" data-action="refresh-view">重试</button></div></div>`;
  }
}

async function renderDashboard(renderId) {
  const [summary, traffic, health] = await Promise.all([
    api("/api/v1/admin/summary"),
    api("/api/v1/admin/traffic/summary?hours=24"),
    api("/api/v1/admin/system/health"),
  ]);
  if (renderId !== state.renderId) return;
  const totalTraffic = Number(summary.upload_24h) + Number(summary.download_24h);
  viewContent.innerHTML = `
    <div class="dashboard-hero-layout">
      <section class="panel tunnel-pulse-card" aria-label="Tunnel Pulse 核心控制台">
        <div class="pulse-header">
          <div class="pulse-brand">
            <span class="pulse-dot"></span>
            <div>
              <h3>Tunnel Pulse 穿透主控</h3>
              <p>实时连接状态与 24 小时数据流转</p>
            </div>
          </div>
          <span class="status-badge ok">网关正常运行</span>
        </div>
        <div class="pulse-core-metrics">
          <div class="pulse-metric-item">
            <span class="pulse-label">在线 / 总连接</span>
            <div class="pulse-value-large">${Number(summary.online_connections)} <small>/ ${Number(summary.connections)}</small></div>
            <span class="pulse-meta">以服务端运行状态为准</span>
          </div>
          <div class="pulse-metric-item">
            <span class="pulse-label">24 小时传输流量</span>
            <div class="pulse-value-large">${formatBytes(totalTraffic)}</div>
            <span class="pulse-meta">↑ 上传 ${formatBytes(summary.upload_24h)} · ↓ 下载 ${formatBytes(summary.download_24h)}</span>
          </div>
        </div>
      </section>

      <section class="panel health-rail-panel" aria-label="系统组件健康状态">
        <div class="health-rail-header">
          <div class="health-summary">${statusBadge(health.status)}<span><strong>系统组件</strong><small>${health.components.length} 项实时检查</small></span></div>
        </div>
        <div class="health-rail-list">${health.components.map((item) => {
          const tone = item.status === "healthy" ? "" : item.status === "unhealthy" ? "error" : "warn";
          const detail = item.latency_ms == null ? "正常" : `${Number(item.latency_ms).toLocaleString("zh-CN")} ms`;
          return `<div class="health-rail-item ${tone}" title="${escapeHtml(item.status)}">
            <span class="health-rail-dot"></span>
            <span class="health-rail-name">${escapeHtml(componentLabel(item.component))}</span>
            <span class="health-rail-val">${detail}</span>
          </div>`;
        }).join("")}</div>
      </section>
    </div>

    <section class="stats-strip-grid" aria-label="关键补充统计">
      <article class="stat-strip-item">
        <span class="stat-strip-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m7-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.9"/></svg></span>
        <div class="stat-strip-info">
          <span class="stat-strip-label">启用账号</span>
          <strong class="stat-strip-val">${Number(summary.users).toLocaleString("zh-CN")}</strong>
        </div>
      </article>
      <article class="stat-strip-item">
        <span class="stat-strip-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 2h14a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm3 17h8"/></svg></span>
        <div class="stat-strip-info">
          <span class="stat-strip-label">在线设备</span>
          <strong class="stat-strip-val">${Number(summary.online_devices).toLocaleString("zh-CN")}</strong>
        </div>
      </article>
      <article class="stat-strip-item">
        <span class="stat-strip-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></span>
        <div class="stat-strip-info">
          <span class="stat-strip-label">受管域名</span>
          <strong class="stat-strip-val mono">${escapeHtml(state.tunnelDomain)}</strong>
        </div>
      </article>
    </section>

    <section class="panel table-panel table-section">
      <div class="panel-header">
        <div>
          <h3>流量最高的连接</h3>
          <span class="panel-subtle">过去 24 小时数据传输排行</span>
        </div>
      </div>
      ${traffic.items.length ? `<table class="data-table"><thead><tr><th>连接</th><th>用户</th><th>上传</th><th>下载</th><th>请求</th></tr></thead><tbody>${traffic.items.slice(0, 6).map((item) => `<tr><td data-label="连接"><span class="cell-primary">${escapeHtml(item.name)}</span><span class="cell-secondary mono">${escapeHtml(item.subdomain)}.${escapeHtml(state.tunnelDomain)}</span></td><td data-label="用户">${escapeHtml(item.username)}</td><td data-label="上传" class="mono">${formatBytes(item.upload_bytes)}</td><td data-label="下载" class="mono">${formatBytes(item.download_bytes)}</td><td data-label="请求" class="mono">${Number(item.requests).toLocaleString("zh-CN")}</td></tr>`).join("")}</tbody></table>` : emptyState("暂无流量样本", "网关收到业务请求后会按 10 秒桶写入样本。")}
    </section>`;
}

function emptyState(title, detail) {
  return `<div class="empty-state"><span class="empty-state-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v16H4zM8 9h8M8 13h5"/></svg></span><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span></div>`;
}

async function renderUsers(renderId = state.renderId) {
  const data = await api("/api/v1/admin/users");
  if (renderId !== state.renderId) return;
  state.users = data.items;
  viewContent.innerHTML = `
    <section class="panel table-panel">${state.users.length ? `<table class="data-table"><thead><tr><th>用户</th><th>角色</th><th>状态</th><th>设备 / 连接</th><th>账号上限</th><th><span class="visually-hidden">操作</span></th></tr></thead><tbody>${state.users.map((user) => `<tr><td data-label="用户"><span class="cell-primary">${escapeHtml(user.display_name)}</span><span class="cell-secondary mono">${escapeHtml(user.username)}</span></td><td data-label="角色">${user.role === "admin" ? "管理员" : "普通用户"}</td><td data-label="状态">${statusBadge(user.status)} ${user.password_state === "must_change" ? statusBadge("must_change") : ""}</td><td data-label="设备 / 连接" class="mono">${user.device_count} / ${user.connection_count}</td><td data-label="账号上限" class="mono">${formatBps(user.bandwidth_limit_bps)}</td><td class="actions-cell" data-label="操作"><div class="actions"><button class="button button-quiet button-small" data-action="user-policy" data-id="${user.id}">限速</button><button class="button button-quiet button-small" data-action="reset-password" data-id="${user.id}">重置密码</button><button class="button ${user.status === "active" ? "button-danger" : "button-secondary"} button-small" data-action="toggle-user" data-id="${user.id}" data-status="${user.status}">${user.status === "active" ? "禁用" : "恢复"}</button></div></td></tr>`).join("")}</tbody></table>` : emptyState("还没有用户", "创建首个普通用户并将一次性临时密码安全交付给本人。")}</section>`;
}

async function renderDevices(renderId = state.renderId) {
  const data = await api("/api/v1/admin/devices");
  if (renderId !== state.renderId) return;
  state.devices = data.items;
  viewContent.innerHTML = `
    <section class="panel table-panel">${state.devices.length ? `<table class="data-table"><thead><tr><th>设备</th><th>用户</th><th>状态</th><th>配置</th><th class="hide-tablet">最后在线</th><th class="hide-tablet">租约到期</th><th><span class="visually-hidden">操作</span></th></tr></thead><tbody>${state.devices.map((device) => `<tr><td data-label="设备"><span class="cell-primary">${escapeHtml(device.name)}</span><span class="cell-secondary mono">${escapeHtml(device.id.slice(0, 8))} · 客户端 ${escapeHtml(device.client_version ?? "未知")} · Agent ${escapeHtml(device.agent_version ?? "未知")}</span></td><td data-label="用户">${escapeHtml(device.username)}</td><td data-label="状态">${statusBadge(device.status === "active" && device.online ? "active" : device.status === "active" ? "Offline" : device.status)}</td><td data-label="配置">${configState(device)}</td><td data-label="最后在线" class="hide-tablet">${formatDate(device.last_seen_at)}</td><td data-label="租约到期" class="hide-tablet">${formatDate(device.lease_expires_at)}</td><td class="actions-cell" data-label="操作"><div class="actions"><button class="button button-danger button-small" data-action="delete-device" data-id="${device.id}" data-name="${escapeHtml(device.name)}" aria-label="删除设备 ${escapeHtml(device.name)}">删除</button></div></td></tr>`).join("")}</tbody></table>` : emptyState("还没有注册设备", "用户可通过 Windows 图形客户端或 Linux 无界面服务完成设备注册。")}</section>`;
}

async function renderConnections(renderId = state.renderId) {
  const data = await api("/api/v1/admin/connections");
  if (renderId !== state.renderId) return;
  state.connections = data.items;
  viewContent.innerHTML = `
    <section class="panel table-panel">${state.connections.length ? `<table class="data-table"><thead><tr><th>连接</th><th>归属</th><th>状态</th><th>本地目标</th><th>连接上限</th><th>版本</th><th><span class="visually-hidden">操作</span></th></tr></thead><tbody>${state.connections.map((connection) => `<tr><td data-label="连接"><span class="cell-primary">${escapeHtml(connection.name)}</span><a class="cell-secondary mono" href="${escapeHtml(connection.public_url)}" target="_blank" rel="noopener">${escapeHtml(connection.public_url)}</a></td><td data-label="归属"><span class="cell-primary">${escapeHtml(connection.username)}</span><span class="cell-secondary">${escapeHtml(connection.device_name)}</span></td><td data-label="状态">${statusBadge(connection.enabled ? connection.state : "disabled")}</td><td data-label="本地目标" class="mono">${escapeHtml(connection.local_scheme)}://${escapeHtml(connection.local_host)}:${connection.local_port}</td><td data-label="连接上限" class="mono">${formatBps(connection.bandwidth_limit_bps)}</td><td data-label="版本" class="mono">v${connection.version} / a${connection.applied_version}</td><td class="actions-cell"><div class="actions"><button class="button button-quiet button-small" data-action="edit-connection" data-id="${connection.id}">编辑</button><button class="button button-danger button-small" data-action="delete-connection" data-id="${connection.id}">删除</button></div></td></tr>`).join("")}</tbody></table>` : emptyState("还没有连接", "为已注册设备创建 HTTP/HTTPS 连接，设备离线时会保持 Pending。")}</section>`;
}

async function renderAudit(renderId = state.renderId) {
  const params = new URLSearchParams({
    page: String(state.audit.page),
    page_size: String(state.audit.pageSize),
  });
  if (state.audit.query) params.set("q", state.audit.query);
  if (state.audit.action) params.set("action", state.audit.action);
  if (state.audit.targetType) params.set("target_type", state.audit.targetType);
  const data = await api(`/api/v1/admin/audit-events?${params}`);
  if (renderId !== state.renderId) return;
  state.audit.page = Number(data.page ?? state.audit.page);
  state.audit.pageSize = Number(data.page_size ?? state.audit.pageSize);
  const total = Number(data.total ?? data.items.length);
  const totalPages = Math.max(1, Number(data.total_pages ?? 1));
  const first = total === 0 ? 0 : (state.audit.page - 1) * state.audit.pageSize + 1;
  const last = total === 0 ? 0 : Math.min(total, first + data.items.length - 1);
  const targetTypes = ["", "User", "Device", "Connection", "Session", "TrafficPolicy"];
  viewContent.innerHTML = `
    <section class="panel audit-filter-panel">
      <form id="audit-filter-form" class="audit-filter-form">
        <div class="field audit-search"><label for="audit-query">关键词</label><input id="audit-query" name="query" type="search" value="${escapeHtml(state.audit.query)}" placeholder="动作、操作者、目标或 Request ID"></div>
        <div class="field"><label for="audit-action">动作</label><input id="audit-action" name="action" value="${escapeHtml(state.audit.action)}" placeholder="例如 LoginSucceeded"></div>
        <div class="field"><label for="audit-target-type">目标类型</label><select id="audit-target-type" name="target_type">${targetTypes.map((value) => `<option value="${value}" ${state.audit.targetType === value ? "selected" : ""}>${value || "全部目标"}</option>`).join("")}</select></div>
        <div class="field"><label for="audit-page-size">每页</label><select id="audit-page-size" name="page_size">${[25, 50, 100].map((value) => `<option value="${value}" ${state.audit.pageSize === value ? "selected" : ""}>${value} 条</option>`).join("")}</select></div>
        <div class="audit-filter-actions"><button class="button button-quiet" type="button" data-action="reset-audit-filter">重置</button><button class="button button-primary" type="submit">筛选</button></div>
      </form>
    </section>
    <section class="panel table-panel audit-table-panel">${data.items.length ? `<table class="data-table"><thead><tr><th>时间</th><th>动作</th><th>操作者</th><th>目标</th><th>Request ID</th></tr></thead><tbody>${data.items.map((item) => `<tr><td data-label="时间">${formatDate(item.created_at)}</td><td data-label="动作"><span class="cell-primary">${escapeHtml(item.action)}</span><span class="cell-secondary">${escapeHtml(item.actor_type)}</span></td><td data-label="操作者" class="mono">${escapeHtml(item.actor_id?.slice(0, 8) ?? "system")}</td><td data-label="目标"><span class="cell-primary">${escapeHtml(item.target_type)}</span><span class="cell-secondary mono">${escapeHtml(item.target_id?.slice(0, 16) ?? "—")}</span></td><td data-label="Request ID" class="mono">${escapeHtml(item.request_id)}</td></tr>`).join("")}</tbody></table>` : emptyState("没有匹配的审计事件", "调整筛选条件后重试。")}
      <footer class="pagination" aria-label="审计事件分页"><span>显示 ${first}–${last}，共 ${total.toLocaleString("zh-CN")} 条</span><div><button class="button button-quiet button-small" data-action="audit-page" data-page="${state.audit.page - 1}" ${state.audit.page <= 1 ? "disabled" : ""}>上一页</button><span class="pagination-current">第 ${state.audit.page} / ${totalPages} 页</span><button class="button button-quiet button-small" data-action="audit-page" data-page="${state.audit.page + 1}" ${state.audit.page >= totalPages ? "disabled" : ""}>下一页</button></div></footer>
    </section>`;
}

function field(name, label, value = "", options = {}) {
  const type = options.type ?? "text";
  const attrs = [options.required !== false ? "required" : "", options.min ? `min="${options.min}"` : "", options.max ? `max="${options.max}"` : "", options.minlength ? `minlength="${options.minlength}"` : ""].filter(Boolean).join(" ");
  const helperId = `modal-${name}-helper`;
  return `<div class="field ${options.full ? "full" : ""}"><label for="modal-${name}">${escapeHtml(label)}</label><input id="modal-${name}" name="${escapeHtml(name)}" type="${escapeHtml(type)}" value="${escapeHtml(value)}" ${options.helper ? `aria-describedby="${helperId}"` : ""} ${attrs}>${options.helper ? `<p class="helper" id="${helperId}">${escapeHtml(options.helper)}</p>` : ""}</div>`;
}

function openModal({ title, eyebrow = "操作", body, submitLabel = "保存", danger = false, onSubmit }) {
  modalTitle.textContent = title;
  modalEyebrow.textContent = eyebrow;
  modalError.textContent = "";
  modalBody.innerHTML = body;
  modalFooter.innerHTML = `<button class="button button-quiet" type="button" data-modal-cancel>取消</button><button class="button ${danger ? "button-danger" : "button-primary"}" type="submit">${escapeHtml(submitLabel)}</button>`;
  modalFooter.querySelector("[data-modal-cancel]").addEventListener("click", () => modal.close("cancel"));
  modalForm.onsubmit = async (event) => {
    event.preventDefault();
    if (!modalForm.checkValidity()) {
      modalForm.reportValidity();
      return;
    }
    const button = modalFooter.querySelector("button[type=submit]");
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.classList.add("is-loading");
    const original = button.textContent;
    button.textContent = "处理中…";
    modalError.textContent = "";
    try {
      await onSubmit(new FormData(modalForm), button);
    } catch (error) {
      modalError.textContent = error.message;
      modalError.focus({ preventScroll: true });
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.classList.remove("is-loading");
      button.textContent = original;
    }
  };
  modal.showModal();
  window.setTimeout(() => modalBody.querySelector("input,select,button")?.focus(), 0);
}

function showSecret(title, secret, detail) {
  modalTitle.textContent = title;
  modalEyebrow.textContent = "安全交付";
  modalError.textContent = "";
  modalBody.innerHTML = `<div class="secret-box"><strong>仅显示这一次</strong><span class="secret-value">${escapeHtml(secret)}</span><p class="helper">${escapeHtml(detail)}</p><button class="button button-secondary" type="button" data-copy-secret>复制到剪贴板</button></div>`;
  modalFooter.innerHTML = `<button class="button button-primary" type="button" data-secret-done>我已安全保存</button>`;
  modalBody.querySelector("[data-copy-secret]").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(secret);
      toast("已复制；请通过安全渠道交付");
    } catch {
      modalError.textContent = "浏览器未允许访问剪贴板，请手动选择并复制临时密码。";
    }
  });
  modalFooter.querySelector("[data-secret-done]").addEventListener("click", () => modal.close("done"));
}

async function openCreateUser() {
  openModal({
    title: "创建用户",
    eyebrow: "身份管理",
    body: `<div class="form-grid">${field("username", "用户名", "", { helper: "小写字母、数字、点、下划线或连字符" })}${field("display_name", "显示名称")}
      <div class="field"><label for="modal-role">角色</label><select id="modal-role" name="role"><option value="user">普通用户</option><option value="admin">管理员</option></select></div>
      ${field("bandwidth_mbps", "账号带宽上限 (Mbps)", "", { type: "number", required: false, min: 0.1, helper: "留空表示不限速" })}</div>`,
    submitLabel: "创建并生成临时密码",
    onSubmit: async (form) => {
      const mbps = String(form.get("bandwidth_mbps") ?? "").trim();
      const result = await api("/api/v1/admin/users", { method: "POST", body: JSON.stringify({ username: form.get("username"), display_name: form.get("display_name"), role: form.get("role"), bandwidth_limit_bps: mbps ? Math.round(Number(mbps) * 1_000_000) : null }) });
      showSecret("临时密码", result.temporary_password, "临时密码 72 小时有效，首次登录后必须修改。关闭后无法再次查看。");
      await renderUsers();
    },
  });
}

async function openUserPolicy(userId) {
  const user = state.users.find((item) => item.id === userId);
  if (!user) return;
  openModal({
    title: `账号限速 · ${user.username}`,
    eyebrow: "带宽策略",
    body: `<div class="notice"><strong>动态共享带宽池</strong><span>该用户全部活跃连接共享此上限；上传和下载共同消耗。</span></div>${field("bandwidth_mbps", "账号带宽上限 (Mbps)", user.bandwidth_limit_bps == null ? "" : user.bandwidth_limit_bps / 1_000_000, { type: "number", required: false, min: 0.1, helper: "留空表示不限速" })}`,
    onSubmit: async (form) => {
      const raw = String(form.get("bandwidth_mbps") ?? "").trim();
      await api(`/api/v1/admin/traffic-policies/user/${user.id}`, { method: "PATCH", headers: { "if-match": `"${user.policy_version}"` }, body: JSON.stringify({ bandwidth_limit_bps: raw ? Math.round(Number(raw) * 1_000_000) : null }) });
      modal.close("saved");
      toast("账号限速策略已更新");
      await renderUsers();
    },
  });
}

async function openCreateConnection() {
  if (!state.users.length) state.users = (await api("/api/v1/admin/users")).items;
  state.devices = (await api("/api/v1/admin/devices")).items.filter((item) => item.status === "active");
  if (!state.devices.length) {
    toast("请先让用户通过 Windows 或 Linux 客户端注册设备", "error");
    return;
  }
  const userOptions = state.users.filter((item) => item.status === "active").map((user) => `<option value="${user.id}">${escapeHtml(user.display_name)} · ${escapeHtml(user.username)}</option>`).join("");
  const deviceOptions = state.devices.map((device) => `<option value="${device.id}" data-user="${device.user_id}">${escapeHtml(device.name)} · ${escapeHtml(device.username)}</option>`).join("");
  openModal({
    title: "创建受管连接",
    eyebrow: "受管连接",
    body: `<div class="form-grid"><div class="field"><label for="modal-user_id">用户</label><select id="modal-user_id" name="user_id">${userOptions}</select></div><div class="field"><label for="modal-device_id">设备</label><select id="modal-device_id" name="device_id">${deviceOptions}</select></div>${field("name", "连接名称")}${field("subdomain", "业务子域", "", { helper: `.${state.tunnelDomain}` })}<div class="field"><label for="modal-local_scheme">本地协议</label><select id="modal-local_scheme" name="local_scheme"><option value="http">http</option><option value="https">https</option></select></div>${field("local_host", "本地地址", "127.0.0.1")}${field("local_port", "本地端口", "8080", { type: "number", min: 1, max: 65535 })}${field("bandwidth_mbps", "连接上限 (Mbps)", "", { type: "number", required: false, min: 0.1 })}<div class="field full"><label><input name="enabled" type="checkbox" checked> 创建后立即启用</label></div></div>`,
    submitLabel: "创建连接",
    onSubmit: async (form) => {
      const mbps = String(form.get("bandwidth_mbps") ?? "").trim();
      await api("/api/v1/admin/connections", { method: "POST", body: JSON.stringify({ user_id: form.get("user_id"), device_id: form.get("device_id"), name: form.get("name"), subdomain: form.get("subdomain"), local_scheme: form.get("local_scheme"), local_host: form.get("local_host"), local_port: Number(form.get("local_port")), enabled: form.get("enabled") === "on", bandwidth_limit_bps: mbps ? Math.round(Number(mbps) * 1_000_000) : null }) });
      modal.close("saved");
      toast("连接已创建；设备离线时保持 Pending");
      await renderConnections();
    },
  });
  const userSelect = modalBody.querySelector("#modal-user_id");
  const deviceSelect = modalBody.querySelector("#modal-device_id");
  const filterDevices = () => {
    const userId = userSelect.value;
    [...deviceSelect.options].forEach((option) => { option.hidden = option.dataset.user !== userId; });
    const first = [...deviceSelect.options].find((option) => !option.hidden);
    if (first) deviceSelect.value = first.value;
  };
  userSelect.addEventListener("change", filterDevices);
  const firstDeviceUser = state.devices[0]?.user_id;
  if (firstDeviceUser) userSelect.value = firstDeviceUser;
  filterDevices();
}

function openEditConnection(connectionId) {
  const connection = state.connections.find((item) => item.id === connectionId);
  if (!connection) return;
  openModal({
    title: `编辑连接 · ${connection.name}`,
    eyebrow: "版本化更新",
    body: `<div class="form-grid">${field("name", "连接名称", connection.name)}${field("subdomain", "业务子域", connection.subdomain)}<div class="field"><label for="modal-local_scheme">本地协议</label><select id="modal-local_scheme" name="local_scheme"><option value="http" ${connection.local_scheme === "http" ? "selected" : ""}>http</option><option value="https" ${connection.local_scheme === "https" ? "selected" : ""}>https</option></select></div>${field("local_host", "本地地址", connection.local_host)}${field("local_port", "本地端口", connection.local_port, { type: "number", min: 1, max: 65535 })}${field("bandwidth_mbps", "连接上限 (Mbps)", connection.bandwidth_limit_bps == null ? "" : connection.bandwidth_limit_bps / 1_000_000, { type: "number", required: false, min: 0.1 })}<div class="field full"><label><input name="enabled" type="checkbox" ${connection.enabled ? "checked" : ""}> 启用连接</label><p class="helper">当前版本 v${connection.version}；冲突时不会覆盖服务器新值。</p></div></div>`,
    onSubmit: async (form) => {
      const mbps = String(form.get("bandwidth_mbps") ?? "").trim();
      await api(`/api/v1/admin/connections/${connection.id}`, { method: "PATCH", headers: { "if-match": `"${connection.version}"` }, body: JSON.stringify({ name: form.get("name"), subdomain: form.get("subdomain"), local_scheme: form.get("local_scheme"), local_host: form.get("local_host"), local_port: Number(form.get("local_port")), enabled: form.get("enabled") === "on", bandwidth_limit_bps: mbps ? Math.round(Number(mbps) * 1_000_000) : null }) });
      modal.close("saved");
      toast("连接配置已更新");
      await renderConnections();
    },
  });
}

function confirmAction(title, detail, submitLabel, onSubmit) {
  openModal({ title, eyebrow: "需要确认", body: `<div class="notice notice-warning"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span></div>`, submitLabel, danger: true, onSubmit });
}

appShell.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (action === "refresh-view") await renderView(state.currentView);
  if (action === "audit-page") {
    state.audit.page = Math.max(1, Number(button.dataset.page) || 1);
    await renderView("audit");
  }
  if (action === "reset-audit-filter") {
    state.audit = { page: 1, pageSize: 25, query: "", action: "", targetType: "" };
    await renderView("audit");
  }
  if (action === "create-user") await openCreateUser();
  if (action === "user-policy") await openUserPolicy(button.dataset.id);
  if (action === "reset-password") {
    const user = state.users.find((item) => item.id === button.dataset.id);
    confirmAction("重置临时密码", `将撤销 ${user?.username ?? "该用户"} 的全部会话，并重新进入首次改密状态。`, "确认重置", async () => {
      const result = await api(`/api/v1/admin/users/${button.dataset.id}/reset-password`, { method: "POST", body: "{}" });
      showSecret("新的临时密码", result.temporary_password, "关闭后无法再次查看；旧密码和全部旧会话已失效。");
      await renderUsers();
    });
  }
  if (action === "toggle-user") {
    const disabling = button.dataset.status === "active";
    const user = state.users.find((item) => item.id === button.dataset.id);
    confirmAction(disabling ? "禁用账号" : "恢复账号", disabling ? `目标 5 秒内阻断 ${user?.username ?? "该用户"} 的全部关联流量。` : `恢复账号后，设备仍需有效凭据和租约才能上线。`, disabling ? "确认禁用" : "确认恢复", async () => {
      await api(`/api/v1/admin/users/${button.dataset.id}/${disabling ? "disable" : "enable"}`, { method: "POST", body: "{}" });
      modal.close("done"); toast(disabling ? "账号禁用正在收敛" : "账号已恢复"); await renderUsers();
    });
  }
  if (action === "delete-device") {
    confirmAction("删除设备", `设备“${button.dataset.name}”的凭据、会话、租约、连接和流量明细将被删除，且无法恢复。`, "确认删除", async () => {
      await api(`/api/v1/admin/devices/${button.dataset.id}`, { method: "DELETE", body: "{}" }); modal.close("done"); toast("设备已删除"); await renderDevices();
    });
  }
  if (action === "create-connection") await openCreateConnection();
  if (action === "edit-connection") openEditConnection(button.dataset.id);
  if (action === "delete-connection") {
    const connection = state.connections.find((item) => item.id === button.dataset.id);
    confirmAction("删除连接", `将先阻断 ${connection?.subdomain ?? "该子域"} 的流量，再写入版本化 tombstone。`, "删除并停止", async () => {
      await api(`/api/v1/admin/connections/${connection.id}`, { method: "DELETE", headers: { "if-match": `"${connection.version}"` }, body: "{}" }); modal.close("done"); toast("连接已删除"); await renderConnections();
    });
  }
});

viewContent.addEventListener("submit", async (event) => {
  if (event.target.id !== "audit-filter-form") return;
  event.preventDefault();
  const form = new FormData(event.target);
  state.audit.query = String(form.get("query") ?? "").trim();
  state.audit.action = String(form.get("action") ?? "").trim();
  state.audit.targetType = String(form.get("target_type") ?? "");
  state.audit.pageSize = [25, 50, 100].includes(Number(form.get("page_size"))) ? Number(form.get("page_size")) : 25;
  state.audit.page = 1;
  await renderView("audit");
});

function closeSidebar() {
  document.querySelector(".sidebar").classList.remove("open");
  document.querySelector("#menu-button").setAttribute("aria-expanded", "false");
}

document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", async () => {
  closeSidebar();
  await navigateTo(button.dataset.view);
}));

document.querySelector("#menu-button").addEventListener("click", (event) => {
  const sidebar = document.querySelector(".sidebar");
  const open = sidebar.classList.toggle("open");
  event.currentTarget.setAttribute("aria-expanded", String(open));
});

sidebarScrim.addEventListener("click", closeSidebar);
window.addEventListener("popstate", () => {
  if (!state.me) return;
  const view = location.hash.replace("#", "");
  if (viewMeta[view]) void renderView(view);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && document.querySelector(".sidebar").classList.contains("open")) closeSidebar();
});

document.querySelectorAll(".password-toggle").forEach((button) => button.addEventListener("click", () => {
  const input = document.querySelector(`#${button.dataset.target}`);
  const showing = input.type === "text";
  input.type = showing ? "password" : "text";
  button.setAttribute("aria-label", showing ? "显示密码" : "隐藏密码");
}));

document.querySelectorAll(".download-button").forEach((link) => link.addEventListener("click", (event) => {
  if (link.classList.contains("is-disabled")) event.preventDefault();
}));

document.querySelector("#modal-close").addEventListener("click", () => modal.close("cancel"));
modal.addEventListener("close", () => {
  modalError.textContent = "";
  modalForm.onsubmit = null;
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!loginForm.checkValidity()) {
    loginForm.reportValidity();
    return;
  }
  const errorNode = document.querySelector("#login-error");
  errorNode.textContent = "";
  const button = loginForm.querySelector("button[type=submit]");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.classList.add("is-loading");
  button.textContent = "正在验证…";
  try {
    const form = new FormData(loginForm);
    const result = await api("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ username: form.get("username"), password: form.get("password"), client_type: "web" }) }, false);
    state.csrf = result.csrf_token;
    if (result.password_change_required) {
      loginForm.classList.add("hidden");
      passwordForm.classList.remove("hidden");
      setPendingCurrentPassword(form.get("password"));
      document.querySelector("#new-password").focus();
    } else {
      await showApp();
    }
  } catch (error) {
    errorNode.textContent = error.message;
    document.querySelector("#login-username").setAttribute("aria-invalid", "true");
    document.querySelector("#login-password").setAttribute("aria-invalid", "true");
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.classList.remove("is-loading");
    button.textContent = "登录控制中心";
  }
});

loginForm.addEventListener("input", () => {
  document.querySelector("#login-username").removeAttribute("aria-invalid");
  document.querySelector("#login-password").removeAttribute("aria-invalid");
  document.querySelector("#login-error").textContent = "";
});

passwordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!passwordForm.checkValidity()) {
    passwordForm.reportValidity();
    return;
  }
  const errorNode = document.querySelector("#password-error");
  errorNode.textContent = "";
  const form = new FormData(passwordForm);
  const button = passwordForm.querySelector("button[type=submit]");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.classList.add("is-loading");
  const original = button.textContent;
  button.textContent = "正在保存…";
  try {
    await api("/api/v1/auth/password/change", { method: "POST", body: JSON.stringify({ current_password: pendingCurrentPassword ?? form.get("current_password"), new_password: form.get("new_password") }) }, false);
    passwordForm.reset();
    showLogin("密码已修改，请使用新密码重新登录");
  } catch (error) {
    errorNode.textContent = error.message;
    document.querySelector("#new-password").setAttribute("aria-invalid", "true");
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.classList.remove("is-loading");
    button.textContent = original;
  }
});

passwordForm.addEventListener("input", () => {
  document.querySelector("#new-password").removeAttribute("aria-invalid");
  document.querySelector("#password-error").textContent = "";
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  try { await api("/api/v1/auth/logout", { method: "POST", body: "{}" }, false); } catch {}
  state.socket?.close();
  showLogin("已安全退出");
});

function scheduleRealtimeReconnect() {
  window.clearTimeout(state.socketReconnectTimer);
  if (!state.me) return;
  state.socketReconnectTimer = window.setTimeout(connectRealtime, 3000);
}

function connectRealtime() {
  window.clearTimeout(state.socketReconnectTimer);
  state.socketReconnectTimer = null;
  const previous = state.socket;
  state.socket = null;
  previous?.close();
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  let socket;
  try {
    socket = new WebSocket(`${protocol}//${location.host}/api/v1/ws`);
  } catch {
    scheduleRealtimeReconnect();
    return;
  }
  state.socket = socket;
  socket.addEventListener("message", (event) => {
    if (state.socket !== socket) return;
    try {
      const message = JSON.parse(event.data);
      if (["config.version.changed", "subject.revoked", "runtime.state.changed", "traffic.speed.updated"].includes(message.event)) {
        window.clearTimeout(state.refreshTimer);
        state.refreshTimer = window.setTimeout(() => renderView(state.currentView), 700);
      }
    } catch {}
  });
  socket.addEventListener("close", () => {
    if (state.socket !== socket) return;
    state.socket = null;
    scheduleRealtimeReconnect();
  });
}

(async () => {
  await loadPublicConfig();
  if (!location.pathname.startsWith("/admin")) {
    document.body.classList.remove("auth-active");
    landingScreen.classList.remove("hidden");
    authScreen.classList.add("hidden");
    appShell.classList.add("hidden");
    skipLink.href = "#landing-content";
    await loadLatestRelease();
    return;
  }
  try {
    await refreshSession();
    await showApp();
  } catch {
    showLogin();
  }
})();
