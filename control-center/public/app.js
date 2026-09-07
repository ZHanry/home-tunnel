import { createConnectionsView } from "./modules/connections.js?v=5.0.0-modules1";
import {
  formSnapshot,
  restoreSnapshot,
  clearFieldErrors,
  showFieldErrors,
  setBusy,
  changedFields,
} from "./modules/forms.js?v=5.0.0-modules1";
import { api, refreshSession } from "./modules/api.js?v=5.0.0-modules1";
import {
  componentLabel,
  configState,
  escapeHtml,
  formatBps,
  formatBytes,
  formatDate,
  statusBadge,
} from "./modules/format.js?v=5.0.0-modules1";
import { localeTag, updateDocumentMetadata } from "./modules/locale.js?v=5.0.0-modules1";
import { connectRealtime, disconnectRealtime } from "./modules/realtime.js?v=5.0.0-modules1";
import { state } from "./modules/state.js?v=5.0.0-modules1";

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

const { renderConnections } = createConnectionsView({
  api,
  state,
  isAdmin,
  connectionsPath,
  devicesPath,
  annotateOwnedConnections,
  updateTransportTunnelState,
  viewContent,
  escapeHtml,
  emptyState,
  publicAddress,
  isRawProxy,
  statusBadge,
  connectionDiagnostic,
  accessBadges,
});

const viewMeta = {
  dashboard: ["系统总览", "运行状态"],
  users: ["用户管理", "身份与权限"],
  devices: ["设备管理", "设备信任"],
  connections: ["连接管理", "受管隧道"],
  audit: ["审计事件", "操作轨迹"],
  settings: ["系统设置", "部署策略"],
  account: ["我的账号", "密码与使用额度"],
};

const userViewMeta = {
  dashboard: ["我的工作区", "只显示你的设备与隧道"],
  devices: ["我的设备", "已登记的机器"],
  connections: ["我的隧道", "HTTP 自助开通"],
};

function isAdmin() {
  return state.me?.role === "admin";
}

function applyRoleChrome() {
  document.querySelectorAll("[data-admin-only]").forEach((item) => {
    item.hidden = !isAdmin();
  });
  const brand = document.querySelector(".sidebar-brand .brand-copy small");
  if (brand) brand.textContent = isAdmin() ? "控制中心 v5.0.0" : "我的工作区";
  const sessionCopy = document.querySelector(".sidebar-session small");
  if (sessionCopy) sessionCopy.textContent = isAdmin() ? "权限已验证" : "仅显示你的资源";
}

function resolveView(view) {
  if (!isAdmin() && (view === "users" || view === "audit" || view === "settings"))
    return "dashboard";
  return viewMeta[view] ? view : "dashboard";
}

function viewLabels(view) {
  if (!isAdmin() && userViewMeta[view]) return userViewMeta[view];
  return viewMeta[view];
}

function devicesPath() {
  return isAdmin() ? "/api/v1/admin/devices" : "/api/v1/client/devices";
}

function connectionsPath(id = "") {
  const base = isAdmin() ? "/api/v1/admin/connections" : "/api/v1/client/connections";
  return id ? `${base}/${id}` : base;
}

function customDomainsPath(connectionId) {
  return `${connectionsPath(connectionId)}/custom-domains`;
}

function customDomainItemPath(domainId, action = "") {
  const base = isAdmin()
    ? `/api/v1/admin/custom-domains/${domainId}`
    : `/api/v1/client/custom-domains/${domainId}`;
  return action ? `${base}/${action}` : base;
}

async function navigateTo(view, replace = false) {
  if (!viewMeta[view]) return;
  const hash = `#${view}`;
  if (location.hash !== hash) {
    if (replace) history.replaceState(null, "", hash);
    else history.pushState(null, "", hash);
  }
  await renderView(view);
}

