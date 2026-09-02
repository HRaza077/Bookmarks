/* popup.js — quick controls; reads/writes chrome.storage.local directly. */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var DAY = 86400000;

  function get(keys) {
    return new Promise(function (r) { chrome.storage.local.get(keys, function (v) { r(v || {}); }); });
  }
  function set(obj) {
    return new Promise(function (r) { chrome.storage.local.set(obj, function () { r(); }); });
  }

  var DEFAULTS = {
    enabled: true, dedupeScope: "exact", suggestOncePerUrl: true,
    devMode: false, monitorIncognito: false, pausedUntil: 0
  };

  async function render() {
    var s = await get(["settings", "suggestions", "dismissed", "dashboardUrl"]);
    var settings = Object.assign({}, DEFAULTS, s.settings || {});
    var suggestions = Array.isArray(s.suggestions) ? s.suggestions : [];
    var dismissed = Array.isArray(s.dismissed) ? s.dismissed : [];

    $("count").textContent = String(suggestions.length);
    $("enabled").checked = settings.enabled !== false;

    var paused = settings.pausedUntil && Date.now() < settings.pausedUntil;
    $("pause").value = paused ? nearestOption(settings.pausedUntil - Date.now()) : "0";

    $("clear").textContent = dismissed.length
      ? "Clear dismissed (" + dismissed.length + ")"
      : "Clear dismissed";
    $("clear").disabled = dismissed.length === 0;

    $("open").dataset.url = s.dashboardUrl || "";
    if (!s.dashboardUrl) {
      $("hint").textContent = "Open your dashboard once (index.html) so this button can find it later.";
    }
  }

  function nearestOption(ms) {
    var opts = [3600000, 10800000, 86400000];
    var best = "86400000", bestD = Infinity;
    opts.forEach(function (o) { var d = Math.abs(o - ms); if (d < bestD) { bestD = d; best = String(o); } });
    return best;
  }

  $("enabled").addEventListener("change", async function () {
    var s = await get("settings");
    await set({ settings: Object.assign({}, DEFAULTS, s.settings || {}, { enabled: $("enabled").checked }) });
  });

  $("pause").addEventListener("change", async function () {
    var ms = Number($("pause").value) || 0;
    var s = await get("settings");
    var until = ms ? Date.now() + ms : 0;
    await set({ settings: Object.assign({}, DEFAULTS, s.settings || {}, { pausedUntil: until }) });
  });

  $("clear").addEventListener("click", async function () {
    await set({ dismissed: [] });
    render();
  });

  $("open").addEventListener("click", function () {
    var url = $("open").dataset.url;
    if (url) chrome.tabs.create({ url: url });
    else window.close();
  });

  chrome.storage.onChanged.addListener(function (_c, area) { if (area === "local") render(); });
  render();
})();
