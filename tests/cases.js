/*
 * cases.js — shared test cases for suggest-core.js
 * Runs in the browser (tests/run.html) and in Node (tests/run-node.mjs).
 * Exposes a factory: SuggestCases(SC) -> [{ name, fn }]
 * Each fn(assert) throws on failure.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.SuggestCases = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  return function buildCases(SC) {
    var settings = SC.withDefaults({});
    var devSettings = SC.withDefaults({ devMode: true });

    function norm(u) { return SC.normalizeUrl(u); }
    function key(u) { var n = norm(u); return n && n.key; }

    return [
      /* ---------------- URL normalization ---------------- */
      { name: "normalize: trailing slash is ignored", fn: function (a) {
        a.equal(key("https://example.com/path/"), key("https://example.com/path"));
      }},
      { name: "normalize: root slash equals bare host", fn: function (a) {
        a.equal(key("https://example.com"), key("https://example.com/"));
      }},
      { name: "normalize: URL fragment is dropped", fn: function (a) {
        a.equal(key("https://example.com/a#section-2"), key("https://example.com/a"));
      }},
      { name: "normalize: domain case is folded", fn: function (a) {
        a.equal(key("https://EXAMPLE.com/A"), key("https://example.com/A"));
      }},
      { name: "normalize: path case is preserved", fn: function (a) {
        a.notEqual(key("https://example.com/A"), key("https://example.com/a"));
      }},
      { name: "normalize: leading www. is folded", fn: function (a) {
        a.equal(key("https://www.example.com/x"), key("https://example.com/x"));
      }},
      { name: "normalize: default ports removed", fn: function (a) {
        a.equal(key("http://example.com:80/x"), key("http://example.com/x"));
        a.equal(key("https://example.com:443/x"), key("https://example.com/x"));
      }},
      { name: "normalize: non-default port kept", fn: function (a) {
        a.notEqual(key("https://example.com:8443/x"), key("https://example.com/x"));
      }},
      { name: "normalize: utm_* and click ids stripped", fn: function (a) {
        a.equal(
          key("https://example.com/p?utm_source=nl&utm_medium=email&gclid=abc&fbclid=xyz"),
          key("https://example.com/p")
        );
      }},
      { name: "normalize: meaningful query kept, order-independent", fn: function (a) {
        a.equal(key("https://example.com/s?b=2&a=1"), key("https://example.com/s?a=1&b=2"));
        a.notEqual(key("https://example.com/s?a=1"), key("https://example.com/s?a=2"));
      }},
      { name: "normalize: http vs https collapse to one key", fn: function (a) {
        a.equal(key("http://example.com/x"), key("https://example.com/x"));
      }},
      { name: "normalize: cleanUrl keeps scheme + host casing lower", fn: function (a) {
        a.equal(norm("HTTPS://Example.com/Path/?utm_source=x#frag").cleanUrl, "https://example.com/Path");
      }},
      { name: "normalize: credentials in URL are rejected", fn: function (a) {
        a.equal(norm("https://user:pass@example.com/"), null);
      }},
      { name: "normalize: non-web schemes rejected", fn: function (a) {
        ["ftp://example.com/f", "data:text/html,x", "javascript:alert(1)", "file:///c:/x", "blob:https://x/y"]
          .forEach(function (u) { a.equal(norm(u), null, u); });
      }},
      { name: "normalize: over-length URL rejected", fn: function (a) {
        a.equal(norm("https://example.com/" + new Array(3000).join("a")), null);
      }},
      { name: "normalize: domain field is host without www", fn: function (a) {
        a.equal(norm("https://www.sub.example.com/x").domain, "sub.example.com");
      }},

      /* ---------------- ignore rules ---------------- */
      { name: "reject: browser internal pages", fn: function (a) {
        ["chrome://newtab/", "edge://settings", "about:blank", "about:config",
         "chrome-extension://abcd/page.html", "moz-extension://abcd/x", "view-source:https://x.com"]
          .forEach(function (u) { a.ok(SC.rejectionReason(u, settings), "should reject " + u); });
      }},
      { name: "reject: new tab / blank", fn: function (a) {
        a.equal(SC.rejectionReason("about:blank", settings), "non-web-scheme");
      }},
      { name: "reject: localhost & private IPs when devMode off", fn: function (a) {
        ["http://localhost:3000/", "http://127.0.0.1/", "http://192.168.1.10/app",
         "http://10.0.0.5/", "http://foo.local/", "http://api.test/"]
          .forEach(function (u) { a.equal(SC.rejectionReason(u, settings), "dev-host", u); });
      }},
      { name: "allow: localhost when devMode on", fn: function (a) {
        a.equal(SC.rejectionReason("http://localhost:3000/", devSettings), null);
      }},
      { name: "allow: normal https page", fn: function (a) {
        a.equal(SC.rejectionReason("https://en.wikipedia.org/wiki/Bookmark", settings), null);
      }},
      { name: "isDevHost recognises loopback & suffixes", fn: function (a) {
        a.ok(SC.isDevHost("localhost"));
        a.ok(SC.isDevHost("127.0.0.1"));
        a.ok(SC.isDevHost("thing.local"));
        a.ok(!SC.isDevHost("example.com"));
      }},

      /* ---------------- duplicate / dismissed / pending ---------------- */
      { name: "shouldSuggest: blocked when already bookmarked (exact)", fn: function (a) {
        var ctx = { settings: settings, bookmarkKeys: new Set([key("https://example.com/a")]) };
        a.equal(SC.shouldSuggest("https://example.com/a/?utm_source=x#y", ctx).ok, false);
        a.equal(SC.shouldSuggest("https://example.com/a/?utm_source=x#y", ctx).reason, "already-bookmarked");
      }},
      { name: "shouldSuggest: domain mode blocks other pages of a bookmarked site", fn: function (a) {
        var dom = SC.withDefaults({ dedupeScope: "domain" });
        var ctx = { settings: dom, bookmarkKeys: new Set(), bookmarkDomains: new Set(["example.com"]) };
        a.equal(SC.shouldSuggest("https://example.com/totally/other", ctx).ok, false);
      }},
      { name: "shouldSuggest: exact mode does NOT block sibling pages", fn: function (a) {
        var ctx = { settings: settings, bookmarkKeys: new Set([key("https://example.com/a")]), bookmarkDomains: new Set(["example.com"]) };
        a.equal(SC.shouldSuggest("https://example.com/b", ctx).ok, true);
      }},
      { name: "shouldSuggest: blocked when dismissed (exact)", fn: function (a) {
        var ctx = { settings: settings, dismissed: [{ key: key("https://example.com/a"), scope: "exact" }] };
        a.equal(SC.shouldSuggest("https://EXAMPLE.com/a#x", ctx).reason, "dismissed");
      }},
      { name: "shouldSuggest: blocked when dismissed (domain scope)", fn: function (a) {
        var dom = SC.withDefaults({ dedupeScope: "domain" });
        var ctx = { settings: dom, dismissed: [{ key: "example.com", scope: "domain" }] };
        a.equal(SC.shouldSuggest("https://example.com/anything", ctx).reason, "dismissed");
      }},
      { name: "shouldSuggest: not blocked after dismissed history cleared", fn: function (a) {
        var ctx = { settings: settings, dismissed: [] };
        a.equal(SC.shouldSuggest("https://example.com/a", ctx).ok, true);
      }},
      { name: "shouldSuggest: de-dupes against pending suggestions", fn: function (a) {
        var ctx = { settings: settings, pendingKeys: new Set([key("https://example.com/a")]) };
        a.equal(SC.shouldSuggest("https://example.com/a/?utm_source=q", ctx).reason, "already-pending");
      }},
      { name: "shouldSuggest: respects disabled + paused", fn: function (a) {
        a.equal(SC.shouldSuggest("https://x.com", { settings: SC.withDefaults({ enabled: false }) }).reason, "disabled");
        a.equal(SC.shouldSuggest("https://x.com", { settings: SC.withDefaults({ pausedUntil: Date.now() + 1e6 }) }).reason, "paused");
      }},
      { name: "shouldSuggest: ignores the dashboard's own URL", fn: function (a) {
        var ctx = { settings: settings, dashboardUrls: ["http://localhost:8777/index.html"] };
        // dashboard on localhost would otherwise be a dev-host reject; use devMode to isolate the dashboard rule
        ctx.settings = SC.withDefaults({ devMode: true });
        a.equal(SC.shouldSuggest("http://localhost:8777/index.html", ctx).reason, "dashboard");
      }},

      /* ---------------- suggestion list reducers ---------------- */
      { name: "addSuggestion: same key from several tabs => one entry", fn: function (a) {
        var list = [];
        list = SC.addSuggestion(list, { id: "1", key: "example.com/a", detectedAt: 1 });
        list = SC.addSuggestion(list, { id: "2", key: "example.com/a", detectedAt: 2 });
        a.equal(list.length, 1);
      }},
      { name: "addSuggestion: newest goes to the front", fn: function (a) {
        var list = SC.addSuggestion([{ id: "1", key: "a", detectedAt: 1 }], { id: "2", key: "b", detectedAt: 2 });
        a.equal(list[0].id, "2");
      }},
      { name: "removeSuggestion: drops by id", fn: function (a) {
        var list = SC.removeSuggestion([{ id: "1", key: "a" }, { id: "2", key: "b" }], "1");
        a.equal(list.length, 1); a.equal(list[0].id, "2");
      }},
      { name: "sortNewestFirst: descending by detectedAt", fn: function (a) {
        var out = SC.sortNewestFirst([{ detectedAt: 1 }, { detectedAt: 9 }, { detectedAt: 5 }]);
        a.equal(out.map(function (x) { return x.detectedAt; }).join(","), "9,5,1");
      }},

      /* ---------------- bookmark-side helpers ---------------- */
      { name: "buildBookmarkIndex: unique, normalized keys + domains", fn: function (a) {
        var idx = SC.buildBookmarkIndex([
          { url: "https://www.example.com/a/" },
          { url: "https://example.com/a?utm_source=x" },
          { url: "https://other.com/" },
          { url: "not a url" }
        ]);
        a.equal(idx.keys.length, 2);
        a.ok(idx.domains.indexOf("example.com") !== -1);
        a.ok(idx.domains.indexOf("other.com") !== -1);
      }},
      { name: "findBookmarkDuplicate: matches across tracking noise / slash", fn: function (a) {
        var bms = [{ id: "x", url: "https://example.com/read" }];
        a.ok(SC.findBookmarkDuplicate(bms, "https://www.example.com/read/?utm_medium=x#h", "exact"));
        a.equal(SC.findBookmarkDuplicate(bms, "https://example.com/other", "exact"), null);
      }},
      { name: "findBookmarkDuplicate: domain scope matches any page of the site", fn: function (a) {
        var bms = [{ id: "x", url: "https://example.com/read" }];
        a.ok(SC.findBookmarkDuplicate(bms, "https://example.com/elsewhere", "domain"));
      }},

      /* ---------------- favicon hardening ---------------- */
      { name: "sanitizeFavicon: allows http(s) and small data URIs, blocks the rest", fn: function (a) {
        a.equal(SC.sanitizeFavicon("https://x.com/favicon.ico"), "https://x.com/favicon.ico");
        a.equal(SC.sanitizeFavicon("data:image/png;base64,AAAA"), "data:image/png;base64,AAAA");
        a.equal(SC.sanitizeFavicon("javascript:alert(1)"), "");
        a.equal(SC.sanitizeFavicon("chrome://favicon/https://x.com"), "");
        a.equal(SC.sanitizeFavicon(""), "");
      }},

      /* ---------------- extension <-> dashboard message protocol ---------------- */
      { name: "protocol: valid save message accepted with correct nonce", fn: function (a) {
        var m = SC.validatePageMessage(
          { protocol: SC.PROTOCOL, dir: "page->ext", nonce: "N1", action: "save", payload: { id: "sg_1" } }, "N1");
        a.ok(m); a.equal(m.action, "save"); a.equal(m.payload.id, "sg_1");
      }},
      { name: "protocol: hello needs no nonce", fn: function (a) {
        a.ok(SC.validatePageMessage({ protocol: SC.PROTOCOL, dir: "page->ext", action: "hello" }, null));
      }},
      { name: "protocol: wrong nonce rejected", fn: function (a) {
        a.equal(SC.validatePageMessage(
          { protocol: SC.PROTOCOL, dir: "page->ext", nonce: "BAD", action: "save", payload: { id: "x" } }, "N1"), null);
      }},
      { name: "protocol: wrong protocol / direction rejected", fn: function (a) {
        a.equal(SC.validatePageMessage({ protocol: "evil", dir: "page->ext", action: "hello" }, null), null);
        a.equal(SC.validatePageMessage({ protocol: SC.PROTOCOL, dir: "ext->page", action: "hello" }, null), null);
      }},
      { name: "protocol: unknown action rejected", fn: function (a) {
        a.equal(SC.validatePageMessage(
          { protocol: SC.PROTOCOL, dir: "page->ext", nonce: "N1", action: "deleteEverything" }, "N1"), null);
      }},
      { name: "protocol: save without id rejected", fn: function (a) {
        a.equal(SC.validatePageMessage(
          { protocol: SC.PROTOCOL, dir: "page->ext", nonce: "N1", action: "save", payload: {} }, "N1"), null);
      }},
      { name: "protocol: updateSettings payload is sanitized (unknown keys dropped)", fn: function (a) {
        var m = SC.validatePageMessage(
          { protocol: SC.PROTOCOL, dir: "page->ext", nonce: "N1", action: "updateSettings",
            payload: { enabled: false, dedupeScope: "domain", evil: 1, pausedUntil: -5 } }, "N1");
        a.equal(m.payload.enabled, false);
        a.equal(m.payload.dedupeScope, "domain");
        a.equal("evil" in m.payload, false);
        a.equal("pausedUntil" in m.payload, false); // negative rejected
      }},
      { name: "protocol: syncBookmarkIndex requires arrays", fn: function (a) {
        a.equal(SC.validatePageMessage(
          { protocol: SC.PROTOCOL, dir: "page->ext", nonce: "N1", action: "syncBookmarkIndex", payload: { keys: "x" } }, "N1"), null);
        a.ok(SC.validatePageMessage(
          { protocol: SC.PROTOCOL, dir: "page->ext", nonce: "N1", action: "syncBookmarkIndex", payload: { keys: ["a"], domains: ["b"] } }, "N1"));
      }},
      { name: "protocol: validateExtMessage checks shape", fn: function (a) {
        a.ok(SC.validateExtMessage({ protocol: SC.PROTOCOL, dir: "ext->page", type: "snapshot" }));
        a.equal(SC.validateExtMessage({ protocol: SC.PROTOCOL, dir: "ext->page" }), null);
        a.equal(SC.validateExtMessage({ protocol: "nope", dir: "ext->page", type: "x" }), null);
      }},

      /* ---------------- first-run install prompt ---------------- */
      { name: "detectBrowser: Edge desktop UA", fn: function (a) {
        a.equal(SC.detectBrowser(
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0"), "edge");
      }},
      { name: "detectBrowser: plain Chrome UA", fn: function (a) {
        a.equal(SC.detectBrowser(
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"), "chrome");
      }},
      { name: "detectBrowser: Firefox and Safari are 'other'", fn: function (a) {
        a.equal(SC.detectBrowser("Mozilla/5.0 (Windows NT 10.0; rv:121.0) Gecko/20100101 Firefox/121.0"), "other");
        a.equal(SC.detectBrowser(
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"), "other");
      }},
      { name: "detectBrowser: Opera (OPR) is not treated as Chrome", fn: function (a) {
        a.equal(SC.detectBrowser(
          "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0"), "other");
      }},
      { name: "detectBrowser: userAgentData brands win over UA string", fn: function (a) {
        a.equal(SC.detectBrowser("…Chrome/120… Safari/537.36",
          { brands: [{ brand: "Chromium", version: "120" }, { brand: "Microsoft Edge", version: "120" }] }), "edge");
        a.equal(SC.detectBrowser("…Chrome/120… Safari/537.36",
          { brands: [{ brand: "Chromium", version: "120" }, { brand: "Google Chrome", version: "120" }] }), "chrome");
      }},
      { name: "detectBrowser: missing / junk input is 'other'", fn: function (a) {
        a.equal(SC.detectBrowser(), "other");
        a.equal(SC.detectBrowser("", null), "other");
        a.equal(SC.detectBrowser(123, { brands: "nope" }), "other");
      }},

      { name: "shouldShowInstallPrompt: shows when settled, unconnected, never dismissed", fn: function (a) {
        a.equal(SC.shouldShowInstallPrompt({ settled: true, connected: false, everConnected: false, lastDismissedAt: 0 }), true);
      }},
      { name: "shouldShowInstallPrompt: hidden while still connecting (not settled)", fn: function (a) {
        a.equal(SC.shouldShowInstallPrompt({ settled: false, connected: false, everConnected: false }), false);
      }},
      { name: "shouldShowInstallPrompt: hidden when connected", fn: function (a) {
        a.equal(SC.shouldShowInstallPrompt({ settled: true, connected: true, everConnected: false }), false);
      }},
      { name: "shouldShowInstallPrompt: hidden forever once everConnected", fn: function (a) {
        a.equal(SC.shouldShowInstallPrompt({ settled: true, connected: false, everConnected: true, lastDismissedAt: 0 }), false);
      }},
      { name: "shouldShowInstallPrompt: 14-day cooldown after a dismissal", fn: function (a) {
        var now = 1700000000000;
        var day = 864e5;
        a.equal(SC.shouldShowInstallPrompt({ settled: true, lastDismissedAt: now - 2 * day, now: now }), false);
        a.equal(SC.shouldShowInstallPrompt({ settled: true, lastDismissedAt: now - 13.9 * day, now: now }), false);
        a.equal(SC.shouldShowInstallPrompt({ settled: true, lastDismissedAt: now - 14.1 * day, now: now }), true);
        a.equal(SC.shouldShowInstallPrompt({ settled: true, lastDismissedAt: now - 40 * day, now: now }), true);
      }},
      { name: "shouldShowInstallPrompt: cooldownDays is configurable", fn: function (a) {
        var now = 1700000000000, day = 864e5;
        a.equal(SC.shouldShowInstallPrompt({ settled: true, lastDismissedAt: now - 5 * day, now: now, cooldownDays: 3 }), true);
        a.equal(SC.shouldShowInstallPrompt({ settled: true, lastDismissedAt: now - 5 * day, now: now, cooldownDays: 7 }), false);
      }},
      { name: "shouldShowInstallPrompt: tolerates missing ctx", fn: function (a) {
        a.equal(SC.shouldShowInstallPrompt(), false);          // not settled
        a.equal(SC.shouldShowInstallPrompt({ settled: true }), true);
      }}
    ];
  };
});