async function loadPublicConfig() {
  try {
    const response = await fetch("/api/v1/public/config", {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    if (!response.ok) return;
    const value = await response.json();
    if (typeof value.tunnel_domain !== "string" || !/^[a-z0-9.-]{1,253}$/.test(value.tunnel_domain))
      return;
    state.tunnelDomain = value.tunnel_domain;
    state.prefixPolicy =
      value.subdomain_prefix_policy === "off" || value.subdomain_prefix_policy === "enforce"
        ? value.subdomain_prefix_policy
        : "suggest";
    document.querySelectorAll("[data-example-subdomain]").forEach((node) => {
      node.textContent = `https://${node.dataset.exampleSubdomain}.${state.tunnelDomain}`;
    });
  } catch {}
}

function toast(message, type = "success") {
  const item = document.createElement("div");
  item.className = `toast ${type === "error" ? "error" : ""}`;
  item.textContent = message;
  toastRegion.append(item);
  window.setTimeout(() => item.remove(), 4500);
}

function updateTransportTunnelState(payload) {
  const incoming = payload?.transport_tunnels;
  if (incoming?.tcp && incoming?.udp) {
    state.transportTunnels = { tcp: incoming.tcp, udp: incoming.udp };
    return;
  }
  if (incoming?.protocols) {
    for (const protocol of ["tcp", "udp"]) {
      state.transportTunnels[protocol] = {
        enabled: incoming.protocols.includes(protocol),
        port_start: incoming.port_start,
        port_end: incoming.port_end,
      };
    }
    return;
  }
  if (payload?.tcp_tunnels) state.transportTunnels.tcp = payload.tcp_tunnels;
}

function isRawProxy(proxyType) {
  return proxyType === "tcp" || proxyType === "udp";
}

function transportSettings(proxyType) {
  return (
    state.transportTunnels[proxyType] ?? {
      enabled: false,
      port_start: 10000,
      port_end: 10099,
    }
  );
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
  if (modal.open) {
    rememberDraft();
    modal.close("session");
  }
  state.users = [];
  state.devices = [];
  state.connections = [];
  state.me = null;
  state.csrf = "";
  setPendingCurrentPassword(null);
  document.querySelector("#login-password").value = "";
  disconnectRealtime();
  landingScreen.classList.add("hidden");
  appShell.classList.add("hidden");
  authScreen.classList.remove("hidden");
  skipLink.href = "#auth-screen";
  updateDocumentMetadata();
  loginForm.classList.remove("hidden");
  passwordForm.classList.add("hidden");
  document.querySelector("#login-error").textContent = message;
  window.setTimeout(() => document.querySelector("#login-username").focus(), 0);
}

async function showApp() {
  document.body.classList.remove("auth-active");
  state.me = await api("/api/v1/auth/me");
  landingScreen.classList.add("hidden");
  authScreen.classList.add("hidden");
  appShell.classList.remove("hidden");
  skipLink.href = "#main-content";
  applyRoleChrome();
  updateDocumentMetadata();
  document.querySelector("#current-user").textContent = state.me.display_name;
  document.querySelector(".user-chip small").textContent = state.me.username;
  document.querySelector("#user-avatar").textContent = state.me.display_name
    .slice(0, 1)
    .toUpperCase();
  connectRealtime(() => renderView(state.currentView, { background: true }));
  const requested = location.hash.replace("#", "");
  const view = resolveView(requested);
  if (location.hash !== `#${view}`) history.replaceState(null, "", `#${view}`);
  await renderView(view);
}

function loadingView(view) {
  viewContent.setAttribute("aria-busy", "true");
  viewContent.innerHTML =
    view === "dashboard"
      ? `<div class="metrics-grid" aria-hidden="true"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div><div class="skeleton skeleton-table" aria-hidden="true"></div>`
      : `<div class="skeleton skeleton-table" aria-hidden="true"></div>`;
}

function renderPageActions(view) {
  const actions = {
    dashboard: `<button class="button button-secondary" data-action="refresh-view">刷新数据</button><button class="button button-primary" data-action="create-connection">创建连接</button>`,
    account: `<button class="button button-secondary" data-action="refresh-view">刷新额度</button>`,
    users: `<button class="button button-primary" data-action="create-user">创建普通用户</button>`,
    devices: `<button class="button button-secondary" data-action="refresh-view">刷新状态</button>`,
    connections: `<button class="button button-primary" data-action="create-connection">创建连接</button>`,
    audit: `<button class="button button-secondary" data-action="refresh-view">刷新事件</button>`,
    settings: `<button class="button button-secondary" data-action="refresh-view">刷新设置</button>`,
  };
  pageActions.innerHTML = actions[view] ?? "";
}

async function renderView(view, { background = false } = {}) {
  if (
    background &&
    (document.hidden ||
      modal.open ||
      viewContent.dataset.dirty === "true" ||
      viewContent.querySelector("input:focus,select:focus,textarea:focus"))
  ) {
    state.pendingRefresh = true;
    updateSyncStatus("有新状态；完成编辑后点击刷新");
    return;
  }
  const previousKey = `${state.me?.id}:${state.currentView}`;
  if (!background && viewContent.dataset.dirty === "true")
    pageDrafts.set(
      previousKey,
      [...viewContent.querySelectorAll("form")].map((form) => [form.id, formSnapshot(form)]),
    );
  const savedForms = background
    ? [...viewContent.querySelectorAll("form")].map((form) => [form.id, formSnapshot(form)])
    : [];
  if (!background) viewContent.dataset.dirty = "false";
  const renderId = ++state.renderId;
  view = resolveView(view);
  state.currentView = view;
  document
    .querySelectorAll(".nav-item")
    .forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  const [title, eyebrow] = viewLabels(view);
  pageTitle.textContent = title;
  pageEyebrow.textContent = eyebrow;
  renderPageActions(view);
  if (!background) loadingView(view);
  try {
    if (view === "dashboard") await renderDashboard(renderId);
    if (view === "users") await renderUsers(renderId);
    if (view === "devices") await renderDevices(renderId);
    if (view === "connections") await renderConnections(renderId);
    if (view === "audit") await renderAudit(renderId);
    if (view === "settings") await renderSettings(renderId);
    if (view === "account") await renderAccount(renderId);
    if (renderId !== state.renderId) return;
    viewContent.setAttribute("aria-busy", "false");
    for (const [id, values] of savedForms) {
      const form = document.getElementById(id);
      if (form) restoreSnapshot(form, values);
    }
    if (!background) {
      const draft = pageDrafts.get(`${state.me?.id}:${view}`);
      if (draft) {
        for (const [id, values] of draft) {
          const form = document.getElementById(id);
          if (form) restoreSnapshot(form, values);
        }
        viewContent.dataset.dirty = "true";
      }
    }
    state.lastSync = Date.now();
    state.pendingRefresh = false;
    updateSyncStatus("已同步 · " + new Date(state.lastSync).toLocaleTimeString(localeTag()));
    if (!background) document.querySelector("#main-content").focus({ preventScroll: true });
  } catch (error) {
    if (renderId !== state.renderId) return;
    viewContent.setAttribute("aria-busy", "false");
    if (error.code === "SESSION_REVOKED") {
      showLogin("会话已失效，请重新登录");
      return;
    }
    if (background) {
      updateSyncStatus("连接中断，显示上次同步的数据；点击刷新重试");
      return;
    }
    viewContent.innerHTML = `<div class="panel"><div class="empty-state"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg><strong>无法加载数据</strong><span>${escapeHtml(error.message)}</span><button class="button button-secondary" data-action="refresh-view">重试</button></div></div>`;
  }
}

async function renderDashboard(renderId) {
  if (!isAdmin()) {
    await renderUserDashboard(renderId);
    return;
  }
  const [summary, traffic, health] = await Promise.all([
    api("/api/v1/admin/summary"),
    api("/api/v1/admin/traffic/summary?hours=24"),
    api("/api/v1/admin/system/health"),
  ]);
  if (renderId !== state.renderId) return;
  updateTransportTunnelState(summary);
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
          <span class="status-badge ${health.status === "healthy" ? "ok" : health.status === "unhealthy" ? "error" : "warn"}">${health.status === "healthy" ? "系统运行正常" : health.status === "unhealthy" ? "系统异常" : "系统需要处理"}</span>
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
        <div class="health-rail-list">${health.components
          .map((item) => {
            const tone =
              item.status === "healthy" ? "" : item.status === "unhealthy" ? "error" : "warn";
            const label =
              { healthy: "正常", unhealthy: "异常", degraded: "需要处理", unknown: "待确认" }[
                item.status
              ] ?? "待确认";
            const detail =
              item.component === "backup"
                ? item.completed_at
                  ? `${label} · ${formatDate(item.completed_at)}`
                  : "待确认 · 尚无备份记录"
                : item.component === "outbox"
                  ? `${label} · 待处理 ${Number(item.pending ?? 0)}`
                  : `${label}${item.latency_ms == null ? "" : ` · ${Number(item.latency_ms).toLocaleString(localeTag())} ms`}`;
            return `<div class="health-rail-item ${tone}" title="${escapeHtml(item.message || detail)}">
            <span class="health-rail-dot"></span>
            <span class="health-rail-name">${escapeHtml(componentLabel(item.component))}</span>
            <span class="health-rail-val">${detail}</span>
          </div>`;
          })
          .join("")}</div>
      </section>
    </div>

    <section class="stats-strip-grid" aria-label="关键补充统计">
      <article class="stat-strip-item">
        <span class="stat-strip-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m7-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.9"/></svg></span>
        <div class="stat-strip-info">
          <span class="stat-strip-label">启用账号</span>
          <strong class="stat-strip-val">${Number(summary.users).toLocaleString(localeTag())}</strong>
        </div>
      </article>
      <article class="stat-strip-item">
        <span class="stat-strip-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 2h14a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm3 17h8"/></svg></span>
        <div class="stat-strip-info">
          <span class="stat-strip-label">在线设备</span>
          <strong class="stat-strip-val">${Number(summary.online_devices).toLocaleString(localeTag())}</strong>
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
      ${
        traffic.items.length
          ? `<table class="data-table"><thead><tr><th>连接</th><th>用户</th><th>上传</th><th>下载</th><th>请求</th></tr></thead><tbody>${traffic.items
              .slice(0, 6)
              .map(
                (item) =>
                  `<tr><td data-label="连接"><span class="cell-primary" data-no-translate>${escapeHtml(item.name)}</span><span class="cell-secondary mono" data-no-translate>${escapeHtml(item.subdomain)}.${escapeHtml(state.tunnelDomain)}</span></td><td data-label="用户">${escapeHtml(item.username)}</td><td data-label="上传" class="mono">${formatBytes(item.upload_bytes)}</td><td data-label="下载" class="mono">${formatBytes(item.download_bytes)}</td><td data-label="请求" class="mono">${Number(item.requests).toLocaleString(localeTag())}</td></tr>`,
              )
              .join("")}</tbody></table>`
          : emptyState("暂无流量样本", "网关收到业务请求后会按 10 秒桶写入样本。")
      }
    </section>`;
}

function emptyState(title, detail, action, actionLabel) {
  const button = action
    ? `<button class="button button-primary" data-action="${escapeHtml(action)}">${escapeHtml(actionLabel ?? "继续")}</button>`
    : "";
  return `<div class="empty-state"><span class="empty-state-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v16H4zM8 9h8M8 13h5"/></svg></span><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span>${button}</div>`;
}

function publicAddress(connection) {
  return (
    connection.public_url ||
    connection.public_endpoint ||
    `${connection.subdomain}.${state.tunnelDomain}`
  );
}

function copyableAddress(connection) {
  const address = publicAddress(connection);
  const href = connection.public_url
    ? `<a class="cell-secondary mono" href="${escapeHtml(connection.public_url)}" target="_blank" rel="noopener">${escapeHtml(connection.public_url)}</a>`
    : `<span class="cell-secondary mono" data-no-translate>${escapeHtml(address)}</span>`;
  return `<div class="connection-card-url">${href}<button class="icon-button copy-button" type="button" data-copy="${escapeHtml(address)}" aria-label="复制公网地址">复制</button></div>`;
}

function annotateOwnedConnections(connections, devices) {
  return connections.map((item) => ({
    ...item,
    username: item.username || state.me?.username || "",
    device_name:
      item.device_name || devices.find((device) => device.id === item.device_id)?.name || "设备",
  }));
}

async function renderUserDashboard(renderId) {
  const [devicesPayload, connectionsPayload, trafficPayload] = await Promise.all([
    api("/api/v1/client/devices"),
    api("/api/v1/client/connections"),
    api("/api/v1/client/traffic/summary"),
  ]);
  if (renderId !== state.renderId) return;
  state.devices = devicesPayload.items;
  state.connections = annotateOwnedConnections(connectionsPayload.items, state.devices);
  const trafficByConnection = new Map(
    (trafficPayload.items ?? []).map((item) => [item.connection_id, item]),
  );
  const ranked = state.connections
    .map((connection) => {
      const sample = trafficByConnection.get(connection.id);
      return {
        ...connection,
        upload_bytes: Number(sample?.upload_bytes ?? 0),
        download_bytes: Number(sample?.download_bytes ?? 0),
        requests: Number(sample?.request_count ?? 0),
      };
    })
    .sort(
      (left, right) =>
        right.upload_bytes + right.download_bytes - (left.upload_bytes + left.download_bytes),
    );
  const totalTraffic = ranked.reduce(
    (sum, item) => sum + item.upload_bytes + item.download_bytes,
    0,
  );
  const onlineConnections = state.connections.filter(
    (item) => item.enabled && item.state === "Online",
  ).length;
  const onlineDevices = state.devices.filter((item) => item.online).length;
  viewContent.innerHTML = `
    <div class="dashboard-hero-layout">
      <section class="panel tunnel-pulse-card" aria-label="我的隧道">
        <div class="pulse-header">
          <div class="pulse-brand">
            <span class="pulse-dot"></span>
            <div>
              <h3>我的工作区</h3>
              <p>只包含 ${escapeHtml(state.me.display_name)} 的设备与隧道，其他租户不可见</p>
            </div>
          </div>
          <span class="status-badge ok">租户隔离</span>
        </div>
        <div class="pulse-core-metrics">
          <div class="pulse-metric-item">
            <span class="pulse-label">在线 / 我的连接</span>
            <div class="pulse-value-large">${onlineConnections} <small>/ ${state.connections.length}</small></div>
            <span class="pulse-meta">HTTP 可自助开通 · TCP/UDP 由管理员分配端口</span>
          </div>
          <div class="pulse-metric-item">
            <span class="pulse-label">累计流量</span>
            <div class="pulse-value-large">${formatBytes(totalTraffic)}</div>
            <span class="pulse-meta">仅统计你名下的连接</span>
          </div>
        </div>
      </section>
    </div>
    <section class="stats-strip-grid stats-strip-grid-2" aria-label="我的资源">
      <article class="stat-strip-item">
        <span class="stat-strip-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 2h14a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm3 17h8"/></svg></span>
        <div class="stat-strip-info">
          <span class="stat-strip-label">在线设备</span>
          <strong class="stat-strip-val">${onlineDevices.toLocaleString(localeTag())} / ${state.devices.length}</strong>
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
          <h3>我的连接</h3>
          <span class="panel-subtle">创建连接以发布家庭服务；设备需先在家里注册</span>
        </div>
      </div>
      ${
        ranked.length
          ? `<table class="data-table"><thead><tr><th>连接</th><th>设备</th><th>上传</th><th>下载</th><th>请求</th></tr></thead><tbody>${ranked
              .slice(0, 6)
              .map(
                (item) =>
                  `<tr><td data-label="连接"><span class="cell-primary" data-no-translate>${escapeHtml(item.name)}</span>${copyableAddress(item)}</td><td data-label="设备">${escapeHtml(item.device_name)}</td><td data-label="上传" class="mono">${formatBytes(item.upload_bytes)}</td><td data-label="下载" class="mono">${formatBytes(item.download_bytes)}</td><td data-label="请求" class="mono">${item.requests.toLocaleString(localeTag())}</td></tr>`,
              )
              .join("")}</tbody></table>`
          : emptyState(
              "还没有隧道",
              "先在家里的电脑上安装客户端并登录，然后在这里创建 HTTP 连接。",
              "create-connection",
              "创建连接",
            )
      }
    </section>`;
}

async function renderUsers(renderId = state.renderId) {
  if (!isAdmin()) {
    await renderView("dashboard");
    return;
  }
  const data = await api("/api/v1/admin/users");
  if (renderId !== state.renderId) return;
  state.users = data.items;
  viewContent.innerHTML = `
    <section class="panel table-panel">${state.users.length ? `<table class="data-table"><thead><tr><th>用户</th><th>角色</th><th>状态</th><th>设备 / 连接</th><th>账号上限</th><th>本月流量</th><th><span class="visually-hidden">操作</span></th></tr></thead><tbody>${state.users.map((user) => `<tr><td data-label="用户"><span class="cell-primary" data-no-translate>${escapeHtml(user.display_name)}</span><span class="cell-secondary mono" data-no-translate>${escapeHtml(user.username)}</span></td><td data-label="角色">${user.role === "admin" ? "管理员" : "普通用户"}</td><td data-label="状态">${statusBadge(user.status)} ${user.password_state === "must_change" ? statusBadge("must_change") : ""} ${user.quota_suspended ? statusBadge("quota_suspended") : ""}</td><td data-label="设备 / 连接" class="mono">${user.device_count} / ${user.connection_count}</td><td data-label="账号上限" class="mono">${formatBps(user.bandwidth_limit_bps)}</td><td data-label="本月流量" class="mono">${formatBytes(user.month_to_date_bytes)}${user.monthly_quota_bytes ? ` / ${formatBytes(user.monthly_quota_bytes)}` : ""}</td><td class="actions-cell" data-label="操作"><div class="actions"><button class="button button-quiet button-small" data-action="user-policy" data-id="${user.id}">限速</button><button class="button button-quiet button-small" data-action="reset-password" data-id="${user.id}">重置密码</button><button class="button ${user.status === "active" ? "button-danger" : "button-secondary"} button-small" data-action="toggle-user" data-id="${user.id}" data-status="${user.status}">${user.status === "active" ? "禁用" : "恢复"}</button></div></td></tr>`).join("")}</tbody></table>` : emptyState("还没有用户", "创建首个普通用户，并把一次性临时密码安全交给本人。", "create-user", "创建普通用户")}</section>`;
}

async function renderDevices(renderId = state.renderId) {
  const data = await api(devicesPath());
  if (renderId !== state.renderId) return;
  state.devices = data.items;
  const deleteCell = (device) =>
    isAdmin()
      ? `<td class="actions-cell" data-label="操作"><div class="actions"><button class="button button-danger button-small" data-action="delete-device" data-id="${device.id}" data-name="${escapeHtml(device.name)}" aria-label="删除设备 ${escapeHtml(device.name)}">删除</button></div></td>`
      : `<td class="actions-cell" data-label="操作"><span class="cell-secondary">由客户端保活</span></td>`;
  viewContent.innerHTML = `
    <section class="panel table-panel">${state.devices.length ? `<table class="data-table"><thead><tr><th>设备</th><th>用户</th><th>状态</th><th>配置</th><th class="hide-tablet">最后在线</th><th class="hide-tablet">租约到期</th><th><span class="visually-hidden">操作</span></th></tr></thead><tbody>${state.devices.map((device) => `<tr><td data-label="设备"><span class="cell-primary" data-no-translate>${escapeHtml(device.name)}</span><span class="cell-secondary mono" data-no-translate>${escapeHtml(device.id.slice(0, 8))} · 客户端 ${escapeHtml(device.client_version ?? "未知")} · Agent ${escapeHtml(device.agent_version ?? "未知")}</span></td><td data-label="用户">${escapeHtml(device.username ?? state.me.username)}</td><td data-label="状态">${statusBadge(device.status === "active" && device.online ? "active" : device.status === "active" ? "Offline" : device.status)}</td><td data-label="配置">${configState(device)}</td><td data-label="最后在线" class="hide-tablet">${formatDate(device.last_seen_at)}</td><td data-label="租约到期" class="hide-tablet">${formatDate(device.lease_expires_at)}</td>${deleteCell(device)}</tr>`).join("")}</tbody></table>` : emptyState("还没有注册设备", isAdmin() ? "请用户在家里的 Windows / macOS / Linux 电脑上安装图形客户端并登录。" : "在家里的电脑上安装客户端，用当前账号登录后设备会出现在这里。")}</section>`;
}

// 访问控制徽章：只依据 access_basic_auth_enabled / access_ip_allowlist 展示
// 状态摘要，绝不涉及口令或哈希。
function accessBadges(connection) {
  const badges = [];
  if (connection.access_ip_allowlist?.length) {
    badges.push(
      `<span class="status-badge ok" title="${escapeHtml(connection.access_ip_allowlist.join(", "))}">IP 白名单 ×${connection.access_ip_allowlist.length}</span>`,
    );
  }
  if (connection.access_basic_auth_enabled)
    badges.push('<span class="status-badge ok">Basic Auth</span>');
  return badges.length ? badges.join(" ") : '<span class="cell-secondary">开放</span>';
}

async function renderSettings(renderId = state.renderId) {
  if (!isAdmin()) {
    await renderView("dashboard");
    return;
  }
  const data = await api("/api/v1/admin/settings");
  if (renderId !== state.renderId) return;
  const policy = data.subdomain_prefix_policy ?? "suggest";
  viewContent.innerHTML = `
    <section class="panel">
      <div class="panel-header"><div><h3>子域命名策略</h3><span class="panel-subtle">默认建议带用户名前缀，避免多人抢同一个短名。强制后新建 HTTP 子域必须以用户名开头。</span></div></div>
      <form id="settings-form" class="form-stack" style="padding:20px">
        <div class="field">
          <label for="prefix-policy">新建子域</label>
          <select id="prefix-policy" name="subdomain_prefix_policy">
            <option value="off" ${policy === "off" ? "selected" : ""}>不干预，先到先得</option>
            <option value="suggest" ${policy === "suggest" ? "selected" : ""}>建议使用用户名前缀（默认）</option>
            <option value="enforce" ${policy === "enforce" ? "selected" : ""}>强制 {用户名}-{名称}</option>
          </select>
        </div>
        <button class="button button-primary" type="submit">保存设置</button>
      </form>
    </section>`;
}

async function renderAudit(renderId = state.renderId) {
  if (!isAdmin()) {
    await renderView("dashboard");
    return;
  }
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
    <section class="panel table-panel audit-table-panel">${data.items.length ? `<table class="data-table"><thead><tr><th>时间</th><th>动作</th><th>操作者</th><th>目标</th><th>Request ID</th></tr></thead><tbody>${data.items.map((item) => `<tr><td data-label="时间">${formatDate(item.created_at)}</td><td data-label="动作"><span class="cell-primary" data-no-translate>${escapeHtml(item.action)}</span><span class="cell-secondary">${escapeHtml(item.actor_type)}</span></td><td data-label="操作者" class="mono">${escapeHtml(item.actor_id?.slice(0, 8) ?? "system")}</td><td data-label="目标"><span class="cell-primary" data-no-translate>${escapeHtml(item.target_type)}</span><span class="cell-secondary mono" data-no-translate>${escapeHtml(item.target_id?.slice(0, 16) ?? "—")}</span></td><td data-label="Request ID" class="mono">${escapeHtml(item.request_id)}</td></tr>`).join("")}</tbody></table>` : emptyState("没有匹配的审计事件", "调整筛选条件后重试。")}
      <footer class="pagination" aria-label="审计事件分页"><span>显示 ${first}–${last}，共 ${total.toLocaleString(localeTag())} 条</span><div><button class="button button-quiet button-small" data-action="audit-page" data-page="${state.audit.page - 1}" ${state.audit.page <= 1 ? "disabled" : ""}>上一页</button><span class="pagination-current">第 ${state.audit.page} / ${totalPages} 页</span><button class="button button-quiet button-small" data-action="audit-page" data-page="${state.audit.page + 1}" ${state.audit.page >= totalPages ? "disabled" : ""}>下一页</button></div></footer>
    </section>`;
}

function field(name, label, value = "", options = {}) {
  const type = options.type ?? "text";
  const attrs = [
    type === "number" ? `step="${options.step ?? (options.min === 0.1 ? "any" : "1")}"` : "",
    options.required !== false ? "required" : "",
    options.min ? `min="${options.min}"` : "",
    options.max ? `max="${options.max}"` : "",
    options.minlength ? `minlength="${options.minlength}"` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const helperId = `modal-${name}-helper`;
  return `<div class="field ${options.full ? "full" : ""}"><label for="modal-${name}">${escapeHtml(label)}</label><input id="modal-${name}" name="${escapeHtml(name)}" type="${escapeHtml(type)}" value="${escapeHtml(value)}" ${options.helper ? `aria-describedby="${helperId}"` : ""} ${attrs}>${options.helper ? `<p class="helper" id="${helperId}">${escapeHtml(options.helper)}</p>` : ""}</div>`;
}

const pageDrafts = new Map();
const modalDrafts = new Map();
let modalBaseline = "";
let modalDraftKey = "";
let modalSaving = false;

function updateSyncStatus(message) {
  const node = document.querySelector("#sync-status");
  if (node) node.textContent = message;
}

function modalDirty() {
  return JSON.stringify(formSnapshot(modalForm, true)) !== modalBaseline;
}
function rememberDraft() {
  if (modalDraftKey && modalDirty()) modalDrafts.set(modalDraftKey, formSnapshot(modalForm));
}
function requestModalClose() {
  if (modalSaving) {
    modalError.textContent = "正在保存，请稍候。完成后会显示结果。";
    return;
  }
  if (modalDirty()) {
    rememberDraft();
    toast("已保留未提交的内容，重新打开可继续编辑");
  }
  modal.close("cancel");
}

function openModal({
  title,
  eyebrow = "操作",
  body,
  submitLabel = "保存",
  danger = false,
  onSubmit,
}) {
  modalDraftKey = `${state.me?.id ?? ""}:${title}`;
  modalSaving = false;
  delete modal.dataset.connectionId;
  delete modal.dataset.ownerId;
  delete modal.dataset.policyUserId;
  modal.conflictResource = null;
  modalTitle.textContent = title;
  modalEyebrow.textContent = eyebrow;
  modalError.textContent = "";
  modalBody.innerHTML = body;
  const advanced = modalBody.querySelector("#modal-http-options");
  if (advanced) {
    const details = document.createElement("details");
    details.className = "advanced-options";
    const summary = document.createElement("summary");
    summary.textContent = "访问保护与带宽设置";
    details.append(summary, ...advanced.childNodes);
    advanced.append(details);
  }
  const host = modalBody.querySelector('[name="local_host"]');
  if (host) {
    const help = document.createElement("p");
    help.className = "helper";
    help.textContent =
      "这里的地址相对于所选家庭设备；127.0.0.1 指该设备本身。也可以粘贴完整 http(s) 地址自动填写协议与端口。";
    host.parentElement.append(help);
    host.addEventListener("input", () => {
      if (!/^https?:\/\//i.test(host.value)) return;
      try {
        const url = new URL(host.value);
        const scheme = modalForm.elements.namedItem("local_scheme"),
          port = modalForm.elements.namedItem("local_port");
        if (scheme && !scheme.disabled) scheme.value = url.protocol.slice(0, -1);
        if (port) port.value = url.port || (url.protocol === "https:" ? "443" : "80");
        host.value = url.hostname;
      } catch {
        /* keep input for correction */
      }
    });
  }
  modalBaseline = JSON.stringify(formSnapshot(modalForm, true));
  const draft = modalDrafts.get(modalDraftKey);
  modal.dataset.restored = draft ? "true" : "false";
  if (draft) {
    restoreSnapshot(modalForm, draft);
    modalError.textContent = "已恢复上次未提交的内容，请核对后保存。";
  }
  modalFooter.innerHTML = `<button class="button button-quiet" type="button" data-modal-cancel>取消</button><button class="button ${danger ? "button-danger" : "button-primary"}" type="submit">${escapeHtml(submitLabel)}</button>`;
  modalFooter.querySelector("[data-modal-cancel]").addEventListener("click", requestModalClose);
  modalForm.onsubmit = async (event) => {
    event.preventDefault();
    if (modalSaving) return;
    clearFieldErrors(modalForm);
    if (!modalForm.checkValidity()) {
      modalForm.querySelector(":invalid")?.closest("details")?.setAttribute("open", "");
      modalForm.reportValidity();
      return;
    }
    const button = modalFooter.querySelector("button[type=submit]");
    modalSaving = true;
    setBusy(button, true, "处理中…");
    modalError.textContent = "";
    const key = modalDraftKey;
    try {
      await onSubmit(new FormData(modalForm), button);
      modalDrafts.delete(key);
      modalBaseline = JSON.stringify(formSnapshot(modalForm, true));
    } catch (error) {
      rememberDraft();
      modalError.textContent = error.message;
      if (!showFieldErrors(modalForm, error)) modalError.focus({ preventScroll: true });
      if (error.code === "VERSION_CONFLICT" && modal.conflictResource) {
        const reload = document.createElement("button");
        reload.type = "button";
        reload.className = "button button-secondary";
        reload.textContent = "读取最新版本并保留我的修改";
        reload.addEventListener("click", async () => {
          setBusy(reload, true, "读取中…");
          try {
            const previous = modal.conflictResource;
            const latest = modal.dataset.connectionId
              ? await api(connectionsPath(modal.dataset.connectionId))
              : (await api("/api/v1/admin/users")).items.find(
                  (u) => u.id === modal.dataset.policyUserId,
                );
            if (!latest) throw new Error("资源已不存在，请关闭并刷新列表");
            const changes = [
              "name",
              "local_host",
              "local_port",
              "enabled",
              "subdomain",
              "bandwidth_limit_bps",
              "monthly_quota_bytes",
            ].filter((key) => JSON.stringify(previous[key]) !== JSON.stringify(latest[key]));
            previous.version = latest.version;
            previous.policy_version = latest.policy_version;
            modalError.textContent = `已读取最新版本。服务器变化字段：${changes.join("、") || "版本"}。你的输入仍保留；再次保存只提交你修改过的字段。`;
          } catch (failure) {
            modalError.textContent = failure.message;
          }
        });
        modalError.append(document.createElement("br"), reload);
      }
    } finally {
      modalSaving = false;
      if (button.isConnected) setBusy(button, false);
    }
  };
  if (!modal.open) modal.showModal();
  window.setTimeout(
    () => modalBody.querySelector("input:not([type=hidden]),select,button")?.focus(),
    0,
  );
}

function connectionDiagnostic(connection) {
  if (!connection.enabled) return "已暂停。公网访问停止，启用后会重新应用配置。";
  const device = state.devices.find((item) => item.id === connection.device_id);
  if (device && !device.online) return "等待家庭设备上线。请检查电脑电源、客户端登录与网络。";
  if (connection.last_error_code)
    return "连接运行异常。请检查家庭设备上的目标服务和端口，再同步配置。";
  if (connection.state === "Online") return "隧道已上线。请打开地址检查目标应用是否响应。";
  return "配置已保存，等待家庭设备应用。若持续等待，请查看客户端状态。";
}

async function renderAccount(renderId) {
  const me = await api("/api/v1/auth/me");
  if (renderId !== state.renderId) return;
  state.me = me;
  viewContent.innerHTML = `<section class="panel account-panel"><div class="panel-header"><div><h3 data-no-translate>${escapeHtml(me.display_name)}</h3><p class="panel-subtle">我的账号与使用额度</p></div><button class="button button-secondary" data-action="change-password">修改密码</button></div><div class="account-metrics"><div><span>本月 Web 流量</span><strong>${formatBytes(me.month_to_date_bytes)}</strong></div><div><span>月度配额</span><strong>${me.monthly_quota_bytes == null ? "不限额" : formatBytes(me.monthly_quota_bytes)}</strong></div><div><span>账号共享带宽</span><strong>${formatBps(me.bandwidth_limit_bps)}</strong></div></div><p class="helper">每月按 UTC 自然月重置。下次重置：${formatDate(me.quota_resets_at)}。TCP/UDP 不经过 Web 网关，不包含在这里的流量与配额统计中。</p></section>`;
}

function changePassword() {
  openModal({
    title: "修改密码",
    body: `<p class="helper">密码修改后所有账号会话会退出，请使用新密码重新登录。</p>${field("current_password", "当前密码", "", { type: "password" })}${field("new_password", "新密码", "", { type: "password", minlength: 12, helper: "至少 12 个字符，且不能包含用户名" })}${field("confirm_password", "确认新密码", "", { type: "password", minlength: 12 })}`,
    onSubmit: async (form) => {
      if (form.get("new_password") !== form.get("confirm_password"))
        throw new Error("两次输入的新密码不一致");
      await api(
        "/api/v1/auth/password/change",
        {
          method: "POST",
          body: JSON.stringify({
            current_password: form.get("current_password"),
            new_password: form.get("new_password"),
          }),
        },
        false,
      );
      modal.close("saved");
      showLogin("密码已修改，请使用新密码重新登录");
    },
  });
}

function showConnectionDetails(id) {
  const c = state.connections.find((item) => item.id === id);
  if (!c) return;
  const raw = isRawProxy(c.proxy_type);
  openModal({
    title: `连接详情 · ${c.name}`,
    body: `<p class="detail-status">${statusBadge(c.enabled ? c.state : "disabled")}</p><p>${escapeHtml(connectionDiagnostic(c))}</p><dl class="connection-detail"><dt>公网地址</dt><dd data-no-translate>${escapeHtml(publicAddress(c))}</dd><dt>家庭设备</dt><dd data-no-translate>${escapeHtml(c.device_name)}</dd><dt>本地服务</dt><dd data-no-translate>${escapeHtml(raw ? c.proxy_type : c.local_scheme)}://${escapeHtml(c.local_host)}:${c.local_port}</dd><dt>配置进度</dt><dd>已应用 ${Number(c.applied_version ?? 0)} / 目标 ${Number(c.version)}</dd>${c.last_error_code ? `<dt>诊断代码</dt><dd data-no-translate>${escapeHtml(c.last_error_code)}</dd>` : ""}</dl><h3>排查步骤</h3><ol class="diagnostic-steps"><li>确认家庭设备开机，客户端已登录。</li><li>在家庭设备上访问本地服务地址，确认端口正确。</li><li>确认配置已同步，再从外部网络检查公网地址。</li><li>${raw ? "检查应用自身的认证、加密和公网端口防火墙。" : "如配置了 IP 白名单或访问口令，请确认访问条件。"}</li></ol>`,
    submitLabel: "知道了",
    onSubmit: () => modal.close("done"),
  });
}

viewContent.addEventListener("input", () => {
  viewContent.dataset.dirty = "true";
});
viewContent.addEventListener("change", () => {
  viewContent.dataset.dirty = "true";
});
window.addEventListener("session-expired", () => {
  showLogin("会话已失效，请重新登录");
});
window.addEventListener("realtime-status", (event) => {
  if (state.me) updateSyncStatus(event.detail);
});
window.addEventListener("beforeunload", (event) => {
  if ((modal.open && modalDirty()) || viewContent.dataset.dirty === "true") {
    event.preventDefault();
    event.returnValue = "";
  }
});
modal.addEventListener("cancel", (event) => {
  event.preventDefault();
  requestModalClose();
});

function showSecret(title, secret, detail) {
  modalTitle.textContent = title;
  modalEyebrow.textContent = "安全交付";
  if (!modal.open) modal.showModal();
  modalError.textContent = "";
  modalBody.innerHTML = `<div class="secret-box"><strong>仅显示这一次</strong><span class="secret-value" data-no-translate>${escapeHtml(secret)}</span><p class="helper">${escapeHtml(detail)}</p><button class="button button-secondary" type="button" data-copy-secret>复制到剪贴板</button></div>`;
  modalFooter.innerHTML = `<button class="button button-primary" type="button" data-secret-done>我已安全保存</button>`;
  modalBody.querySelector("[data-copy-secret]").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(secret);
      toast("已复制；请通过安全渠道交付");
    } catch {
      modalError.textContent = "浏览器未允许访问剪贴板，请手动选择并复制临时密码。";
    }
  });
  modalFooter
    .querySelector("[data-secret-done]")
    .addEventListener("click", () => modal.close("done"));
}

async function openCreateUser() {
  openModal({
    title: "创建用户",
    eyebrow: "身份管理",
    body: `<div class="form-grid">${field("username", "用户名", "", { helper: "小写字母、数字、点、下划线或连字符" })}${field("display_name", "显示名称")}
      <input type="hidden" name="role" value="user">
      <p class="helper">一套部署只有一名管理员；此处只能创建普通用户。</p>
      ${field("bandwidth_mbps", "账号带宽上限 (Mbps)", "", { type: "number", required: false, min: 0.1, helper: "留空表示不限速" })}</div>`,
    submitLabel: "创建并生成临时密码",
    onSubmit: async (form) => {
      const mbps = String(form.get("bandwidth_mbps") ?? "").trim();
      const result = await api("/api/v1/admin/users", {
        method: "POST",
        body: JSON.stringify({
          username: form.get("username"),
          display_name: form.get("display_name"),
          role: form.get("role"),
          bandwidth_limit_bps: mbps ? Math.round(Number(mbps) * 1_000_000) : null,
        }),
      });
      showSecret(
        "临时密码",
        result.temporary_password,
        "临时密码 72 小时有效，首次登录后必须修改。关闭后无法再次查看。",
      );
      await renderUsers();
    },
  });
}

async function openUserPolicy(userId) {
  const user = state.users.find((item) => item.id === userId);
  if (!user) return;
  openModal({
    title: `账号带宽与配额 · ${user.username}`,
    eyebrow: "带宽与配额策略",
    body: `<div class="notice"><strong>动态共享带宽池</strong><span>该用户全部活跃连接共享此上限；上传和下载共同消耗。</span></div>${field("bandwidth_mbps", "账号带宽上限 (Mbps)", user.bandwidth_limit_bps == null ? "" : user.bandwidth_limit_bps / 1_000_000, { type: "number", required: false, min: 0.1, helper: "留空表示不限速" })}<div class="notice"><strong>月度流量配额</strong><span>按自然月（UTC）统计上传+下载合计；达到配额后网关暂停该用户全部连接，次月自动恢复。本月已用 ${formatBytes(user.month_to_date_bytes)}${user.quota_suspended ? "（当前已因超额停用）" : ""}。</span></div>${field("monthly_quota_gib", "月度配额 (GiB)", user.monthly_quota_bytes == null ? "" : (user.monthly_quota_bytes / 1024 ** 3).toFixed(2), { type: "number", required: false, min: 0.1, helper: "留空表示不限配额" })}`,
    onSubmit: async (form) => {
      const raw = String(form.get("bandwidth_mbps") ?? "").trim();
      const quotaRaw = String(form.get("monthly_quota_gib") ?? "").trim();
      await api(`/api/v1/admin/traffic-policies/user/${user.id}`, {
        method: "PATCH",
        headers: { "if-match": `"${user.policy_version}"` },
        body: JSON.stringify(
          changedFields(user, {
            bandwidth_limit_bps: raw ? Math.round(Number(raw) * 1_000_000) : null,
            monthly_quota_bytes: quotaRaw ? Math.round(Number(quotaRaw) * 1024 ** 3) : null,
          }),
        ),
      });
      modal.close("saved");
      toast("账号带宽与配额策略已更新");
      await renderUsers();
    },
  });
  modal.dataset.policyUserId = user.id;
  modal.conflictResource = user;
}

// ---- 连接访问控制（IP 白名单 + Basic Auth）表单区块 ----
// patch 语义：白名单文本与原值一致则不发送；Basic Auth 通过 keep/set/off 三态
// 决定是否重设或关闭。口令仅在"设置/重设"时提交，界面绝不回显既有口令。
function accessFormFields(connection = null) {
  const allowlistText = (connection?.access_ip_allowlist ?? []).join("\n");
  const basicEnabled = Boolean(connection?.access_basic_auth_enabled);
  const keepOption = connection
    ? `<option value="keep">保持不变（当前：${basicEnabled ? "已启用" : "未启用"}）</option>`
    : "";
  return `<div class="field full"><label for="modal-access_allowlist">IP 白名单（每行一个 IP 或 CIDR）</label><textarea id="modal-access_allowlist" name="access_allowlist" rows="3" placeholder="203.0.113.0/24&#10;2001:db8::/64">${escapeHtml(allowlistText)}</textarea><p class="helper">留空表示不限制来源。门禁在网关侧执行，保存后立即生效且不会重启隧道。</p></div>
    <div class="field"><label for="modal-access_basic_mode">Basic Auth 门禁</label><select id="modal-access_basic_mode" name="access_basic_mode">${keepOption}<option value="off">${connection ? "关闭" : "不启用"}</option><option value="set">${connection ? "设置 / 重设凭据" : "启用"}</option></select></div>
    ${field("access_basic_user", "Basic 用户名", "", { required: false, helper: "1-64 字符，不能包含冒号" })}
    ${field("access_basic_password", "Basic 口令", "", { type: "password", required: false, minlength: 8, helper: "8-128 字符；口令不会在界面回显" })}`;
}

function bindAccessModeToggle() {
  const mode = modalBody.querySelector("#modal-access_basic_mode");
  const user = modalBody.querySelector("#modal-access_basic_user");
  const password = modalBody.querySelector("#modal-access_basic_password");
  if (!mode || !user || !password) return;
  const apply = () => {
    const active = mode.value === "set";
    for (const input of [user, password]) {
      input.disabled = !active;
      input.required = active;
      input.closest(".field").classList.toggle("hidden", !active);
    }
  };
  mode.addEventListener("change", apply);
  apply();
}

function collectAccessPatch(form, connection = null) {
  const lines = String(form.get("access_allowlist") ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const access = {};
  const originalLines = connection?.access_ip_allowlist ?? [];
  if (lines.join("\n") !== originalLines.join("\n"))
    access.ip_allowlist = lines.length ? lines : null;
  const mode = String(form.get("access_basic_mode") ?? "keep");
  if (mode === "set") {
    access.basic_auth = {
      username: String(form.get("access_basic_user") ?? "").trim(),
      password: String(form.get("access_basic_password") ?? ""),
    };
  } else if (mode === "off" && connection?.access_basic_auth_enabled) {
    access.basic_auth = null;
  }
  return Object.keys(access).length ? access : undefined;
}

function proxyTypeOptions(selected = "http") {
  const options = [
    `<option value="http" ${selected === "http" ? "selected" : ""}>HTTP / HTTPS</option>`,
  ];
  const labels = {
    tcp: "TCP（RTSP / SSH / RDP / 数据库等）",
    udp: "UDP（固定端口）",
  };
  for (const proxyType of ["tcp", "udp"]) {
    const settings = transportSettings(proxyType);
    if (!settings.enabled && selected !== proxyType) continue;
    options.push(
      `<option value="${proxyType}" ${selected === proxyType ? "selected" : ""} ${!settings.enabled && selected !== proxyType ? "disabled" : ""}>${labels[proxyType]}</option>`,
    );
  }
  return options.join("");
}

async function openCreateConnection() {
  if (!isAdmin()) {
    const payload = await api("/api/v1/client/devices");
    state.devices = payload.items.filter((item) => item.status === "active");
    if (!state.devices.length) {
      toast("请先在家里的电脑上安装客户端并登录同一账号", "error");
      await navigateTo("devices");
      return;
    }
    const deviceOptions = state.devices
      .map(
        (device) =>
          `<option data-no-translate value="${device.id}">${escapeHtml(device.name)}</option>`,
      )
      .join("");
    openModal({
      title: "创建 HTTP 隧道",
      eyebrow: "我的连接",
      body: `<div class="form-grid"><div class="field"><label for="modal-device_id">设备</label><select id="modal-device_id" name="device_id">${deviceOptions}</select></div>${field("name", "连接名称")}${field(
        "subdomain",
        "公网子域",
        `${(state.me?.username ?? "user")
          .toLowerCase()
          .replace(/[^a-z0-9-]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 40)}-app`,
        { helper: `公网地址为 子域.${state.tunnelDomain}。被占用时会给出可用建议。` },
      )}<input name="proxy_type" type="hidden" value="http"><div class="field" id="modal-local-scheme-field"><label for="modal-local_scheme">本地协议</label><select id="modal-local_scheme" name="local_scheme"><option value="http">http</option><option value="https">https</option></select></div>${field("local_host", "本地地址", "127.0.0.1")}${field("local_port", "本地端口", "8080", { type: "number", min: 1, max: 65535 })}<div id="modal-http-options" class="field full"><div class="form-grid">${accessFormFields()}</div></div><div class="field full"><label><input name="enabled" type="checkbox" checked> 创建后立即启用</label><p class="helper">普通用户只能自助创建 HTTP/HTTPS。TCP/UDP 由管理员分配精确公网端口。</p></div></div>`,
      submitLabel: "创建连接",
      onSubmit: async (form) => {
        const access = collectAccessPatch(form);
        await api("/api/v1/client/connections", {
          method: "POST",
          body: JSON.stringify({
            device_id: form.get("device_id"),
            name: form.get("name"),
            subdomain: form.get("subdomain"),
            proxy_type: "http",
            local_scheme: form.get("local_scheme"),
            local_host: form.get("local_host"),
            local_port: Number(form.get("local_port")),
            enabled: form.get("enabled") === "on",
            ...(access ? { access } : {}),
          }),
        });
        modal.close("saved");
        toast("连接已保存。设备在线后会自动应用；可在连接详情查看进度。");
        await navigateTo("connections");
      },
    });
    bindAccessModeToggle();
    bindSubdomainAvailability();
    return;
  }
  if (!state.users.length) state.users = (await api("/api/v1/admin/users")).items;
  state.devices = (await api("/api/v1/admin/devices")).items.filter(
    (item) => item.status === "active",
  );
  if (!state.devices.length) {
    toast("请先让用户通过 Windows、Linux 或 macOS 客户端注册设备", "error");
    return;
  }
  const userOptions = state.users
    .filter((item) => item.status === "active")
    .map(
      (user) =>
        `<option data-no-translate value="${user.id}">${escapeHtml(user.display_name)} · ${escapeHtml(user.username)}</option>`,
    )
    .join("");
  const deviceOptions = state.devices
    .map(
      (device) =>
        `<option data-no-translate value="${device.id}" data-user="${device.user_id}">${escapeHtml(device.name)} · ${escapeHtml(device.username)}</option>`,
    )
    .join("");
  const hasRawTunnels = ["tcp", "udp"].some((proxyType) => transportSettings(proxyType).enabled);
  const proxyTypeField = hasRawTunnels
    ? `<div class="field"><label for="modal-proxy_type">隧道类型</label><select id="modal-proxy_type" name="proxy_type" aria-describedby="modal-proxy-type-helper">${proxyTypeOptions()}</select><p class="helper" id="modal-proxy-type-helper">端口隧道仅管理员可分配，且不经过 HTTP 网关。</p></div>`
    : '<input id="modal-proxy_type" name="proxy_type" type="hidden" value="http">';
  openModal({
    title: "创建受管连接",
    eyebrow: "受管连接",
    body: `<div class="form-grid"><div class="field"><label for="modal-user_id">用户</label><select id="modal-user_id" name="user_id">${userOptions}</select></div><div class="field"><label for="modal-device_id">设备</label><select id="modal-device_id" name="device_id">${deviceOptions}</select></div>${field("name", "连接名称")}${field("subdomain", "连接标识", "", { helper: `HTTP 公网子域为 .${state.tunnelDomain}；端口隧道中仅作为连接标识` })}${proxyTypeField}<div class="field hidden" id="modal-remote-port-field"><label for="modal-remote_port" id="modal-remote-port-label">公网端口</label><input id="modal-remote_port" name="remote_port" type="number" min="1" max="65535" aria-describedby="modal-remote-port-helper"><p class="helper" id="modal-remote-port-helper" aria-live="polite"></p></div><div class="field" id="modal-local-scheme-field"><label for="modal-local_scheme">本地协议</label><select id="modal-local_scheme" name="local_scheme"><option value="http">http</option><option value="https">https</option></select></div>${field("local_host", "本地地址", "127.0.0.1")}${field("local_port", "本地端口", "8080", { type: "number", min: 1, max: 65535 })}<div id="modal-http-options" class="field full"><div class="form-grid">${field("bandwidth_mbps", "连接上限 (Mbps)", "", { type: "number", required: false, min: 0.1 })}${accessFormFields()}</div></div><div class="field full"><label><input name="enabled" type="checkbox" checked> 创建后立即启用</label></div></div>`,
    submitLabel: "创建连接",
    onSubmit: async (form) => {
      const mbps = String(form.get("bandwidth_mbps") ?? "").trim();
      const proxyType = String(form.get("proxy_type") ?? "http");
      const raw = isRawProxy(proxyType);
      const access = proxyType === "http" ? collectAccessPatch(form) : undefined;
      await api("/api/v1/admin/connections", {
        method: "POST",
        body: JSON.stringify({
          user_id: form.get("user_id"),
          device_id: form.get("device_id"),
          name: form.get("name"),
          subdomain: form.get("subdomain"),
          proxy_type: proxyType,
          remote_port: raw ? Number(form.get("remote_port")) : null,
          local_scheme: raw ? "http" : form.get("local_scheme"),
          local_host: form.get("local_host"),
          local_port: Number(form.get("local_port")),
          enabled: form.get("enabled") === "on",
          bandwidth_limit_bps:
            proxyType === "http" && mbps ? Math.round(Number(mbps) * 1_000_000) : null,
          ...(access ? { access } : {}),
        }),
      });
      modal.close("saved");
      toast("连接已保存。设备在线后会自动应用；可在连接详情查看进度。");
      await navigateTo("connections");
    },
  });
  bindAccessModeToggle();
  bindProxyTypeToggle();
  bindSubdomainAvailability();
  const userSelect = modalBody.querySelector("#modal-user_id");
  const deviceSelect = modalBody.querySelector("#modal-device_id");
  const filterDevices = () => {
    const userId = userSelect.value;
    [...deviceSelect.options].forEach((option) => {
      option.hidden = option.dataset.user !== userId;
      option.disabled = option.hidden;
    });
    const first = [...deviceSelect.options].find((option) => !option.hidden);
    const selected = [...deviceSelect.options].find(
      (option) => option.value === deviceSelect.value && !option.hidden,
    );
    deviceSelect.value = selected?.value ?? first?.value ?? "";
    deviceSelect.disabled = !first;
    modalFooter.querySelector("button[type=submit]").disabled = !first;
    modalError.textContent = first ? "" : "这个用户还没有设备。请先安装客户端并用该账号登录。";
    modalBody.querySelector("#modal-subdomain")?.dispatchEvent(new Event("input"));
  };
  userSelect.addEventListener("change", filterDevices);
  const firstDeviceUser = state.devices[0]?.user_id;
  if (
    firstDeviceUser &&
    modal.dataset.restored !== "true" &&
    [...userSelect.options].some((option) => option.value === firstDeviceUser)
  )
    userSelect.value = firstDeviceUser;
  filterDevices();
}

function bindSubdomainAvailability() {
  const input = modalBody.querySelector("#modal-subdomain");
  const helper = input?.parentElement?.querySelector(".helper");
  if (!input) return;
  const box = document.createElement("div");
  box.className = "subdomain-suggestions";
  input.parentElement.append(box);
  let timer = 0;
  let requestId = 0;
  const refresh = async () => {
    const id = ++requestId;
    const name = input.value.trim();
    if (!name) {
      box.replaceChildren();
      return;
    }
    try {
      const params = new URLSearchParams({ name });
      const owner = modalBody.querySelector("#modal-user_id")?.value || modal.dataset.ownerId;
      if (isAdmin() && owner) params.set("user_id", owner);
      if (modal.dataset.connectionId) params.set("connection_id", modal.dataset.connectionId);
      const result = await api(`/api/v1/client/subdomains/availability?${params}`);
      if (id !== requestId || !input.isConnected || input.value.trim() !== name) return;
      if (helper) helper.textContent = result.message;
      input.setAttribute("aria-invalid", result.available ? "false" : "true");
      box.replaceChildren(
        ...result.suggestions.map((item) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "button button-quiet button-small";
          button.textContent = item;
          button.addEventListener("click", () => {
            input.value = item;
            void refresh();
          });
          return button;
        }),
      );
    } catch {
      /* availability is advisory */
    }
  };
  input.addEventListener("input", () => {
    requestId++;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void refresh(), 200);
  });
}

