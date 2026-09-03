import assert from "node:assert/strict";
import test from "node:test";

const fakeElement = {
  classList: { contains: () => true },
  dataset: { theme: "light" },
  style: {},
  matches: () => false,
  querySelectorAll: () => [],
  hasAttribute: () => false,
  setAttribute: () => undefined,
};

globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
globalThis.NodeFilter = { SHOW_TEXT: 4, FILTER_REJECT: 2, FILTER_ACCEPT: 1 };
globalThis.document = {
  nodeType: 9,
  body: {},
  documentElement: fakeElement,
  title: "",
  querySelector: (selector) => (selector === "#app-shell" ? fakeElement : null),
  querySelectorAll: () => [],
  createTreeWalker: () => ({ nextNode: () => null }),
};
globalThis.location = { pathname: "/admin" };
globalThis.window = {
  localStorage: { getItem: () => null, setItem: () => undefined },
  addEventListener: () => undefined,
};
globalThis.MutationObserver = class {
  observe() {
    return undefined;
  }
};

const [{ api }, { state }] = await Promise.all([
  import("../public/modules/api.js"),
  import("../public/modules/state.js?v=4.0.0-modules1"),
]);

function jsonResponse(status, body) {
  return new globalThis.Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

test("concurrent 401 responses share one refresh-token rotation", async () => {
  state.csrf = "csrf-before-refresh";
  const resourceAttempts = new Map();
  const retryCsrfTokens = [];
  const refreshStarted = deferred();
  const releaseRefresh = deferred();
  let refreshCalls = 0;

  globalThis.fetch = async (path, options = {}) => {
    if (path === "/api/v1/auth/refresh") {
      refreshCalls += 1;
      refreshStarted.resolve();
      await releaseRefresh.promise;
      return jsonResponse(200, { csrf_token: "csrf-after-refresh" });
    }

    const attempt = (resourceAttempts.get(path) ?? 0) + 1;
    resourceAttempts.set(path, attempt);
    const headers = new globalThis.Headers(options.headers);
    if (attempt === 1) {
      assert.equal(headers.get("x-csrf-token"), "csrf-before-refresh");
      return jsonResponse(401, {
        error_code: "SESSION_REVOKED",
        message: "expired for test",
      });
    }
    retryCsrfTokens.push(headers.get("x-csrf-token"));
    return jsonResponse(200, { path, attempt });
  };

  const requests = ["/resource/one", "/resource/two", "/resource/three"].map((path) =>
    api(path, { method: "POST", body: "{}" }),
  );
  await refreshStarted.promise;
  await new Promise((resolve) => globalThis.setImmediate(resolve));
  assert.equal(refreshCalls, 1);
  releaseRefresh.resolve();

  const results = await Promise.all(requests);
  assert.deepEqual(
    results.map((result) => result.attempt),
    [2, 2, 2],
  );
  assert.deepEqual(retryCsrfTokens, [
    "csrf-after-refresh",
    "csrf-after-refresh",
    "csrf-after-refresh",
  ]);
  assert.equal(state.csrf, "csrf-after-refresh");
});
