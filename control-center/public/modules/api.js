import { localizedApiError } from "./locale.js?v=3.2.0-modules1";
import { state } from "./state.js?v=3.2.0-modules1";

let refreshInFlight = null;

async function parseResponse(response) {
  if (response.status === 204) return null;
  const type = response.headers.get("content-type") ?? "";
  return type.includes("application/json") ? response.json() : response.text();
}

async function performSessionRefresh() {
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
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && state.csrf) headers.set("x-csrf-token", state.csrf);
  headers.set("x-request-id", crypto.randomUUID());
  const response = await fetch(path, { ...options, method, headers, credentials: "same-origin" });
  const data = await parseResponse(response);
  if (response.status === 401 && canRefresh && !path.startsWith("/api/v1/auth/")) {
    await refreshSession();
    return api(path, options, false);
  }
  if (!response.ok) {
    const error = new Error(localizedApiError(data, response.status));
    error.code = data?.error_code;
    error.details = data;
    error.status = response.status;
    throw error;
  }
  return data;
}
