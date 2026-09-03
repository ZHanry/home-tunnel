(function () {
  "use strict";

  var storageKey = "ht_theme";
  var theme = "light";
  try {
    var stored = window.localStorage.getItem(storageKey);
    if (stored === "dark" || stored === "light") theme = stored;
    else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) theme = "dark";
  } catch {}

  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;

  var locale = "zh-CN";
  try {
    var storedLocale = window.localStorage.getItem("ht_locale");
    if (storedLocale === "en" || storedLocale === "zh-CN") locale = storedLocale;
  } catch {}
  document.documentElement.lang = locale;
}());
