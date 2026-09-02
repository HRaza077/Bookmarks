/*
 * background.js — MV3 service worker
 * ---------------------------------
 * Watches tab loads / URL changes, turns eligible pages into pending
 * "bookmark suggestions" stored in chrome.storage.local. Never touches the
 * pages themselves (no scripting/host permissions) and never records history
 * beyond the pending suggestion list.
 */
importScripts("shared/suggest-core.js");
var SC = self.SuggestCore;

var DEFAULT_SETTINGS = SC.SETTINGS_DEFAULTS;
var MAX_SUGGESTIONS = 200;
var MAX_DISMISSED = 5000;
var DEBOUNCE_MS = 600;

/* ---------- storage helpers ---------- */

function getLocal(keys) {
  return new Promise(function (resolve) {
    chrome.storage.local.get(keys, function (r) { resolve(r || {}); });
  });
}
function setLocal(obj) {
  return new Promise(function (resolve) {
    chrome.storage.local.set(obj, function () { resolve(); });
  });
}

async function getState() {
  var s = await getLocal(["settings", "suggestions", "dismissed", "bookmarkIndex"]);
  return {
    settings: SC.withDefaults(s.settings),
    suggestions: Array.isArray(s.suggestions) ? s.suggestions : [],
    dismissed: Array.isArray(s.dismissed) ? s.dismissed : [],
    bookmarkIndex: s.bookmarkIndex && typeof s.bookmarkIndex === "object"
      ? { keys: s.bookmarkIndex.keys || [], domains: s.bookmarkIndex.domains || [] }
      : { keys: [], domains: [] }
  };
}

/* ---------- lifecycle ---------- */

chrome.runtime.onInstalled.addListener(async function () {
  var s = await getLocal(["settings", "suggestions", "dismissed", "bookmarkIndex"]);
  var patch = {};
  if (!s.settings) patch.settings = DEFAULT_SETTINGS;
  if (!Array.isArray(s.suggestions)) patch.suggestions = [];
  if (!Array.isArray(s.dismissed)) patch.dismissed = [];
  if (!s.bookmarkIndex) patch.bookmarkIndex = { keys: [], domains: [], updatedAt: 0 };
  if (Object.keys(patch).length) await setLocal(patch);
  refreshBadge();
});

chrome.runtime.onStartup.addListener(refreshBadge);

/* ---------- tab monitoring ---------- */

var timers = new Map();

function considerTab(tab) {
  if (!tab || typeof tab.id !== "number" || !tab.url) return;
  clearTimeout(timers.get(tab.id));
  timers.set(tab.id, setTimeout(function () {
    timers.delete(tab.id);
    processTab(tab).catch(function (e) { console.warn("[suggestions] process failed:", e); });
  }, DEBOUNCE_MS));
}

chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
  // Fires for full loads (status) and in-page / SPA navigations (url).
  if (changeInfo.status === "complete" || typeof changeInfo.url === "string") {
    considerTab(tab);
  }
});

chrome.tabs.onActivated.addListener(async function (info) {
  try {
    var tab = await new Promise(function (res, rej) {
      chrome.tabs.get(info.tabId, function (t) {
        var err = chrome.runtime.lastError;
        if (err) rej(err); else res(t);
      });
    });
    considerTab(tab);
  } catch (_e) { /* tab gone */ }
});

chrome.tabs.onRemoved.addListener(function (tabId) {
  clearTimeout(timers.get(tabId));
  timers.delete(tabId);
});

async function processTab(tab) {
  var st = await getState();

  if (tab.incognito && !st.settings.monitorIncognito) return;

  var ctx = {
    settings: st.settings,
    bookmarkKeys: new Set(st.bookmarkIndex.keys),
    bookmarkDomains: new Set(st.bookmarkIndex.domains),
    dismissed: st.dismissed,
    pendingKeys: new Set(st.suggestions.map(function (s) { return s.key; })),
    pendingDomains: new Set(st.suggestions.map(function (s) { return s.domain; }))
  };

  var verdict = SC.shouldSuggest(tab.url, ctx);
  if (!verdict.ok) return;

  var norm = verdict.norm;
  var entry = {
    id: "sg_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8),
    key: norm.key,
    domain: norm.domain,
    url: norm.cleanUrl,
    rawUrl: typeof tab.url === "string" ? tab.url.slice(0, SC.MAX_URL_LENGTH) : norm.cleanUrl,
    title: String(tab.title || norm.host || norm.cleanUrl).slice(0, 300),
    favicon: SC.sanitizeFavicon(tab.favIconUrl),
    detectedAt: Date.now()
  };

  var next = SC.addSuggestion(st.suggestions, entry);
  if (next === st.suggestions) return; // duplicate key — nothing to do

  await setLocal({ suggestions: next.slice(0, MAX_SUGGESTIONS) });
  refreshBadge(next.length);
}

/* ---------- badge ---------- */

