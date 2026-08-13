(() => {
  const endpoint = document.documentElement.dataset.goatcounterEndpoint?.trim();
  if (!endpoint || location.hostname !== "zhanry.github.io") return;

  window.goatcounter = {
    endpoint,
    referrer: () => new URLSearchParams(location.search).get("utm_source") || document.referrer,
  };

  const script = document.createElement("script");
  script.async = true;
  script.src = "https://gc.zgo.at/count.js";
  script.dataset.goatcounter = endpoint;
  document.head.append(script);
})();
