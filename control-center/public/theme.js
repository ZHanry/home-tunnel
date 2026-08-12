(function () {
  "use strict";

  var storageKey = "ht_theme";
  var theme = "light";
  try {
    var stored = window.localStorage.getItem(storageKey);
    if (stored === "dark" || stored === "light") theme = stored;
  } catch {}

  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}());
