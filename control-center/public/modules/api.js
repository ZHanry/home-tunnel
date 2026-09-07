import { localizedApiError } from "./locale.js?v=5.0.0-modules1";
import { state } from "./state.js?v=5.0.0-modules1";

let refreshInFlight = null;

export class ApiError extends Error {
  constructor(message, code, status = 0, details = {}) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

async function request(path, options) {
  try {
    const timeout = AbortSignal.timeout(20_000);
    return await fetch(path, {
      ...options,
      signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiError(
      error.name === "TimeoutError"
        ? "请求超时，请检查网络后重试"
        : "无法连接服务器，请检查网络后重试",
      "NETWORK_UNAVAILABLE",
    );
  }
}

async function parseResponse(response) {
  if (response.status === 204) return null;
  const type = response.headers.get("content-type") ?? "";
  return type.includes("application/json") ? response.json() : response.text();
}

async function performSessionRefresh() {
  const response = await request("/api/v1/auth/refresh", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_type: "web" }),
  });
  if (response.status === 401 || response.status === 403)
    throw new ApiError("会话已失效，请重新登录", "SESSION_REVOKED", response.status);
  if (!response.ok)
    throw new ApiError("暂时无法验证会话，请稍后重试", "SERVICE_UNAVAILABLE", response.status);
  const data = await response.json();
  state.csrf = data.csrf_token;
  return data;
}

export function refreshSession() {
  if (!refreshInFlight) {
    refreshInFlight = performSessionRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

export async function api(path, options = {}, canRefresh = true) {
  const method = options.method ?? "GET";
  const headers = new Headers(options.headers ?? {});
  if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && state.csrf)
    headers.set("x-csrf-token", state.csrf);
  headers.set("x-request-id", crypto.randomUUID());
  const response = await request(path, { ...options, method, headers, credentials: "same-origin" });
  const data = await parseResponse(response);
  if (response.status === 401 && canRefresh && !path.startsWith("/api/v1/auth/")) {
    try {
      await refreshSession();
    } catch (error) {
      if (error.code === "SESSION_REVOKED" && window.dispatchEvent)
        window.dispatchEvent(new CustomEvent("session-expired"));
      throw error;
    }
    return api(path, options, false);
  }
  if (!response.ok) {
    const code =
      response.status === 401 && !path.startsWith("/api/v1/auth/")
        ? "SESSION_REVOKED"
        : data?.error_code;
    if (code === "SESSION_REVOKED" && window.dispatchEvent)
      window.dispatchEvent(new CustomEvent("session-expired"));
    throw new ApiError(localizedApiError(data, response.status), code, response.status, data);
  }
  return data;
}
