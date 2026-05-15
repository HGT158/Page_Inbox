const ITEMS_KEY = "laterbox.items.v1";

const els = {
  countText: document.querySelector("#countText"),
  saveCurrentButton: document.querySelector("#saveCurrentButton"),
  manualUrlInput: document.querySelector("#manualUrlInput"),
  manualAddButton: document.querySelector("#manualAddButton"),
  searchInput: document.querySelector("#searchInput"),
  statusFilter: document.querySelector("#statusFilter"),
  tagFilters: document.querySelector("#tagFilters"),
  message: document.querySelector("#message"),
  list: document.querySelector("#list"),
  itemTemplate: document.querySelector("#itemTemplate"),
  exportJsonButton: document.querySelector("#exportJsonButton"),
  exportMarkdownButton: document.querySelector("#exportMarkdownButton"),
  clearDoneButton: document.querySelector("#clearDoneButton")
};

let items = [];
let activeTag = "";

init();

async function init() {
  localizeDocument();
  await loadItems();
  bindEvents();
  render();
}

function t(messageName, substitutions) {
  return chrome.i18n.getMessage(messageName, substitutions) || messageName;
}

function localizeDocument() {
  document.documentElement.lang = chrome.i18n.getUILanguage();
  document.title = t("extensionName");
  localizeElement(document);
}

function localizeElement(root) {
  root.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
    element.placeholder = t(element.dataset.i18nPlaceholder);
  });
  root.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
    element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel));
  });
}

function bindEvents() {
  els.saveCurrentButton.addEventListener("click", saveCurrentTab);
  els.manualAddButton.addEventListener("click", addManualUrl);
  els.manualUrlInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      addManualUrl();
    }
  });
  els.searchInput.addEventListener("input", render);
  els.statusFilter.addEventListener("change", render);
  els.exportJsonButton.addEventListener("click", exportJson);
  els.exportMarkdownButton.addEventListener("click", exportMarkdown);
  els.clearDoneButton.addEventListener("click", clearDoneItems);
}

async function loadItems() {
  const result = await chrome.storage.local.get({ [ITEMS_KEY]: [] });
  items = Array.isArray(result[ITEMS_KEY]) ? result[ITEMS_KEY].map(normalizeItem) : [];
}

async function persistItems() {
  await chrome.storage.local.set({ [ITEMS_KEY]: items });
}

async function saveCurrentTab() {
  els.saveCurrentButton.disabled = true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!isSupportedWebUrl(tab?.url)) {
      showMessage(t("messageUnsupportedPage"));
      return;
    }

    const meta = await readCurrentPageMeta(tab);
    await upsertItem({
      title: meta.title || tab.title || tab.url,
      url: meta.url || tab.url,
      description: meta.description || "",
      faviconUrl: "",
      source: "popup"
    });
    showMessage(t("messageSavedCurrent"));
  } finally {
    els.saveCurrentButton.disabled = false;
  }
}

async function readCurrentPageMeta(tab) {
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const meta = (name) => document.querySelector(`meta[name="${name}"], meta[property="${name}"]`)?.content?.trim() || "";

        return {
          title: document.title,
          url: location.href,
          description: meta("description") || meta("og:description") || meta("twitter:description")
        };
      }
    });

    return injection?.result || {};
  } catch {
    return {};
  }
}

async function addManualUrl() {
  const rawUrl = els.manualUrlInput.value.trim();
  if (!rawUrl) {
    return;
  }

  const url = normalizeUrl(rawUrl);
  if (!url) {
    showMessage(t("messageInvalidUrl"));
    return;
  }

  await upsertItem({
    title: url,
    url,
    description: "",
    faviconUrl: "",
    source: "manual"
  });
  els.manualUrlInput.value = "";
  showMessage(t("messageAddedLink"));
}

async function upsertItem(item) {
  const existingIndex = items.findIndex((saved) => saved.url === item.url);
  const now = new Date().toISOString();

  if (existingIndex >= 0) {
    items[existingIndex] = normalizeItem({
      ...items[existingIndex],
      title: item.title || items[existingIndex].title,
      description: item.description || items[existingIndex].description || "",
      faviconUrl: "",
      status: "inbox",
      updatedAt: now
    });
  } else {
    items.unshift(normalizeItem({
      id: crypto.randomUUID(),
      title: item.title || item.url,
      url: item.url,
      description: item.description || "",
      faviconUrl: "",
      tags: [],
      note: "",
      status: "inbox",
      source: item.source || "manual",
      createdAt: now,
      updatedAt: now
    }));
  }

  await persistItems();
  render();
}

function render() {
  items = items.map(normalizeItem);
  const filteredItems = getFilteredItems();
  const inboxCount = items.filter((item) => item.status !== "done").length;

  els.countText.textContent = t("inboxCount", String(inboxCount));
  renderTagFilters();
  els.list.replaceChildren();

  if (!filteredItems.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = items.length ? t("emptyNoMatches") : t("emptyNoItems");
    els.list.append(empty);
    return;
  }

  for (const item of filteredItems) {
    els.list.append(renderItem(item));
  }
}

function renderTagFilters() {
  const tags = getAllTags();
  els.tagFilters.replaceChildren();

  if (activeTag && !tags.includes(activeTag)) {
    activeTag = "";
  }

  if (!tags.length) {
    els.tagFilters.hidden = true;
    return;
  }

  els.tagFilters.hidden = false;
  els.tagFilters.append(createTagFilterButton(t("allTags"), "", !activeTag));

  for (const tag of tags) {
    els.tagFilters.append(createTagFilterButton(tag, tag, activeTag === tag));
  }
}

