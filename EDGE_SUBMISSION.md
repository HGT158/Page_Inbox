# Microsoft Edge Add-ons submission notes

Extension: **Page Inbox (网页稍后处理)** · Manifest V3 · Version 0.13.0

## Single purpose

Page Inbox is a local "read later" collection tool. It saves web page links into browser local storage so the user can review, tag, pin, batch-edit, search, copy as Markdown, import/export, and — entirely optionally — discuss the saved pages with an AI assistant inside a dedicated extension page.

The single purpose can be stated as: **save, organize, and reuse a personal list of web page links, locally.**

## Features overview (for reviewers)

- Popup: save current page, paste a URL, tags, notes, pin, batch operations (batch tag / mark done / delete), search and filters, copy Markdown, export JSON/Markdown, saved page indicator.
- Shortcuts: Alt+S global shortcut to save the active page with instantaneous badge feedback; Alt+B shortcut to open Page Inbox in the side panel.
- Dynamic badge: displays pending inbox count and highlights a checkmark when viewing an already saved page.
- Context menu: save the current page or a link; open Page Inbox in side panel.
- Side Panel (`sidepanel.html`): open Page Inbox in the browser side panel for persistent side-by-side reading and organization.
- Pure Reader Mode (`reader.html`): minimalist typography, 4 themes, font scaling, distraction-free article reading.
- Anti-backlog Serendipity: "Random Pick" dice button in popup and side panel to revisit dormant saved pages with "dormant for N days" badge and direct reader/open/archive actions; dedicated "Aged Gems & Serendipity" card in More tools page with >30 days backlog ratio.
- "More tools" page (`dashboard.html`): usage statistics, JSON import, CSV and Netscape HTML bookmark export, copy-all as Markdown.
- "AI analysis" page (`ai.html`), fully opt-in: pick saved pages from a list and chat about them. Works with (a) the browser's built-in on-device model (Chrome Prompt API) when available, or (b) an OpenAI-compatible endpoint the user configures themselves (endpoint URL + API key stored locally). To ground the answers, the extension can extract text from the selected pages: direct HTTP fetch first, or — only with per-site permission — a temporary background tab that reads the rendered page and is closed immediately.

## Permission justification

Required permissions:

- `activeTab`: Grants temporary access to the currently active tab only after an explicit user gesture — clicking the popup save button, using the context menu entry, or pressing the Alt+S keyboard shortcut. It is used to run the metadata-extraction script on that one tab; the URL and title shown on the badge are read via `tabs` below.
- `contextMenus`: Adds page and link context menu entries so the user can save pages or links.
- `scripting`: (1) Runs a small user-triggered script in the active tab to read the page title and description metadata when saving. (2) On the optional AI page, runs a text-extraction script inside a temporary background tab of a page the user explicitly asked to analyze — only for sites the user has granted access to.
- `sidePanel`: Allows displaying Page Inbox in the browser's side panel so users can organize and review saved pages side-by-side with web content without the popup automatically closing on clicks outside.
- `storage`: Stores the saved page list, tags, notes, status, AI settings, and AI chat history locally in `chrome.storage.local`.
- `tabs`: Reads the active tab's URL and title in the background to dynamically display the pending inbox count and the saved checkmark (`✓`) indicator on the extension action badge when viewing an already saved page. Triggers the standard browser install warning for reading browsing history; all tab data is processed entirely locally and never persisted or transmitted.

Optional host permissions (requested at runtime, per origin, never granted at install):

- `https://*/*`, `http://*/*`: Declared so the user can grant access to individual origins. Two runtime scenarios, both user-initiated:
  1. Fetching the text of a page the user selected for AI analysis (and opening its temporary background tab when a direct fetch fails).
  2. Calling the user-configured AI endpoint (e.g. `https://api.deepseek.com`).
  The extension requests only the specific origins involved (e.g. `https://example.com/*`), shows an in-page banner explaining what needs permission and why, and works in a degraded metadata-only mode when permission is denied.

