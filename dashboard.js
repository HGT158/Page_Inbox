const els = {
  usageText: document.querySelector("#usageText"),
  statTotal: document.querySelector("#statTotal"),
  statInbox: document.querySelector("#statInbox"),
  statDone: document.querySelector("#statDone"),
  statPinned: document.querySelector("#statPinned"),
  statLast7: document.querySelector("#statLast7"),
  topTags: document.querySelector("#topTags"),
  topSites: document.querySelector("#topSites"),
  importFile: document.querySelector("#importFile"),
  importButton: document.querySelector("#importButton"),
  copyAllMarkdownButton: document.querySelector("#copyAllMarkdownButton"),
  exportCsvButton: document.querySelector("#exportCsvButton"),
  exportBookmarksButton: document.querySelector("#exportBookmarksButton"),
  openAiButton: document.querySelector("#openAiButton"),
  message: document.querySelector("#dashMessage")
};

let items = [];

init();

async function init() {
  localizeDocument();
  document.title = `${t("extensionName")} · ${t("dashboardTitle")}`;
  await loadItems();
  bindEvents();
  renderAll();
}

function bindEvents() {
  els.importButton.addEventListener("click", () => els.importFile.click());
  els.importFile.addEventListener("change", handleImportFile);
  els.copyAllMarkdownButton.addEventListener("click", handleCopyAllMarkdown);
  els.exportCsvButton.addEventListener("click", exportCsv);
  els.exportBookmarksButton.addEventListener("click", exportBookmarks);
  els.openAiButton.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("ai.html") });
  });
}

async function loadItems() {
  const result = await chrome.storage.local.get({ [ITEMS_KEY]: [] });
  items = Array.isArray(result[ITEMS_KEY]) ? result[ITEMS_KEY].map(normalizeItem) : [];
}

async function persistItems() {
  try {
    await chrome.storage.local.set({ [ITEMS_KEY]: items });
  } catch {
    showMessage(t("messageStorageError"));
  }
}

function renderAll() {
  renderStats();
  renderUsage();
}

function renderStats() {
  const stats = buildStats(items);
  els.statTotal.textContent = String(stats.total);
  els.statInbox.textContent = String(stats.inbox);
  els.statDone.textContent = String(stats.done);
  els.statPinned.textContent = String(stats.pinned);
  els.statLast7.textContent = String(stats.last7Days);
  renderTopList(els.topTags, stats.topTags);
  renderTopList(els.topSites, stats.topSites);
}

function renderTopList(listEl, entries) {
  listEl.replaceChildren();

  if (!entries.length) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = t("emptyStats");
    listEl.append(li);
    return;
  }

  for (const [label, count] of entries) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = label;
    const num = document.createElement("span");
    num.className = "count";
    num.textContent = String(count);
    li.append(name, num);
    listEl.append(li);
  }
}

function renderUsage() {
  const bytes = new Blob([JSON.stringify(items)]).size;
  const kb = bytes < 1024 ? "<1" : String(Math.round(bytes / 1024));
  els.usageText.textContent = t("storageUsage", [String(items.length), kb]);
}

async function handleImportFile(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) {
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    showMessage(t("importInvalid"));
    return;
  }
  if (!Array.isArray(parsed)) {
    showMessage(t("importInvalid"));
    return;
  }

  const { items: merged, added, skipped } = mergeImportedItems(items, parsed);
  items = merged;
  await persistItems();
  renderAll();
  showMessage(t("importResult", [String(added), String(skipped)]));
}

async function handleCopyAllMarkdown() {
  if (!items.length) {
    showMessage(t("messageNoExportItems"));
    return;
  }

  try {
    await navigator.clipboard.writeText(buildMarkdownLines(items).join("\n"));
    showMessage(t("messageAllMarkdownCopied"));
  } catch {
    showMessage(t("messageClipboardError"));
  }
}

function exportCsv() {
  if (!items.length) {
    showMessage(t("messageNoExportItems"));
    return;
  }

  downloadText(buildCsv(items), `laterbox-${today()}.csv`, "text/csv");
}

function exportBookmarks() {
  if (!items.length) {
    showMessage(t("messageNoExportItems"));
    return;
  }

  downloadText(buildBookmarksHtml(items), `laterbox-${today()}.html`, "text/html");
}

function buildStats(list) {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const tagCounts = new Map();
  const siteCounts = new Map();

  for (const item of list) {
    for (const tag of item.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
    let host = "";
    try {
      host = new URL(item.url).hostname;
    } catch {
      host = "";
    }
    if (host) {
      siteCounts.set(host, (siteCounts.get(host) || 0) + 1);
    }
  }

  const top = (map) => Array.from(map.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5);

  return {
    total: list.length,
    inbox: list.filter((item) => item.status !== "done").length,
    done: list.filter((item) => item.status === "done").length,
    pinned: list.filter((item) => item.pinned).length,
    last7Days: list.filter((item) => new Date(item.createdAt || 0).getTime() >= weekAgo).length,
    topTags: top(tagCounts),
    topSites: top(siteCounts)
  };
}

function mergeImportedItems(existing, imported) {
  const knownUrls = new Set(existing.map((item) => item.url));
  const merged = [...existing];
  let added = 0;
  let skipped = 0;
  const now = new Date().toISOString();

  for (const raw of imported) {
    if (!raw || typeof raw.url !== "string" || !isSupportedWebUrl(raw.url) || knownUrls.has(raw.url)) {
      skipped += 1;
      continue;
    }
    knownUrls.add(raw.url);
    merged.push(normalizeItem({
      id: crypto.randomUUID(),
      title: raw.title || raw.url,
      url: raw.url,
      description: raw.description,
      tags: raw.tags,
      note: raw.note,
      status: raw.status,
      pinned: raw.pinned,
      source: "import",
      createdAt: raw.createdAt || now,
      updatedAt: now
    }));
    added += 1;
  }

  return { items: merged, added, skipped };
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}

function buildCsv(list) {
  const header = ["title", "url", "tags", "note", "status", "createdAt"];
  const rows = list.map((item) => [
    item.title || item.url,
    item.url,
    item.tags.join(" "),
    item.note,
    item.status,
    item.createdAt || ""
  ].map(csvCell).join(","));

  return `\uFEFF${[header.join(","), ...rows].join("\r\n")}`;
}

function buildBookmarksHtml(list) {
  const escapeHtml = (text) => String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");

  const lines = list.map((item) => {
    const epoch = Math.floor(new Date(item.createdAt || Date.now()).getTime() / 1000);
    return `    <DT><A HREF="${escapeHtml(item.url)}" ADD_DATE="${epoch}">${escapeHtml(item.title || item.url)}</A>`;
  });

  return [
    "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
    "<!-- This is an automatically generated file. -->",
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    `<TITLE>${escapeHtml(t("extensionName"))}</TITLE>`,
    "<DL><p>",
    ...lines,
    "</DL><p>"
  ].join("\n");
}

function showMessage(text) {
  els.message.textContent = text;
  els.message.hidden = false;
  window.clearTimeout(showMessage.timer);
  showMessage.timer = window.setTimeout(() => {
    els.message.hidden = true;
  }, 2600);
}