function createTagFilterButton(label, tag, selected) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "tag-filter";
  button.textContent = label;
  button.dataset.selected = String(selected);
  button.addEventListener("click", () => {
    activeTag = tag;
    render();
  });
  return button;
}

function renderItem(item) {
  const fragment = els.itemTemplate.content.cloneNode(true);
  localizeElement(fragment);
  const article = fragment.querySelector(".item");
  const favicon = fragment.querySelector(".item-favicon");
  const title = fragment.querySelector(".item-title");
  const url = fragment.querySelector(".item-url");
  const description = fragment.querySelector(".item-description");
  const tags = fragment.querySelector(".item-tags");
  const note = fragment.querySelector(".item-note");
  const statusButton = fragment.querySelector(".status-button");
  const markdownButton = fragment.querySelector(".markdown-button");
  const deleteButton = fragment.querySelector(".delete-button");

  article.dataset.id = item.id;
  title.textContent = item.title || item.url;
  title.href = item.url;
  url.textContent = item.url;
  favicon.removeAttribute("src");
  favicon.hidden = true;
  description.textContent = item.description || t("noDescription");
  description.dataset.empty = String(!item.description);
  tags.value = item.tags.join(", ");
  note.value = item.note || "";
  statusButton.dataset.status = item.status;
  statusButton.textContent = item.status === "done" ? t("moveBackButton") : t("markDoneButton");

  tags.addEventListener("change", () => updateItem(item.id, { tags: parseTags(tags.value) }));
  note.addEventListener("change", () => updateItem(item.id, { note: note.value.trim() }));
  statusButton.addEventListener("click", () => {
    const nextStatus = item.status === "done" ? "inbox" : "done";
    updateItem(item.id, { status: nextStatus });
  });
  markdownButton.addEventListener("click", async () => {
    await navigator.clipboard.writeText(toMarkdownLink(item));
    showMessage(t("messageMarkdownCopied"));
  });
  deleteButton.addEventListener("click", () => deleteItem(item.id));

  return fragment;
}

async function updateItem(id, patch) {
  items = items.map((item) => {
    if (item.id !== id) {
      return item;
    }

    return normalizeItem({
      ...item,
      ...patch,
      updatedAt: new Date().toISOString()
    });
  });
  await persistItems();
  render();
}

async function deleteItem(id) {
  items = items.filter((item) => item.id !== id);
  await persistItems();
  render();
}

function getFilteredItems() {
  const keyword = els.searchInput.value.trim().toLowerCase();
  const status = els.statusFilter.value;

  return items.filter((item) => {
    const statusMatched = status === "all" || item.status === status;
    const tagMatched = !activeTag || item.tags.includes(activeTag);
    const keywordMatched = !keyword || [
      item.title,
      item.description,
      item.url,
      item.note,
      item.tags.join(" ")
    ]
      .join(" ")
      .toLowerCase()
      .includes(keyword);

    return statusMatched && tagMatched && keywordMatched;
  });
}

async function clearDoneItems() {
  const doneCount = items.filter((item) => item.status === "done").length;
  if (!doneCount) {
    showMessage(t("messageNoDoneItems"));
    return;
  }

  items = items.filter((item) => item.status !== "done");
  await persistItems();
  render();
  showMessage(t("messageClearedDone", String(doneCount)));
}

function exportJson() {
  if (!items.length) {
    showMessage(t("messageNoExportItems"));
    return;
  }

  downloadText(JSON.stringify(items, null, 2), `laterbox-${today()}.json`, "application/json");
}

function exportMarkdown() {
  if (!items.length) {
    showMessage(t("messageNoExportItems"));
    return;
  }

  const lines = items.map((item) => {
    const tags = item.tags.map((tag) => `#${tag}`).join(" ");
    const note = item.note ? ` - ${item.note}` : "";
    return `- ${toMarkdownLink(item)}${tags ? ` ${tags}` : ""}${note}`;
  });

  downloadText(lines.join("\n"), `laterbox-${today()}.md`, "text/markdown");
}

function downloadText(text, filename, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function showMessage(text) {
  els.message.textContent = text;
  els.message.hidden = false;
  window.clearTimeout(showMessage.timer);
  showMessage.timer = window.setTimeout(() => {
    els.message.hidden = true;
  }, 2200);
}

function normalizeItem(item) {
  return {
    ...item,
    description: item.description || "",
    faviconUrl: "",
    tags: Array.isArray(item.tags) ? item.tags : [],
    note: item.note || "",
    status: item.status || "inbox"
  };
}

function parseTags(value) {
  return Array.from(new Set(value
    .split(/[,，\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean)));
}

function getAllTags() {
  return Array.from(new Set(items.flatMap((item) => item.tags))).sort((a, b) => a.localeCompare(b));
}

function toMarkdownLink(item) {
  return `[${escapeMarkdown(item.title || item.url)}](${item.url})`;
}

function escapeMarkdown(text) {
  return text.replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function normalizeUrl(rawUrl) {
  try {
    const hasProtocol = /^[a-z][a-z0-9+.-]*:/i.test(rawUrl);
    const url = new URL(hasProtocol ? rawUrl : `https://${rawUrl}`);
    if (!isSupportedWebUrl(url.href)) {
      return "";
    }
    return url.href;
  } catch {
    return "";
  }
}

function isSupportedWebUrl(url) {
  try {
    return ["http:", "https:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
