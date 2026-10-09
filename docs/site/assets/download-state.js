(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.HomeTunnelDownloadState = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function text(stableVersion, candidateVersion) {
    return {
      zh: "稳定下载是 " + stableVersion + "。开发线 " + candidateVersion + " 尚未晋升，没有稳定包，验收尚未完成。",
      en: "Stable downloads are " + stableVersion + ". Development line " + candidateVersion + " is not promoted and has no stable packages; acceptance is pending."
    };
  }

  // Both states describe published releases; unrun gates remain unverified.
  var ACCEPTED = ["accepted", "accepted_with_waivers", "passed_reproducible"];

  function view(input) {
    var fallback = input.fallbackStable || "10.1.0";
    var candidateVersion = (input.candidate && input.candidate.version) || "10.1.0";
    if (input.transport === "loading") {
      return {
        tone: "loading",
        zh: "正在读取下载清单。下方提供当前稳定版 " + fallback + " 的下载链接。",
        en: "Reading the download manifest. The links below provide the current stable version, " + fallback + "."
      };
    }
    if (input.transport === "offline") {
      return {
        tone: "offline",
        zh: "当前离线。网络恢复后，可从下方下载稳定版 " + fallback + "。",
        en: "You are offline. When the network returns, use the links below to download stable version " + fallback + "."
      };
    }
    var stableVersion = input.stable && input.stable.version;
    var candidateTag = input.candidate && input.candidate.version;
    var versionPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(?:RC[1-9][0-9]*|rc\.[1-9][0-9]*))?$/;
    if (input.transport !== "ok" || !input.stable || !input.candidate ||
        typeof stableVersion !== "string" || !versionPattern.test(stableVersion) || stableVersion.indexOf("-") !== -1 ||
        input.stable.stage !== "stable" || typeof candidateTag !== "string" || !versionPattern.test(candidateTag) ||
        ["not_promoted", "promoted", "prerelease"].indexOf(input.candidate.promotion_status) === -1 ||
        ["pending", "not_submitted"].concat(ACCEPTED).indexOf(input.candidate.acceptance_status) === -1 ||
        typeof input.candidate.downloads_published !== "boolean") {
      return {
        tone: "error",
        zh: "下载清单没有读到。可继续使用下方稳定版 " + fallback + " 的链接，或稍后刷新页面。",
        en: "The download manifest could not be read. Use the stable " + fallback + " links below, or refresh this page later."
      };
    }
    var stable = input.stable;
    var candidate = input.candidate;
    if (candidate.promotion_status === "prerelease") {
      if (candidate.prerelease !== true || candidate.stage !== "candidate" || candidate.acceptance_status !== "pending" ||
          !/-([Rr][Cc][1-9][0-9]*|rc\.[1-9][0-9]*)$/.test(candidate.version) || candidate.remote_policy !== "require_direct" || candidate.relay_enabled !== false) {
        return { tone: "error", zh: "候选清单冲突，请使用稳定下载链接。", en: "Candidate manifest conflict; use the stable download links." };
      }
      var publishedZh = candidate.downloads_published ? "候选包已发布。" : "候选构建与发布检查进行中。";
      var publishedEn = candidate.downloads_published ? "Candidate packages are published. " : "Candidate builds and publication checks are in progress. ";
      return {
        tone: "ready",
        zh: "稳定下载是 " + stable.version + "。NestLink " + candidate.version + " 只进入候选通道。" + publishedZh + "远控严格 P2P；跨网与真机验收尚未完成。部分验收项目未运行，验证尚未完成。",
        en: "Stable downloads are " + stable.version + ". NestLink " + candidate.version + " remains a prerelease. " + publishedEn + "Remote control requires direct P2P; acceptance is pending. Cross-network and physical-device gates were not run and remain unverified."
      };
    }
    if (candidate.version === "13.0.0" && candidate.prerelease === false && candidate.promotion_status === "not_promoted") {
      if (candidate.acceptance_status !== "pending" || candidate.remote_policy !== "require_direct" || candidate.relay_enabled !== false)
        return {tone:"error",zh:"13.0.0 清单状态不一致。",en:"The 13.0.0 manifest has conflicting state."};
      return {tone:"ready",zh:"nestlink 13.0.0 构建与验收进行中。正式下载将在通过检查后发布。",en:"nestlink 13.0.0 build and acceptance are in progress. Stable downloads will follow verified publication."};
    }
    if (candidate.promotion_status !== "promoted") {
      if (candidate.downloads_published !== false || ACCEPTED.indexOf(candidate.acceptance_status) !== -1) {
        return {
          tone: "error",
          zh: "清单冲突：开发线被标成已有下载或已验收，但晋升状态不是已发布。本页只保留已发布的稳定链接。验收尚未完成。",
          en: "The download manifest conflicts with itself: the development line claims packages or acceptance while it is not promoted. This page keeps only the published stable links. Acceptance is pending."
        };
      }
      var pending = text(stable.version, candidate.version || candidateVersion);
      return { tone: "ready", zh: pending.zh, en: pending.en };
    }
    if (ACCEPTED.indexOf(candidate.acceptance_status) === -1 || candidate.downloads_published !== true || stable.stage !== "stable" || stable.version !== candidate.version) {
      return {
        tone: "error",
        zh: "清单冲突：晋升标记和稳定版本不一致。不要安装来源不明的 " + candidate.version + " 包。",
        en: "The download manifest conflicts with itself: promotion does not match the stable version. Do not install an unverified " + candidate.version + " package."
      };
    }
    if (candidate.version === "13.0.0" && candidate.acceptance_status === "passed_reproducible")
      return {tone:"ready",zh:"nestlink 13.0.0 正式版 · 安装与联调已验证。真机、运营商网络和长期媒体验证范围见发布说明。",en:"nestlink 13.0.0 stable · installation and reproducible integration verified. See release notes for physical-device, carrier-network and long-duration-media coverage."};
    var components = stable.components || {};
    var mixed = components.android && components.android.version !== stable.version;
    var mixZh = mixed ? "Server / Client " + stable.version + "，Android 保留 " + components.android.version + "。" : "";
    var mixEn = mixed ? "Server / Client " + stable.version + "; Android remains " + components.android.version + ". " : "";
    if (candidate.acceptance_status === "accepted_with_waivers") {
      return {
        tone: "ready",
        zh: "稳定下载是 " + stable.version + "。" + mixZh + "部分验收项目未运行，验证尚未完成，清单见发布说明。请核对校验值后再安装。",
        en: "Stable downloads are " + stable.version + ". " + mixEn + "Some acceptance gates were not run and remain unverified; the release notes list them. Check the checksum before you install."
      };
    }
    return {
      tone: "ready",
      zh: "稳定通道已切换到 " + stable.version + "。请核对校验值后再安装。",
      en: "The stable channel is " + stable.version + ". Check the checksum before you install."
    };
  }

  return { view: view };
});
