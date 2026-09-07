import { state } from "./state.js?v=5.0.0-modules2";

const refreshEvents = new Set([
  "config.version.changed",
  "connection.command",
  "access.policy.changed",
  "quota.suspended",
  "quota.restored",
  "subject.revoked",
  "runtime.state.changed",
  "traffic.speed.updated",
]);
let refreshCurrentView = () => {};

function scheduleRealtimeReconnect() {
  window.clearTimeout(state.socketReconnectTimer);
  if (!state.me) return;
  state.socketReconnectTimer = window.setTimeout(() => connectRealtime(), 3000);
}

export function connectRealtime(onRefresh = refreshCurrentView) {
  refreshCurrentView = onRefresh;
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
  socket.addEventListener("open", () => {
    if (state.socket !== socket) return;
    window.dispatchEvent(
      new CustomEvent("realtime-status", { detail: "实时连接已恢复，正在同步…" }),
    );
    refreshCurrentView();
  });
  socket.addEventListener("message", (event) => {
    if (state.socket !== socket) return;
    try {
      const message = JSON.parse(event.data);
      if (refreshEvents.has(message.event)) {
        window.clearTimeout(state.refreshTimer);
        state.refreshTimer = window.setTimeout(() => refreshCurrentView(), 700);
      }
    } catch {}
  });
  socket.addEventListener("close", () => {
    if (state.socket !== socket) return;
    state.socket = null;
    window.dispatchEvent(
      new CustomEvent("realtime-status", { detail: "实时连接中断，显示上次同步的数据；正在重连…" }),
    );
    scheduleRealtimeReconnect();
  });
}

export function disconnectRealtime() {
  window.clearTimeout(state.socketReconnectTimer);
  window.clearTimeout(state.refreshTimer);
  state.socketReconnectTimer = null;
  state.refreshTimer = null;
  const socket = state.socket;
  state.socket = null;
  socket?.close();
}

window.setInterval(() => {
  if (state.me && !document.hidden) refreshCurrentView();
}, 30_000);
document.addEventListener("visibilitychange", () => {
  if (state.me && !document.hidden) refreshCurrentView();
});