function bindProxyTypeToggle() {
  const type = modalBody.querySelector("#modal-proxy_type");
  const portField = modalBody.querySelector("#modal-remote-port-field");
  const port = modalBody.querySelector("#modal-remote_port");
  const portLabel = modalBody.querySelector("#modal-remote-port-label");
  const portHelper = modalBody.querySelector("#modal-remote-port-helper");
  const schemeField = modalBody.querySelector("#modal-local-scheme-field");
  const scheme = modalBody.querySelector("#modal-local_scheme");
  const httpOptions = modalBody.querySelector("#modal-http-options");
  if (!type || !portField) return;
  const originalProxyType = type.dataset.originalProxyType ?? "";
  const originalPort = port?.dataset.originalPort ?? "";
  const applyPortRange = (settings, coerce = false) => {
    if (!port) return false;
    const value = Number(port.value);
    const withinRange = value >= settings.port_start && value <= settings.port_end;
    const preservingLegacyPort =
      type.value === originalProxyType && port.value === originalPort && !withinRange;
    if (preservingLegacyPort) {
      port.removeAttribute("min");
      port.removeAttribute("max");
      return true;
    }
    port.min = String(settings.port_start);
    port.max = String(settings.port_end);
    if (coerce && (!port.value || !withinRange)) port.value = String(settings.port_start);
    return false;
  };
  const updatePortHelper = (settings, preservingLegacyPort) => {
    if (!portHelper || !port) return;
    if (preservingLegacyPort) {
      portHelper.textContent = `当前端口 ${port.value} 已不在允许范围 ${settings.port_start}-${settings.port_end}；可停用，或改为范围内端口。`;
      return;
    }
    portHelper.textContent =
      type.value === "tcp"
        ? `允许范围 ${settings.port_start}-${settings.port_end}；RTSP 请在播放器中强制 TCP。`
        : `允许范围 ${settings.port_start}-${settings.port_end}；请用主机防火墙限源，避免 UDP 反射放大。`;
  };
  const apply = () => {
    const raw = isRawProxy(type.value);
    const settings = transportSettings(type.value);
    portField.classList.toggle("hidden", !raw);
    if (port) {
      port.required = raw;
      port.disabled = !raw;
      if (raw) {
        const changedProtocol = !originalProxyType || type.value !== originalProxyType;
        updatePortHelper(settings, applyPortRange(settings, changedProtocol));
      }
    }
    if (portLabel && raw) portLabel.textContent = `${type.value.toUpperCase()} 公网端口`;
    if (schemeField) schemeField.classList.toggle("hidden", raw);
    if (scheme) {
      scheme.disabled = raw;
      if (raw) scheme.value = "http";
    }
    if (httpOptions) httpOptions.classList.toggle("hidden", raw);
  };
  type.addEventListener("change", apply);
  port?.addEventListener("input", () => {
    if (!isRawProxy(type.value)) return;
    const settings = transportSettings(type.value);
    updatePortHelper(settings, applyPortRange(settings));
  });
  apply();
}

