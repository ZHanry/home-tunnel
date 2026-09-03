import { localeTag } from "./locale.js?v=4.0.0-modules1";

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function formatBytes(value) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(amount) / Math.log(1024)));
  return `${(amount / 1024 ** index).toLocaleString(localeTag(), { maximumFractionDigits: index ? 1 : 0 })} ${units[index]}`;
}

export function formatBps(value) {
  if (value == null) return "不限速";
  const amount = Number(value);
  if (amount >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(1)} Gbps`;
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)} Mbps`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)} Kbps`;
  return `${amount} bps`;
}

export function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString(localeTag(), { hour12: false });
}

export function statusBadge(status) {
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
    quota_suspended: "配额停用",
  }[normalized] ?? normalized;
  return `<span class="status-badge ${tone}">${escapeHtml(label)}</span>`;
}

export function componentLabel(component) {
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

export function configState(device) {
  const applied = Number(device.applied_config_version ?? 0);
  const target = Number(device.config_version ?? 0);
  const inSync = applied === target;
  return `<span class="config-state"><strong class="${inSync ? "" : "drift"}">${inSync ? "已同步" : "待应用"}</strong><small>应用 v${applied} · 目标 v${target}</small></span>`;
}
