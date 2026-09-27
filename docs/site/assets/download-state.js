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

  function view(input) {
    var fallback = input.fallbackStable || "9.0.0";
    var candidateVersion = (input.candidate && input.candidate.version) || "10.0.0";
    if (input.transport === "offline") {
      return {
        tone: "offline",
        zh: "当前离线。网络恢复后仍可使用本页的 " + fallback + " 稳定链接。10.0.0 没有稳定包，验收尚未完成。",
        en: "You are offline. The " + fallback + " links on this page work again when the network returns. 10.0.0 has no stable packages; acceptance is pending."
      };
    }
    if (input.transport !== "ok" || !input.stable || !input.candidate) {
      return {
        tone: "error",
        zh: "下载清单没有读到。不要把开发分支当成 10.0.0 稳定包。请使用本页已经写出的 " + fallback + " 链接，验收尚未完成。",
        en: "The download manifest could not be read. Do not treat the development branch as a 10.0.0 stable package. Use the " + fallback + " links already listed on this page. Acceptance is pending."
      };
    }
    var stable = input.stable;
    var candidate = input.candidate;
    if (candidate.promotion_status !== "promoted") {
      if (candidate.downloads_published !== false || candidate.acceptance_status === "accepted") {
        return {
          tone: "error",
          zh: "清单冲突：开发线被标成已有下载或已验收，但晋升状态不是已发布。本页只保留已发布的稳定链接。验收尚未完成。",
          en: "The download manifest conflicts with itself: the development line claims packages or acceptance while it is not promoted. This page keeps only the published stable links. Acceptance is pending."
        };
      }
      var pending = text(stable.version, candidate.version || candidateVersion);
      return { tone: "ready", zh: pending.zh, en: pending.en };
    }
    if (candidate.acceptance_status !== "accepted" || candidate.downloads_published !== true || stable.stage !== "stable" || stable.version !== candidate.version) {
      return {
        tone: "error",
        zh: "清单冲突：晋升标记和稳定版本不一致。不要安装来源不明的 10.0.0 包。",
        en: "The download manifest conflicts with itself: promotion does not match the stable version. Do not install an unverified 10.0.0 package."
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