function openEditConnection(connectionId) {
  const connection = state.connections.find((item) => item.id === connectionId);
  if (!connection) return;
  if (!isAdmin()) {
    const raw = isRawProxy(connection.proxy_type);
    openModal({
      title: `编辑连接 · ${connection.name}`,
      eyebrow: "我的连接",
      body: `<div class="form-grid">${field("name", "连接名称", connection.name)}${raw ? "" : field("subdomain", "公网子域", connection.subdomain)}<div class="field ${raw ? "hidden" : ""}" id="modal-local-scheme-field"><label for="modal-local_scheme">本地协议</label><select id="modal-local_scheme" name="local_scheme" ${raw ? "disabled" : ""}><option value="http" ${connection.local_scheme === "http" ? "selected" : ""}>http</option><option value="https" ${connection.local_scheme === "https" ? "selected" : ""}>https</option></select></div>${field("local_host", "本地地址", connection.local_host)}${field("local_port", "本地端口", connection.local_port, { type: "number", min: 1, max: 65535 })}${raw ? "" : `<div id="modal-http-options" class="field full"><div class="form-grid">${accessFormFields(connection)}</div></div>`}<div class="field full"><label><input name="enabled" type="checkbox" ${connection.enabled ? "checked" : ""}> 启用连接</label><p class="helper">公网端口仍由管理员分配；你只能改自己的本地目标和访问控制。</p></div></div>`,
      onSubmit: async (form) => {
        const access =
          connection.proxy_type === "http" ? collectAccessPatch(form, connection) : undefined;
        await api(connectionsPath(connection.id), {
          method: "PATCH",
          headers: { "if-match": `"${connection.version}"` },
          body: JSON.stringify(
            changedFields(connection, {
              name: form.get("name"),
              ...(connection.proxy_type === "http"
                ? { subdomain: form.get("subdomain"), local_scheme: form.get("local_scheme") }
                : {}),
              local_host: form.get("local_host"),
              local_port: Number(form.get("local_port")),
              enabled: form.get("enabled") === "on",
              ...(access ? { access } : {}),
            }),
          ),
        });
        modal.close("saved");
        toast("连接配置已更新");
        await renderConnections();
      },
    });
    modal.dataset.connectionId = connection.id;
    modal.dataset.ownerId = connection.user_id || state.me.id;
    modal.conflictResource = connection;
    bindAccessModeToggle();
    bindSubdomainAvailability();
    return;
  }
  const raw = isRawProxy(connection.proxy_type);
  const settings = transportSettings(connection.proxy_type);
  openModal({
    title: `编辑连接 · ${connection.name}`,
    eyebrow: "版本化更新",
    body: `<div class="form-grid">${field("name", "连接名称", connection.name)}${field("subdomain", "连接标识", connection.subdomain)}<div class="field"><label for="modal-proxy_type">隧道类型</label><select id="modal-proxy_type" name="proxy_type" data-original-proxy-type="${escapeHtml(connection.proxy_type)}" aria-describedby="modal-transport-policy-helper">${proxyTypeOptions(connection.proxy_type)}</select></div><div class="field ${raw ? "" : "hidden"}" id="modal-remote-port-field"><label for="modal-remote_port" id="modal-remote-port-label">${escapeHtml(connection.proxy_type.toUpperCase())} 公网端口</label><input id="modal-remote_port" name="remote_port" type="number" value="${escapeHtml(connection.remote_port ?? connection.tcp_remote_port ?? settings.port_start)}" data-original-port="${escapeHtml(connection.remote_port ?? connection.tcp_remote_port ?? "")}" min="${settings.port_start}" max="${settings.port_end}" aria-describedby="modal-remote-port-helper" ${raw ? "required" : "disabled"}><p class="helper" id="modal-remote-port-helper" aria-live="polite"></p></div><div class="field ${raw ? "hidden" : ""}" id="modal-local-scheme-field"><label for="modal-local_scheme">本地协议</label><select id="modal-local_scheme" name="local_scheme" ${raw ? "disabled" : ""}><option value="http" ${connection.local_scheme === "http" ? "selected" : ""}>http</option><option value="https" ${connection.local_scheme === "https" ? "selected" : ""}>https</option></select></div>${field("local_host", "本地地址", connection.local_host)}${field("local_port", "本地端口", connection.local_port, { type: "number", min: 1, max: 65535 })}<div id="modal-http-options" class="field full ${raw ? "hidden" : ""}"><div class="form-grid">${field("bandwidth_mbps", "连接上限 (Mbps)", connection.bandwidth_limit_bps == null ? "" : connection.bandwidth_limit_bps / 1_000_000, { type: "number", required: false, min: 0.1 })}${accessFormFields(connection)}</div></div><div class="field full"><label><input name="enabled" type="checkbox" ${connection.enabled ? "checked" : ""}> 启用连接</label><p class="helper" id="modal-transport-policy-helper">当前版本 v${connection.version}；全局关闭某种端口传输时，只允许停用既有连接或改回 HTTP。</p></div></div>`,
    onSubmit: async (form) => {
      const mbps = String(form.get("bandwidth_mbps") ?? "").trim();
      const proxyType = String(form.get("proxy_type") ?? "http");
      const nextRaw = isRawProxy(proxyType);
      const nextRemotePort = nextRaw ? Number(form.get("remote_port")) : null;
      const currentRemotePort = connection.remote_port ?? connection.tcp_remote_port ?? null;
      const remotePortChanged =
        nextRaw &&
        (proxyType !== connection.proxy_type || nextRemotePort !== Number(currentRemotePort));
      const access = proxyType === "http" ? collectAccessPatch(form, connection) : undefined;
      await api(connectionsPath(connection.id), {
        method: "PATCH",
        headers: { "if-match": `"${connection.version}"` },
        body: JSON.stringify(
          changedFields(connection, {
            name: form.get("name"),
            subdomain: form.get("subdomain"),
            proxy_type: proxyType,
            ...(remotePortChanged ? { remote_port: nextRemotePort } : {}),
            local_scheme: nextRaw ? "http" : form.get("local_scheme"),
            local_host: form.get("local_host"),
            local_port: Number(form.get("local_port")),
            enabled: form.get("enabled") === "on",
            bandwidth_limit_bps:
              proxyType === "http" && mbps ? Math.round(Number(mbps) * 1_000_000) : null,
            ...(access ? { access } : {}),
          }),
        ),
      });
      modal.close("saved");
      toast("连接配置已更新");
      await renderConnections();
    },
  });
  modal.dataset.connectionId = connection.id;
  modal.dataset.ownerId = connection.user_id;
  modal.conflictResource = connection;
  bindAccessModeToggle();
  bindProxyTypeToggle();
  bindSubdomainAvailability();
}