## Remote code

No remote code is loaded or executed. All JavaScript, HTML, CSS, and localization files are packaged with the extension. No CDN scripts, no eval, no remote configuration.

## Data usage and privacy disclosure

- Saved pages (URL, title, optional description, tags, notes, status, pin state, timestamps) are stored only in the local `chrome.storage.local` of the user's browser profile.
- Manual exports (JSON / Markdown / CSV / Netscape HTML bookmarks) create local files at the user's explicit request. JSON import merges entries locally.
- The AI feature is opt-in and off by default in effect: nothing is sent anywhere until the user either uses the browser's built-in on-device model or explicitly configures their own API endpoint and key. When the user does chat about selected pages, the pages' metadata (title, URL, description, notes, tags) — and, if the user enabled content fetching and granted the site permission, the extracted page text (capped at 8,000 characters per page) — is sent to that endpoint or on-device model to generate the answer.
- Extracted page text is kept in an in-memory cache for the current AI page session only; it is never written to storage.
- AI chat history is stored locally (page titles, links and the conversation itself; page text content is not persisted) and can be deleted from the AI page at any time.
- The extension has no analytics, no telemetry, no accounts, and no background network activity.

## Certification testing notes

1. Load the unpacked extension folder in Microsoft Edge (or Chrome).
2. Open any `https://` page, click the extension icon, and click **Save current page**.
3. In the popup: paste a URL to add manually; add tags and a note; pin an item; use **Batch edit** to select multiple items and apply a tag, mark done, or delete; search and filter; copy Markdown; export JSON/Markdown.
4. Right-click a page or a link and use the Page Inbox context menu entry.
5. Open **More tools**: review the statistics, export CSV / HTML bookmarks / copy all as Markdown, and import a previously exported JSON file (deduplicated by URL).
6. AI analysis (optional path): open **More tools → AI assistant → Open AI analysis**. Select one or more pages on the left. If a permission banner appears, grant access for the listed sites. Configure the provider in **AI settings** — either keep "Auto" (uses the browser's built-in model where available, e.g. Chrome with the Prompt API enabled) or choose "Custom API" and enter an OpenAI-compatible endpoint URL, API key, and model name, then save. Send a question; the assistant reply renders as Markdown in the chat. Use **New chat** / the history picker / **Delete chat** to manage local conversations. Turning off "Fetch page content" restricts the AI to saved metadata only.
7. Confirm in the permission prompt that requested origins match only the sites being analyzed or the configured API endpoint.

## Store listing assets

- Name: Page Inbox (网页稍后处理)
- Short description: see `_locales/*/messages.json` → `extensionDescription`
- Suggested category: Productivity
- Suggested store screenshots: popup with saved items, More tools page (stats + import/export), AI analysis page with a rendered conversation.

## Version history

- 0.13.0 — Added Pure Reader Mode (`reader.html`) with distraction-free layout, 4 color themes, font scaling, drawer switching, and read time estimation; added native browser Side Panel (`sidepanel.html`) with Alt+B shortcut, in-place active tab navigation, and default icon action toggle; added anti-backlog Serendipity ("random pick" & aged gems review) across popup, side panel, and dashboard.
- 0.12.0 — Added Alt+S global keyboard shortcut for instant page saving; added dynamic toolbar action badge for pending inbox count and saved-page checkmark (`✓`) indicator; unified URL priority and added `tabs` permission for real-time badge state; added visual saved page highlighting in popup.
- 0.11.0 — Added local Mermaid diagram rendering (flowcharts, sequence diagrams) in AI replies, with Mermaid's strict security level for generated SVG and automatic fallback to a code block when diagram syntax is invalid; improved AI chat history management.
- 0.10.0 — AI chat history persistence (local, deletable), Markdown rendering for AI replies, tab-based content fallback, batch management, pinning, import, statistics, multi-format export.
- 0.3.0 — Initial listing draft: popup/context-menu save, tags and notes, search, export.