async function refreshBadge(count) {
  if (typeof count !== "number") {
    var s = await getLocal("suggestions");
    count = Array.isArray(s.suggestions) ? s.suggestions.length : 0;
  }
  try {
    chrome.action.setBadgeText({ text: count ? String(count) : "" });
    chrome.action.setBadgeBackgroundColor({ color: "#2563eb" });
  } catch (_e) {}
}

/* ---------- messages from bridge / popup ---------- */

chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
  handleMessage(msg)
    .then(sendResponse)
    .catch(function (e) { sendResponse({ ok: false, error: String(e && e.message || e) }); });
  return true; // async
});

function recordDismissal(dismissed, sug, settings) {
  if (!sug || !settings.suggestOncePerUrl) return dismissed;
  var scope = settings.dedupeScope === "domain" ? "domain" : "exact";
  var dkey = scope === "domain" ? sug.domain : sug.key;
  if (dismissed.some(function (d) { return d.key === dkey && d.scope === scope; })) return dismissed;
  return dismissed.concat([{ key: dkey, scope: scope, at: Date.now() }]).slice(-MAX_DISMISSED);
}

async function handleMessage(msg) {
  if (!msg || typeof msg !== "object") return { ok: false, error: "bad message" };
  var st = await getState();

  switch (msg.type) {
    case "getSnapshot":
      return {
        ok: true,
        settings: st.settings,
        suggestions: SC.sortNewestFirst(st.suggestions),
        dismissedCount: st.dismissed.length
      };

    case "save": {
      // The dashboard owns the bookmark database and has already saved it.
      // Here we only drop the suggestion and pre-seed the bookmark index so the
      // same URL is not re-suggested before the dashboard pushes a fresh index.
      var sug = st.suggestions.find(function (s) { return s.id === msg.id; });
      var nextS = SC.removeSuggestion(st.suggestions, msg.id);
      var idx = st.bookmarkIndex;
      if (sug) {
        idx = {
          keys: Array.from(new Set(idx.keys.concat([sug.key]))),
          domains: Array.from(new Set(idx.domains.concat([sug.domain]))),
          updatedAt: Date.now()
        };
      }
      await setLocal({ suggestions: nextS, bookmarkIndex: idx });
      refreshBadge(nextS.length);
      return { ok: true, suggestions: SC.sortNewestFirst(nextS) };
    }

    case "dismiss": {
      var s2 = st.suggestions.find(function (s) { return s.id === msg.id; });
      var nextS2 = SC.removeSuggestion(st.suggestions, msg.id);
      var dismissed2 = recordDismissal(st.dismissed, s2, st.settings);
      await setLocal({ suggestions: nextS2, dismissed: dismissed2 });
      refreshBadge(nextS2.length);
      return { ok: true, suggestions: SC.sortNewestFirst(nextS2) };
    }

    case "dismissAll": {
      var dismissed3 = st.dismissed;
      st.suggestions.forEach(function (sug) {
        dismissed3 = recordDismissal(dismissed3, sug, st.settings);
      });
      await setLocal({ suggestions: [], dismissed: dismissed3 });
      refreshBadge(0);
      return { ok: true, suggestions: [] };
    }

    case "updateSettings": {
      var next = Object.assign({}, st.settings, SC.sanitizeSettings(msg.payload));
      await setLocal({ settings: next });
      return { ok: true, settings: next };
    }

    case "clearDismissed":
      await setLocal({ dismissed: [] });
      return { ok: true, dismissedCount: 0 };

    case "registerDashboard": {
      var url = typeof msg.url === "string" ? msg.url : "";
      if (/^file:\/\//i.test(url) || /^https?:\/\/(localhost|127\.0\.0\.1)[:/]/i.test(url)) {
        await setLocal({ dashboardUrl: url.slice(0, SC.MAX_URL_LENGTH) });
      }
      return { ok: true };
    }

    case "pauseFor": {
      var ms = typeof msg.ms === "number" && msg.ms > 0 ? msg.ms : 0;
      var until = ms ? Date.now() + Math.min(ms, 366 * 864e5) : 0;
      var ns = Object.assign({}, st.settings, { pausedUntil: until });
      await setLocal({ settings: ns });
      return { ok: true, settings: ns };
    }

    case "syncBookmarkIndex": {
      var keys = (msg.payload && msg.payload.keys || []).filter(function (x) { return typeof x === "string"; });
      var domains = (msg.payload && msg.payload.domains || []).filter(function (x) { return typeof x === "string"; });
      await setLocal({ bookmarkIndex: { keys: keys, domains: domains, updatedAt: Date.now() } });
      // Drop any pending suggestion that is now bookmarked.
      var bk = new Set(keys), bd = new Set(domains);
      var domainMode = st.settings.dedupeScope === "domain";
      var pruned = st.suggestions.filter(function (s) {
        return !bk.has(s.key) && !(domainMode && bd.has(s.domain));
      });
      if (pruned.length !== st.suggestions.length) {
        await setLocal({ suggestions: pruned });
        refreshBadge(pruned.length);
      }
      return { ok: true };
    }

    default:
      return { ok: false, error: "unknown type: " + msg.type };
  }
}