async function openCustomDomains(connectionId) {
  const connection = state.connections.find((item) => item.id === connectionId);
  if (!connection) return;
  const data = await api(customDomainsPath(connectionId));
  const rows = data.items
    .map(
      (domain) => `
    <div class="notice ${domain.status === "verified" ? "" : "notice-warning"}">
      <strong>${escapeHtml(domain.domain)} · ${domain.status === "verified" ? "已验证" : "等待 DNS"}</strong>
      <span class="mono">TXT ${escapeHtml(domain.verification.txt_name)} = ${escapeHtml(domain.verification.txt_value)}<br>CNAME ${escapeHtml(domain.domain)} → ${escapeHtml(domain.verification.cname_target)}</span>
      <div class="actions">${domain.status === "pending" ? `<button class="button button-secondary button-small" type="button" data-domain-verify="${domain.id}">检查 DNS</button>` : ""}<button class="button button-danger button-small" type="button" data-domain-delete="${domain.id}">删除</button></div>
    </div>`,
    )
    .join("");
  openModal({
    title: `自定义域名 · ${connection.name}`,
    eyebrow: "DNS 所有权验证",
    body: `<div class="notice"><strong>需要两条 DNS 记录</strong><span>先添加 TXT 所有权证明，再把域名 CNAME 到受管地址。验证成功后会自动申请证书并重配隧道。</span></div>${rows || '<p class="helper">尚未绑定自定义域名。</p>'}<div class="form-grid">${field("domain", "新增域名", "", { helper: "例如 nas.example.com" })}</div>`,
    submitLabel: "创建验证记录",
    onSubmit: async (form) => {
      await api(customDomainsPath(connectionId), {
        method: "POST",
        body: JSON.stringify({ domain: form.get("domain") }),
      });
      modal.close("saved");
      toast("验证记录已创建，请配置 DNS");
      await openCustomDomains(connectionId);
    },
  });
  modalBody.querySelectorAll("[data-domain-verify]").forEach((button) =>
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await api(customDomainItemPath(button.dataset.domainVerify, "verify"), {
          method: "POST",
          body: "{}",
        });
        modal.close("saved");
        toast("域名验证成功，正在同步隧道");
        await renderConnections();
        await openCustomDomains(connectionId);
      } catch (error) {
        modalError.textContent = error.message;
        button.disabled = false;
      }
    }),
  );
  modalBody.querySelectorAll("[data-domain-delete]").forEach((button) =>
    button.addEventListener("click", async () => {
      if (!button.dataset.confirmed) {
        button.dataset.confirmed = "true";
        button.textContent = "确认删除这个域名";
        const warning = document.createElement("p");
        warning.className = "field-error";
        warning.textContent = "删除后此域名将停止访问，原系统分配地址不受影响。再次点击确认删除。";
        button.parentElement.before(warning);
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "button button-secondary";
        cancel.textContent = "取消";
        cancel.addEventListener("click", () => {
          delete button.dataset.confirmed;
          button.textContent = "删除";
          warning.remove();
          cancel.remove();
        });
        button.after(cancel);
        return;
      }
      button.disabled = true;
      try {
        await api(customDomainItemPath(button.dataset.domainDelete), {
          method: "DELETE",
          body: "{}",
        });
        modal.close("saved");
        toast("自定义域名已删除");
        await renderConnections();
        await openCustomDomains(connectionId);
      } catch (error) {
        modalError.textContent = error.message;
        button.disabled = false;
      }
    }),
  );
}

