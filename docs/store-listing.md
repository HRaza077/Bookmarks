# Store listing kit — Bookmark Suggestions extension

Everything below is ready to copy-paste into the Chrome Web Store Developer
Dashboard and the Microsoft Edge Add-ons (Partner Center) submission forms.
The 1280×800 screenshot is in this folder (`store-screenshot-1280x800.png`);
build the upload zip with the one-liner in §2.

---

## 1. Accounts (one-time, before you can submit)

**Chrome Web Store**
1. Go to the [Chrome Web Store Developer Dashboard](https://chromewebstore.google.com/devconsole).
2. Sign in with a Google account.
3. Pay the one-time **$5 USD registration fee** (credit card) — this is a
   single lifetime fee for the account, not per extension.

**Edge Add-ons**
1. Go to [Microsoft Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/overview).
2. Sign in with (or create) a Microsoft account and register as a developer —
   **free**, no fee.

---

## 2. The package to upload

Build the zip from the repo root (same zip works for **both** stores — it has
`manifest.json` at the archive root, not nested in a subfolder, which is what
both stores require):

```powershell
Compress-Archive -Path extension\* -DestinationPath bookmark-suggestions-extension.zip -Force
```

Re-run that command after any edit to `extension/`, then upload the fresh zip.
It's git-ignored — a build artifact, not source.

---

## 3. Store listing fields (copy-paste)

**Name**
```
Bookmark Suggestions — My Bookmarks Dashboard
```

**Summary / short description** (Chrome limit: 132 characters — this is 131)
```
Suggests pages you visit as bookmarks for your local Bookmark Dashboard. 100% on-device — no account, no server, no tracking.
```

**Detailed description**
```
Bookmark Suggestions is the companion extension for the free, open-source
Bookmark Dashboard (bookmarks.skillihire.com). As you browse, it quietly
notices pages worth bookmarking and offers them to you with a simple Yes/No
choice — no need to remember to bookmark something while you're on the page.

Everything happens on your own device:
• No account, sign-up, or API key
• No servers — this extension has nowhere to send your data even if it wanted to
• No analytics, telemetry, or tracking of any kind
• Minimal permissions: only "tabs" (to read the current page's URL/title) and
  "storage" (to save your suggestions and settings locally)

How it works:
1. Install the extension and open your Bookmark Dashboard.
2. Browse normally. Pages you haven't already bookmarked will appear as
   suggestions in the dashboard's "Bookmark Suggestions" panel.
3. Click "Yes, Save" to bookmark it, or "No, Dismiss" to ignore it — dismissed
   pages are never suggested again.

Smart filtering built in: internal browser pages, localhost, private
networks, and pages with tracking parameters in the URL are automatically
excluded (tracking parameters like utm_*, fbclid, and gclid are also stripped
before comparison, so trivially different URLs to the same page aren't
suggested as duplicates).

Full source code, security details, and the standalone dashboard are all
available on GitHub — see the extension's homepage link on this listing.

Privacy policy: https://bookmarks.skillihire.com/privacy.html
```

**Category**
```
Workflow & Planning
```
(Chrome retired the old "Productivity" category in a 2023 taxonomy update —
"Workflow & Planning" is its modern equivalent for save-for-later /
organize-what-you-find tools like this one. "Tools" is a reasonable second
choice if that one doesn't feel right once you see the listing rendered.
Edge Add-ons still uses "Productivity" as a category name, so use that on
the Edge side.)

**Language**
```
English (United States)
```

**Store icon**
Use `extension/icons/icon128.png` from the project — already the right size.

**Screenshot**
Use `docs/store-screenshot-1280x800.png` — matches the store's required
1280×800 size exactly. You can add more screenshots later (up to 5); this one
is enough to submit.

**Website / homepage URL**
```
https://bookmarks.skillihire.com
```

**Privacy policy URL** (required by both stores before they'll approve)
```
https://bookmarks.skillihire.com/privacy.html
```

---

## 4. Privacy practices tab (Chrome) / data disclosure (Edge)

Both stores now require you to explicitly declare what data the extension
touches — this is separate from the privacy policy link above, and answering
it inaccurately is one of the most common rejection reasons, so read this
part carefully rather than just checking "no data collected."

**Single purpose description**
```
Watches the currently active browser tab to suggest pages the user might
want to bookmark in the companion Bookmark Dashboard web app, entirely
on-device.
```

**Permission justifications**

`tabs`:
```
Used to read the URL, title, and favicon of the active tab so the extension
can determine whether the page is a good bookmark suggestion. The extension
does not close, move, or otherwise manipulate tabs — it only reads these
three properties via the tabs.onUpdated/onActivated events.
```

`storage`:
```
Used to store pending suggestions, dismissed URLs, and user settings locally
via chrome.storage.local, so they persist between browser sessions. This data
is never transmitted anywhere.
```

**Host permission justification** (Chrome asks this because of the
`content_scripts.matches` list in manifest.json, even though
`host_permissions` itself is empty — it's asking where the content script
is allowed to run):
```
The content script (bridge.js) is scoped only to the extension's own
companion Bookmark Dashboard page via the manifest's content_scripts
matches list: the specific https://bookmarks.skillihire.com/* domain
(the hosted dashboard) and a small set of local file:// paths (for
users running the dashboard from disk instead of the hosted version).

It does not run on any other site the user visits. As a second layer of
defense beyond the match pattern, the script itself checks for a
<meta name="bookmark-dashboard"> tag before doing anything, and exits
immediately if that marker is absent — so even if a match pattern were
ever broadened by mistake, the script still would not activate on an
unrelated page.

Its only job on that page is relaying data between chrome.storage.local
and the dashboard via window.postMessage, using a per-load random nonce
and a fixed allow-list of message types (see validatePageMessage in
shared/suggest-core.js). It does not read, modify, or inject anything
into the page's own content, and it never runs on general websites the
user browses — only on this one dashboard page.
```

**Data collection disclosure** — the honest answer is that the extension
*does* touch "Web history" (the URLs of tabs you visit), because that's what
it needs to generate suggestions. Don't check "no data collected" — that
would contradict the permissions you're requesting and can get the listing
flagged. Instead:

- Under the "Web history" category, mark it as **collected**.
- Then certify (Chrome gives checkboxes for this) that the data is:
  - **Not** sold to third parties.
  - **Not** used or transferred for purposes unrelated to the extension's
    single purpose.
  - **Not** used or transferred to determine creditworthiness or for lending.
  - Stored/processed only on-device — never transmitted off the user's
    computer at all, which you can state in the free-text box if one is
    offered.
- Leave every other category (personally identifiable info, financial,
  health, location, authentication, personal communications, user activity
  beyond the above) unchecked — the extension genuinely doesn't touch any of
  those.

---

## 5. After you submit

- **Chrome** review typically takes anywhere from a few hours to a few days
  for a first submission.
- **Edge** certification is usually 1–3 business days, occasionally longer.
- Once approved, each store gives you a permanent listing URL
  (`https://chromewebstore.google.com/detail/<your-extension-id>` and an
  Edge equivalent). Save both — those are the `CHROME_STORE_URL` and
  `EDGE_STORE_URL` values the install-popup code (from the earlier Claude
  Code prompt) is waiting for. Once you have them, a one-line follow-up
  prompt to Claude Code — "fill in CHROME_STORE_URL with X and
  EDGE_STORE_URL with Y in index.html" — finishes the loop: the dashboard's
  "Yes, enable suggestions" button will then send people straight to the
  real "Add to Chrome"/"Get" button.
