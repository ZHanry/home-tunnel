(function () {
  var params = new URLSearchParams(location.search);
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("site-nav");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = toggle.getAttribute("aria-expanded") !== "true";
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      nav.classList.toggle("is-open", open);
      if (open) {
        var first = nav.querySelector("a");
        if (first) first.focus();
      }
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
        toggle.setAttribute("aria-expanded", "false");
        nav.classList.remove("is-open");
        toggle.focus();
      }
    });
  }

  var group = document.querySelector(".theme");
  if (group) {
    var buttons = Array.prototype.slice.call(group.querySelectorAll("[data-theme-choice]"));
    function paint() {
      var value = document.documentElement.getAttribute("data-theme") || "system";
      buttons.forEach(function (button) {
        var selected = button.getAttribute("data-theme-choice") === value;
        button.setAttribute("aria-checked", selected ? "true" : "false");
        button.tabIndex = selected ? 0 : -1;
      });
    }
    function choose(value, persist) {
      document.documentElement.setAttribute("data-theme", value);
      if (persist) {
        try { localStorage.setItem("home-tunnel-theme", value); } catch (error) {}
      }
      paint();
    }
    buttons.forEach(function (button, index) {
      button.addEventListener("click", function () {
        choose(button.getAttribute("data-theme-choice"), true);
      });
      button.addEventListener("keydown", function (event) {
        var next = null;
        if (event.key === "ArrowRight" || event.key === "ArrowDown") next = buttons[(index + 1) % buttons.length];
        if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = buttons[(index + buttons.length - 1) % buttons.length];
        if (!next) return;
        event.preventDefault();
        choose(next.getAttribute("data-theme-choice"), true);
        next.focus();
      });
    });
    paint();
  }

  var focusId = params.get("focus");
  if (focusId) {
    var target = document.getElementById(focusId);
    if (target) target.focus();
  }

  var status = document.getElementById("download-status");
  if (!status || !globalThis.HomeTunnelDownloadState) return;
  var lang = document.documentElement.lang || "zh-CN";
  var fallback = document.body.getAttribute("data-stable-version") || "10.0.0";
  var root = document.body.getAttribute("data-root") || "";
  function paintStatus(view) {
    status.dataset.tone = view.tone;
    status.textContent = lang.indexOf("zh") === 0 ? view.zh : view.en;
  }
  // Fill checksum cells from the stable manifest. Cells keep their static text (a pointer
  // to the Release SHA256SUMS.txt) when the manifest is stale, missing, or has no match.
  function fillChecksums(stable) {
    if (typeof document.querySelectorAll !== "function" || !stable || !stable.components || typeof stable.components !== "object") return;
    var byUrl = {};
    Object.keys(stable.components).forEach(function (name) {
      var downloads = stable.components[name] && stable.components[name].downloads;
      (Array.isArray(downloads) ? downloads : []).forEach(function (item) {
        if (item && typeof item.url === "string" && /^[0-9a-f]{64}$/.test(item.sha256 || "")) byUrl[item.url] = item.sha256;
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-sha256-for]"), function (cell) {
      var value = byUrl[cell.getAttribute("data-sha256-for")];
      if (value) cell.textContent = value;
    });
  }
  var forced = params.get("state");
  if (forced === "offline" || forced === "error" || forced === "loading") {
    paintStatus(globalThis.HomeTunnelDownloadState.view({
      transport: forced,
      stable: null,
      candidate: null,
      fallbackStable: fallback
    }));
    return;
  }
  var requestEpoch = 0;
  var requestController = null;
  function offline() {
    requestEpoch += 1;
    if (requestController) requestController.abort();
    paintStatus(globalThis.HomeTunnelDownloadState.view({ transport: "offline", fallbackStable: fallback }));
  }
  function refreshDownloads() {
    if (navigator.onLine === false) { offline(); return; }
    var epoch = ++requestEpoch;
    if (requestController) requestController.abort();
    var controller = new AbortController();
    requestController = controller;
    var timeout = setTimeout(function () { controller.abort(); }, 15000);
    paintStatus(globalThis.HomeTunnelDownloadState.view({ transport: "loading", fallbackStable: fallback }));
    Promise.all(["releases.json", "candidate.json"].map(function (name) {
      return fetch(root + name, { cache: "no-store", signal: controller.signal }).then(function (response) {
        if (!response.ok) throw new Error("download manifest");
        return response.json();
      });
    })).then(function (pair) {
      if (epoch !== requestEpoch) return;
      var view = globalThis.HomeTunnelDownloadState.view({
        transport: "ok", stable: pair[0], candidate: pair[1], fallbackStable: fallback
      });
      paintStatus(view);
      if (view.tone === "ready") fillChecksums(pair[0]);
    }).catch(function () {
      if (epoch !== requestEpoch) return;
      paintStatus(globalThis.HomeTunnelDownloadState.view({
        transport: navigator.onLine === false ? "offline" : "error", fallbackStable: fallback
      }));
    }).finally(function () { clearTimeout(timeout); });
  }
  window.addEventListener("offline", offline);
  window.addEventListener("online", refreshDownloads);
  refreshDownloads();
})();