function confirmAction(title, detail, submitLabel, onSubmit) {
  openModal({
    title,
    eyebrow: "需要确认",
    body: `<div class="notice notice-warning"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span></div>`,
    submitLabel,
    danger: true,
    onSubmit,
  });
}

appShell.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  try {
    if (action === "refresh-view") await renderView(state.currentView);
    if (action === "audit-page") {
      state.audit.page = Math.max(1, Number(button.dataset.page) || 1);
      await renderView("audit");
    }
    if (action === "reset-audit-filter") {
      state.audit = { page: 1, pageSize: 25, query: "", action: "", targetType: "" };
      await renderView("audit");
    }
    if (action === "connection-page") {
      state.connectionQuery.page = Math.max(1, Number(button.dataset.page));
      await renderView("connections");
    }
    if (action === "change-password") changePassword();
    if (action === "connection-details") showConnectionDetails(button.dataset.id);
    if (action === "toggle-connection") {
      const c = state.connections.find((item) => item.id === button.dataset.id);
      setBusy(button, true, "同步中…");
      try {
        await api(connectionsPath(c.id), {
          method: "PATCH",
          headers: { "if-match": `"${c.version}"` },
          body: JSON.stringify({ enabled: !c.enabled }),
        });
        toast(c.enabled ? "暂停请求已保存，正在同步到设备" : "启用请求已保存，正在同步到设备");
        await renderView("connections", { background: true });
      } finally {
        if (button.isConnected) setBusy(button, false);
      }
    }
    if (action === "create-user") await openCreateUser();
    if (action === "user-policy") await openUserPolicy(button.dataset.id);
    if (action === "reset-password") {
      const user = state.users.find((item) => item.id === button.dataset.id);
      confirmAction(
        "重置临时密码",
        `将撤销 ${user?.username ?? "该用户"} 的全部会话，并重新进入首次改密状态。`,
        "确认重置",
        async () => {
          const result = await api(`/api/v1/admin/users/${button.dataset.id}/reset-password`, {
            method: "POST",
            body: "{}",
          });
          showSecret(
            "新的临时密码",
            result.temporary_password,
            "关闭后无法再次查看；旧密码和全部旧会话已失效。",
          );
          await renderUsers();
        },
      );
    }
    if (action === "toggle-user") {
      const disabling = button.dataset.status === "active";
      const user = state.users.find((item) => item.id === button.dataset.id);
      confirmAction(
        disabling ? "禁用账号" : "恢复账号",
        disabling
          ? `将停止 ${user?.username ?? "该用户"} 的访问。Web 策略通常约 5 秒内生效；TCP/UDP 需等待心跳确认，最长约 90 秒。`
          : `恢复账号后，设备仍需有效凭据和租约才能上线。`,
        disabling ? "确认禁用" : "确认恢复",
        async () => {
          await api(
            `/api/v1/admin/users/${button.dataset.id}/${disabling ? "disable" : "enable"}`,
            { method: "POST", body: "{}" },
          );
          modal.close("done");
          toast(disabling ? "账号禁用正在收敛" : "账号已恢复");
          await renderUsers();
        },
      );
    }
    if (action === "delete-device") {
      if (!isAdmin()) return;
      confirmAction(
        "删除设备",
        `设备“${button.dataset.name}”的凭据、会话、租约、连接和流量明细将被删除，且无法恢复。`,
        "确认删除",
        async () => {
          await api(`/api/v1/admin/devices/${button.dataset.id}`, { method: "DELETE", body: "{}" });
          modal.close("done");
          toast("设备已删除");
          await renderDevices();
        },
      );
    }
    if (action === "create-connection") await openCreateConnection();
    if (action === "custom-domains") await openCustomDomains(button.dataset.id);
    if (action === "edit-connection") openEditConnection(button.dataset.id);
    if (action === "delete-connection") {
      const connection = state.connections.find((item) => item.id === button.dataset.id);
      confirmAction(
        "删除连接",
        `将删除“${connection?.name ?? "这条连接"}”并停止公网访问，无法撤销。TCP/UDP 停止可能需等待约 90 秒。`,
        "删除并停止",
        async () => {
          await api(connectionsPath(connection.id), {
            method: "DELETE",
            headers: { "if-match": `"${connection.version}"` },
            body: "{}",
          });
          modal.close("done");
          toast("连接已删除");
          await renderConnections();
        },
      );
    }
  } catch (error) {
    toast(error.message || "操作失败，请重试", "error");
  }
});

