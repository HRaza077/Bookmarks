/*
 * bridge.js — content script
 * --------------------------
 * Runs only on the Bookmark Dashboard page (verified by a <meta> marker).
 * Relays chrome.storage.local <-> the page over window.postMessage using a
 * per-load nonce. The page can never reach chrome.* directly; this script only
 * performs a fixed allow-list of validated operations.
 */
(function () {
  "use strict";

  if (!document.querySelector('meta[name="bookmark-dashboard"]')) return;

  var SC = window.SuggestCore; // provided by shared/suggest-core.js (same content-script world)
  if (!SC) return;

  var PROTOCOL = SC.PROTOCOL;
  var NONCE = "n_" + Math.random().toString(36).slice(2) + Date.now().toString(36);

  function toPage(type, extra) {
    var msg = { protocol: PROTOCOL, dir: "ext->page", nonce: NONCE, type: type };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) msg[k] = extra[k];
    window.postMessage(msg, "*");
  }

  function send(payload) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(payload, function (resp) {
          var err = chrome.runtime.lastError;
          if (err) resolve({ ok: false, error: err.message });
          else resolve(resp || { ok: false });
        });
      } catch (e) {
        resolve({ ok: false, error: String(e) });
      }
    });
  }

  async function pushSnapshot() {
    var resp = await send({ type: "getSnapshot" });
    if (resp && resp.ok) {
      toPage("snapshot", {
        settings: resp.settings,
        suggestions: resp.suggestions,
        dismissedCount: resp.dismissedCount
      });
    } else {
      toPage("error", { message: (resp && resp.error) || "extension unavailable" });
    }
  }

  window.addEventListener("message", async function (event) {
    if (event.source !== window) return;
    var parsed = SC.validatePageMessage(event.data, NONCE);
    if (!parsed) return;

    try {
      switch (parsed.action) {
        case "hello":
        case "requestSnapshot":
          await pushSnapshot();
          break;
        case "save":
          await send({ type: "save", id: parsed.payload.id });
          await pushSnapshot();
          break;
        case "dismiss":
          await send({ type: "dismiss", id: parsed.payload.id });
          await pushSnapshot();
          break;
        case "saveMany":
          for (var i = 0; i < parsed.payload.ids.length; i++) {
            await send({ type: "save", id: parsed.payload.ids[i] });
          }
          await pushSnapshot();
          break;
        case "dismissAll":
          await send({ type: "dismissAll" });
          await pushSnapshot();
          break;
        case "updateSettings":
          await send({ type: "updateSettings", payload: parsed.payload });
          await pushSnapshot();
          break;
        case "clearDismissed":
          await send({ type: "clearDismissed" });
          await pushSnapshot();
          break;
        case "syncBookmarkIndex":
          await send({ type: "syncBookmarkIndex", payload: parsed.payload });
          break;
      }
    } catch (e) {
      toPage("error", { message: String(e && e.message || e) });
    }
  });

  // Near-real-time updates: any local storage change re-syncs the page.
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== "local") return;
    if (changes.suggestions || changes.settings || changes.dismissed) pushSnapshot();
  });

  // Announce presence, register this page so the popup can reopen it, then sync.
  toPage("hello");
  send({ type: "registerDashboard", url: location.href });
  pushSnapshot();
})();
