/*
 * suggest-core.js  —  canonical shared logic for Bookmark Suggestions
 * -------------------------------------------------------------------
 * Pure, DOM-free functions used by:
 *   - the extension service worker      (importScripts)
 *   - the extension content-script bridge (content_scripts js[])
 *   - the dashboard page                 (<script src>)
 *   - the test runners                   (browser <script> and `node --test`)
 *
 * UMD wrapper below exposes the API as `self.SuggestCore` / `window.SuggestCore`
 * and as CommonJS `module.exports`.
 *
 * There is only ONE copy of this file. The dashboard loads it from
 * ../../index.html via  <script src="extension/shared/suggest-core.js">.
 */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SuggestCore = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var MAX_URL_LENGTH = 2048;

  // Query keys that are pure tracking / analytics noise (exact match, case-insensitive).
  var TRACKING_PARAMS = new Set([
    "gclid", "dclid", "gclsrc", "gbraid", "wbraid", "gad_source",
    "fbclid", "msclkid", "yclid", "twclid", "igshid", "igsh",
    "mc_eid", "mc_cid", "mkt_tok", "_hsenc", "_hsmi", "hsctatracking",
    "vero_id", "vero_conv", "oly_anon_id", "oly_enc_id",
    "s_kwcid", "ef_id", "cmpid", "campid", "trk", "trkcampaign",
    "spm", "scm", "share", "ref_src", "ref_url",
    "_ga", "_gl", "ga_source", "ga_medium", "ga_campaign", "ga_content", "ga_term"
  ]);
  // Query key prefixes that are tracking noise.
  var TRACKING_PREFIXES = ["utm_", "pk_", "piwik_", "matomo_", "hsa_", "at_"];

  var DEV_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]", "ip6-localhost"]);
  var DEV_SUFFIXES = [".local", ".localhost", ".test", ".internal", ".lan", ".home.arpa"];

  function isPlainObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
  }

  function parseUrl(raw) {
    try { return new URL(raw); } catch (_e) { return null; }
  }

  function stripWww(host) {
    return host.replace(/^www\d*\./, "");
  }

  function isPrivateIp(host) {
    var h = host.replace(/^\[/, "").replace(/\]$/, "");
    if (h === "::1") return true;
    if (/^fe80:/i.test(h) || /^fc00:/i.test(h) || /^fd[0-9a-f]{2}:/i.test(h)) return true;
    var m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) return false;
    var a = +m[1], b = +m[2];
    if (a === 10 || a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    return false;
  }

  function isDevHost(host) {
    host = String(host || "").toLowerCase();
    if (DEV_HOSTS.has(host)) return true;
    if (isPrivateIp(host)) return true;
    for (var i = 0; i < DEV_SUFFIXES.length; i++) {
      if (host.endsWith(DEV_SUFFIXES[i])) return true;
    }
    return false;
  }

  function isTrackingParam(key) {
    var lk = key.toLowerCase();
    if (TRACKING_PARAMS.has(lk)) return true;
    for (var i = 0; i < TRACKING_PREFIXES.length; i++) {
      if (lk.indexOf(TRACKING_PREFIXES[i]) === 0) return true;
    }
    return false;
  }

  /**
   * Normalize a URL for storage + comparison.
   * Returns null when the URL cannot be safely stored.
   * Otherwise: { key, cleanUrl, host, domain, origin, scheme }
   *   key      - scheme-less canonical string used for dedupe (host w/o www + port + path + sorted query)
   *   cleanUrl - display / storage URL with tracking params + fragment removed
   *   domain   - registrable-ish host (hostname minus leading www.)
   */
  function normalizeUrl(raw) {
    if (typeof raw !== "string") return null;
    raw = raw.trim();
    if (!raw || raw.length > MAX_URL_LENGTH) return null;

    var u = parseUrl(raw);
    if (!u) return null;
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (u.username || u.password) return null;
    if (!u.hostname) return null;

    var scheme = u.protocol.replace(":", "");
    var host = u.hostname.toLowerCase();
    var keyHost = stripWww(host);

    var isDefaultPort =
      !u.port ||
      (scheme === "http" && u.port === "80") ||
      (scheme === "https" && u.port === "443");
    var portPart = isDefaultPort ? "" : ":" + u.port;

    // Path: collapse, drop trailing slash unless it is the root.
    var path = u.pathname || "/";
    if (path.length > 1) path = path.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
    if (path === "") path = "/";

    // Query: drop tracking params, sort the rest for a stable key.
    var pairs = [];
    u.searchParams.forEach(function (value, key) {
      if (!isTrackingParam(key)) pairs.push([key, value]);
    });
    pairs.sort(function (a, b) {
      if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
      return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0;
    });
    var qs = pairs
      .map(function (p) {
        return p[1] === ""
          ? encodeURIComponent(p[0])
          : encodeURIComponent(p[0]) + "=" + encodeURIComponent(p[1]);
      })
      .join("&");

    var key = keyHost + portPart + path + (qs ? "?" + qs : "");
    var cleanUrl = scheme + "://" + host + portPart + path + (qs ? "?" + qs : "");

    return {
      key: key,
      cleanUrl: cleanUrl,
      host: host,
      domain: keyHost,
      origin: scheme + "://" + host + portPart,
      scheme: scheme
    };
  }

  /** Key used for dedupe given the current scope setting. */
  function scopeKey(norm, scope) {
    if (!norm) return null;
    return scope === "domain" ? norm.domain : norm.key;
  }

  /**
   * Fast reason string for why a raw URL must be ignored, or null when it is a
   * candidate. Does NOT consult bookmarks / dismissed / pending — see shouldSuggest.
   */
  function rejectionReason(raw, settings) {
    settings = settings || {};
    if (typeof raw !== "string" || !raw.trim()) return "empty";
    var trimmed = raw.trim();

    // Anything that is not http(s) is out: chrome://, edge://, about:, view-source:,
    // chrome-extension://, moz-extension://, data:, blob:, javascript:, file:, ftp:, ws:
    if (!/^https?:\/\//i.test(trimmed)) return "non-web-scheme";
    if (trimmed.length > MAX_URL_LENGTH) return "too-long";

    var u = parseUrl(trimmed);
    if (!u) return "unparseable";
    if (u.protocol !== "http:" && u.protocol !== "https:") return "non-web-scheme";
    if (u.username || u.password) return "embedded-credentials";

    var host = u.hostname.toLowerCase();
    if (!host) return "no-host";
    if (host === "newtab" || host === "new-tab-page" || host === "blank") return "browser-page";

    if (isDevHost(host) && !settings.devMode) return "dev-host";
    return null;
  }

  /**
   * Decide whether a page should become a suggestion.
   * ctx: {
   *   settings, bookmarkKeys:Set, bookmarkDomains:Set,
   *   dismissed:[{key,scope}], pendingKeys:Set, pendingDomains:Set,
   *   dashboardUrls:string[]
   * }
   * returns { ok:true, norm } | { ok:false, reason }
   */
  function shouldSuggest(raw, ctx) {
    ctx = ctx || {};
    var settings = ctx.settings || {};

    if (settings.enabled === false) return { ok: false, reason: "disabled" };
    if (settings.pausedUntil && Date.now() < settings.pausedUntil) {
      return { ok: false, reason: "paused" };
    }

    var rej = rejectionReason(raw, settings);
    if (rej) return { ok: false, reason: rej };

    var norm = normalizeUrl(raw);
    if (!norm) return { ok: false, reason: "not-storable" };

    var scope = settings.dedupeScope === "domain" ? "domain" : "exact";

    // The dashboard itself (covers a localhost / http deployment; file:// is already
    // excluded by the scheme check).
    if (Array.isArray(ctx.dashboardUrls)) {
      for (var i = 0; i < ctx.dashboardUrls.length; i++) {
        var dn = normalizeUrl(ctx.dashboardUrls[i]);
        if (dn && dn.key === norm.key) return { ok: false, reason: "dashboard" };
      }
    }

    if (ctx.bookmarkKeys && ctx.bookmarkKeys.has(norm.key)) {
      return { ok: false, reason: "already-bookmarked" };
    }
    if (scope === "domain" && ctx.bookmarkDomains && ctx.bookmarkDomains.has(norm.domain)) {
      return { ok: false, reason: "already-bookmarked" };
    }

    if (Array.isArray(ctx.dismissed)) {
      for (var j = 0; j < ctx.dismissed.length; j++) {
        var d = ctx.dismissed[j];
        if (!d || typeof d.key !== "string") continue;
        if (d.scope === "domain" && d.key === norm.domain) return { ok: false, reason: "dismissed" };
        if ((!d.scope || d.scope === "exact") && d.key === norm.key) return { ok: false, reason: "dismissed" };
      }
    }

    if (ctx.pendingKeys && ctx.pendingKeys.has(norm.key)) {
      return { ok: false, reason: "already-pending" };
    }
    if (scope === "domain" && ctx.pendingDomains && ctx.pendingDomains.has(norm.domain)) {
      return { ok: false, reason: "already-pending" };
    }

    return { ok: true, norm: norm };
  }

  /* ---------- suggestion list reducers (pure) ---------- */

  function addSuggestion(list, entry) {
    if (!Array.isArray(list)) list = [];
    if (!entry || typeof entry.key !== "string") return list;
    for (var i = 0; i < list.length; i++) {
      if (list[i].key === entry.key) return list; // dedupe: same URL from N tabs => 1
    }
    return [entry].concat(list);
  }

  function removeSuggestion(list, id) {
    if (!Array.isArray(list)) return [];
    return list.filter(function (s) { return s.id !== id; });
  }

  function sortNewestFirst(list) {
    return (Array.isArray(list) ? list.slice() : []).sort(function (a, b) {
      return (b.detectedAt || 0) - (a.detectedAt || 0);
    });
  }

  /* ---------- bookmark-side helpers ---------- */

  /** Build the {keys, domains} index the extension uses to skip already-saved sites. */
  function buildBookmarkIndex(bookmarks) {
    var keys = [], domains = [];
    (bookmarks || []).forEach(function (b) {
      var n = normalizeUrl(b && b.url);
      if (!n) return;
      keys.push(n.key);
      domains.push(n.domain);
    });
    return { keys: uniq(keys), domains: uniq(domains) };
  }

  /** Return the existing bookmark that duplicates rawUrl, or null. */
  function findBookmarkDuplicate(bookmarks, rawUrl, scope) {
    var n = normalizeUrl(rawUrl);
    if (!n) return null;
    var wantDomain = scope === "domain";
    for (var i = 0; i < (bookmarks || []).length; i++) {
      var bn = normalizeUrl(bookmarks[i].url);
      if (!bn) continue;
      if (bn.key === n.key) return bookmarks[i];
      if (wantDomain && bn.domain === n.domain) return bookmarks[i];
    }
    return null;
  }

  function uniq(arr) {
    var seen = new Set(), out = [];
    for (var i = 0; i < arr.length; i++) {
      if (!seen.has(arr[i])) { seen.add(arr[i]); out.push(arr[i]); }
    }
    return out;
  }

  /* ---------- favicon hardening ---------- */

  function sanitizeFavicon(fav) {
    if (typeof fav !== "string" || !fav) return "";
    if (fav.indexOf("data:image/") === 0) return fav.length <= 20000 ? fav : "";
    var u = parseUrl(fav);
    if (u && (u.protocol === "https:" || u.protocol === "http:")) return u.href;
    return "";
  }

  /* ---------- extension <-> dashboard message protocol ---------- */

  var PROTOCOL = "bookmark-suggest/v1";
  var DIR_PAGE_TO_EXT = "page->ext";
  var DIR_EXT_TO_PAGE = "ext->page";
  var PAGE_ACTIONS = new Set([
    "hello", "requestSnapshot",
    "save", "dismiss", "saveMany", "dismissAll",
    "updateSettings", "clearDismissed", "syncBookmarkIndex"
  ]);

  /**
   * Validate a message received by the bridge from the page.
   * Returns a sanitized { action, payload } or null (reject).
   * `expectedNonce` may be null only for the "hello" handshake.
   */
  function validatePageMessage(data, expectedNonce) {
    if (!isPlainObject(data)) return null;
    if (data.protocol !== PROTOCOL) return null;
    if (data.dir !== DIR_PAGE_TO_EXT) return null;
    if (typeof data.action !== "string" || !PAGE_ACTIONS.has(data.action)) return null;

    if (data.action !== "hello") {
      if (!expectedNonce || data.nonce !== expectedNonce) return null;
    }

    var p = isPlainObject(data.payload) ? data.payload : {};
    var out = { action: data.action, payload: {} };

    switch (data.action) {
      case "save":
      case "dismiss":
        if (typeof p.id !== "string" || !p.id) return null;
        out.payload = { id: p.id };
        break;
      case "saveMany":
        if (!Array.isArray(p.ids) || !p.ids.every(function (x) { return typeof x === "string"; })) return null;
        out.payload = { ids: p.ids.slice(0, 500) };
        break;
      case "updateSettings":
        out.payload = sanitizeSettings(p);
        break;
      case "syncBookmarkIndex":
        if (!Array.isArray(p.keys) || !Array.isArray(p.domains)) return null;
        out.payload = {
          keys: p.keys.filter(function (x) { return typeof x === "string"; }).slice(0, 20000),
          domains: p.domains.filter(function (x) { return typeof x === "string"; }).slice(0, 20000)
        };
        break;
      default:
        out.payload = {};
    }
    return out;
  }

  function validateExtMessage(data) {
    if (!isPlainObject(data)) return null;
    if (data.protocol !== PROTOCOL) return null;
    if (data.dir !== DIR_EXT_TO_PAGE) return null;
    if (typeof data.type !== "string") return null;
    return data;
  }

  var SETTINGS_DEFAULTS = {
    enabled: true,
    dedupeScope: "exact",        // "exact" | "domain"
    suggestOncePerUrl: true,
    devMode: false,
    monitorIncognito: false,
    pausedUntil: 0
  };

  function sanitizeSettings(p) {
    var out = {};
    if (!isPlainObject(p)) return out;
    if (typeof p.enabled === "boolean") out.enabled = p.enabled;
    if (p.dedupeScope === "exact" || p.dedupeScope === "domain") out.dedupeScope = p.dedupeScope;
    if (typeof p.suggestOncePerUrl === "boolean") out.suggestOncePerUrl = p.suggestOncePerUrl;
    if (typeof p.devMode === "boolean") out.devMode = p.devMode;
    if (typeof p.monitorIncognito === "boolean") out.monitorIncognito = p.monitorIncognito;
    if (typeof p.pausedUntil === "number" && isFinite(p.pausedUntil) && p.pausedUntil >= 0) {
      out.pausedUntil = Math.min(p.pausedUntil, Date.now() + 366 * 864e5);
    }
    return out;
  }

  function withDefaults(settings) {
    return Object.assign({}, SETTINGS_DEFAULTS, sanitizeSettings(settings || {}));
  }

  return {
    MAX_URL_LENGTH: MAX_URL_LENGTH,
    PROTOCOL: PROTOCOL,
    SETTINGS_DEFAULTS: SETTINGS_DEFAULTS,
    normalizeUrl: normalizeUrl,
    scopeKey: scopeKey,
    isDevHost: isDevHost,
    isTrackingParam: isTrackingParam,
    rejectionReason: rejectionReason,
    shouldSuggest: shouldSuggest,
    addSuggestion: addSuggestion,
    removeSuggestion: removeSuggestion,
    sortNewestFirst: sortNewestFirst,
    buildBookmarkIndex: buildBookmarkIndex,
    findBookmarkDuplicate: findBookmarkDuplicate,
    sanitizeFavicon: sanitizeFavicon,
    validatePageMessage: validatePageMessage,
    validateExtMessage: validateExtMessage,
    sanitizeSettings: sanitizeSettings,
    withDefaults: withDefaults
  };
});