viewContent.addEventListener("click", async (event) => {
  const copy = event.target.closest("[data-copy]");
  if (!copy) return;
  try {
    await navigator.clipboard.writeText(copy.dataset.copy);
    toast("已复制公网地址");
  } catch {
    toast("无法写入剪贴板，请手动选择地址", "error");
  }
});

viewContent.addEventListener("submit", async (event) => {
  if (event.target.id === "connection-filter") {
    event.preventDefault();
    const form = new FormData(event.target);
    state.connectionQuery = {
      page: 1,
      search: String(form.get("search") ?? "").trim(),
      userId: String(form.get("user_id") ?? ""),
    };
    viewContent.dataset.dirty = "false";
    pageDrafts.delete(`${state.me?.id}:connections`);
    await renderView("connections");
    return;
  }
  if (event.target.id === "settings-form") {
    event.preventDefault();
    const button = event.target.querySelector("button[type=submit]");
    if (button.disabled) return;
    setBusy(button, true);
    try {
      const form = new FormData(event.target);
      await api("/api/v1/admin/settings", {
        method: "PATCH",
        body: JSON.stringify({ subdomain_prefix_policy: form.get("subdomain_prefix_policy") }),
      });
      state.prefixPolicy = form.get("subdomain_prefix_policy");
      viewContent.dataset.dirty = "false";
      pageDrafts.delete(`${state.me?.id}:settings`);
      toast("部署设置已保存");
      await renderSettings();
    } catch (error) {
      toast(error.message, "error");
    } finally {
      if (button.isConnected) setBusy(button, false);
    }
    return;
  }
  if (event.target.id !== "audit-filter-form") return;
  event.preventDefault();
  const form = new FormData(event.target);
  state.audit.query = String(form.get("query") ?? "").trim();
  state.audit.action = String(form.get("action") ?? "").trim();
  state.audit.targetType = String(form.get("target_type") ?? "");
  state.audit.pageSize = [25, 50, 100].includes(Number(form.get("page_size")))
    ? Number(form.get("page_size"))
    : 25;
  state.audit.page = 1;
  viewContent.dataset.dirty = "false";
  pageDrafts.delete(`${state.me?.id}:audit`);
  await renderView("audit");
});

function closeSidebar() {
  const wasOpen = document.querySelector(".sidebar").classList.contains("open");
  document.querySelector(".sidebar").classList.remove("open");
  document.querySelector(".workspace").inert = false;
  if (wasOpen) document.querySelector("#menu-button").focus();
  document.querySelector("#menu-button").setAttribute("aria-expanded", "false");
}

document.querySelectorAll(".nav-item").forEach((button) =>
  button.addEventListener("click", async () => {
    closeSidebar();
    await navigateTo(button.dataset.view);
  }),
);

document.querySelector("#menu-button").addEventListener("click", (event) => {
  const sidebar = document.querySelector(".sidebar");
  const open = sidebar.classList.toggle("open");
  event.currentTarget.setAttribute("aria-expanded", String(open));
  document.querySelector(".workspace").inert = open;
  if (open) sidebar.querySelector(".nav-item:not([hidden])")?.focus();
});

sidebarScrim.addEventListener("click", closeSidebar);
window.addEventListener("popstate", () => {
  if (!state.me) return;
  const view = location.hash.replace("#", "");
  if (viewMeta[view]) void renderView(view);
});
document.addEventListener("keydown", (event) => {
  const sidebar = document.querySelector(".sidebar");
  if (event.key === "Tab" && sidebar.classList.contains("open")) {
    const items = [...sidebar.querySelectorAll("button,a")].filter(
      (el) => !el.hidden && !el.disabled && el.getClientRects().length,
    );
    const first = items[0],
      last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  if (event.key === "Escape" && document.querySelector(".sidebar").classList.contains("open"))
    closeSidebar();
});

document.querySelectorAll(".password-toggle").forEach((button) =>
  button.addEventListener("click", () => {
    const input = document.querySelector(`#${button.dataset.target}`);
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    button.setAttribute("aria-label", showing ? "显示密码" : "隐藏密码");
  }),
);

document.querySelector("#modal-close").addEventListener("click", requestModalClose);
modal.addEventListener("close", () => {
  modalError.textContent = "";
  if (!modal.open) {
    modalForm.onsubmit = null;
    modalBody.replaceChildren();
  }
  if (state.pendingRefresh && !modal.open) void renderView(state.currentView, { background: true });
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
    const result = await api(
      "/api/v1/auth/login",
      {
        method: "POST",
        body: JSON.stringify({
          username: form.get("username"),
          password: form.get("password"),
          client_type: "web",
        }),
      },
      false,
    );
    state.csrf = result.csrf_token;
    document.querySelector("#login-password").value = "";
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
  if (form.get("new_password") !== form.get("confirm_password")) {
    document.querySelector("#password-error").textContent = "两次输入的新密码不一致";
    document.querySelector("#new-password").setAttribute("aria-invalid", "true");
    return;
  }
  const button = passwordForm.querySelector("button[type=submit]");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.classList.add("is-loading");
  const original = button.textContent;
  button.textContent = "正在保存…";
  try {
    await api(
      "/api/v1/auth/password/change",
      {
        method: "POST",
        body: JSON.stringify({
          current_password: pendingCurrentPassword ?? form.get("current_password"),
          new_password: form.get("new_password"),
        }),
      },
      false,
    );
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

document.querySelector("#logout-button").addEventListener("click", () => {
  confirmAction(
    "退出登录",
    "退出后需要重新输入账号密码。未保存的对话框内容会丢失。",
    "确认退出",
    async () => {
      try {
        await api("/api/v1/auth/logout", { method: "POST", body: "{}" }, false);
      } catch {}
      modal.close("done");
      disconnectRealtime();
      modalDrafts.clear();
      pageDrafts.clear();
      showLogin("已安全退出");
    },
  );
});

(async () => {
  await loadPublicConfig();
  if (!location.pathname.startsWith("/admin")) {
    updateDocumentMetadata();
    return;
  }
  landingScreen.classList.add("hidden");
  try {
    await refreshSession();
    await showApp();
  } catch {
    showLogin();
  }
})();
