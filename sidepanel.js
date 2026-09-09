// sidepanel.js - 侧边栏模式交互逻辑
// 长驻侧边栏，支持与主浏览器窗口活动标签页的实时双向联动

const SIDE_PANEL_PREF_KEY = "laterbox.openInSidePanel";

const els = {
  countText: document.querySelector("#countText"),
  saveCurrentButton: document.querySelector("#saveCurrentButton"),
  toggleDefaultSidePanelButton: document.querySelector("#toggleDefaultSidePanelButton"),
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
  clearDoneButton: document.querySelector("#clearDoneButton"),
  batchToggleButton: document.querySelector("#batchToggleButton"),
  batchBar: document.querySelector("#batchBar"),
  selectAllButton: document.querySelector("#selectAllButton"),
  selectionCount: document.querySelector("#selectionCount"),
  exitBatchButton: document.querySelector("#exitBatchButton"),
  batchTagButton: document.querySelector("#batchTagButton"),
  batchDoneButton: document.querySelector("#batchDoneButton"),
  batchDeleteButton: document.querySelector("#batchDeleteButton"),
  batchTagRow: document.querySelector("#batchTagRow"),
  batchTagInput: document.querySelector("#batchTagInput"),
  batchTagApplyButton: document.querySelector("#batchTagApplyButton"),
  dashboardButton: document.querySelector("#dashboardButton")
};

let items = [];
let activeTag = "";
let selectionMode = false;
const selectedIds = new Set();
let currentTabUrl = "";
let isDefaultSidePanel = false;

init();

async function init() {
  localizeDocument();
  document.title = `${t("extensionName")} · ${t("openSidePanelButton")}`;
  await loadCurrentTabUrl();
  await loadDefaultMode();
  await loadItems();
  bindEvents();
  bindTabListeners();
  render();
}

async function loadCurrentTabUrl() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTabUrl = tab?.url || "";
  } catch {
    currentTabUrl = "";
  }
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
  els.batchToggleButton.addEventListener("click", enterSelectionMode);
  els.exitBatchButton.addEventListener("click", exitSelectionMode);
  els.selectAllButton.addEventListener("click", toggleSelectAll);
  els.batchTagButton.addEventListener("click", toggleBatchTagRow);
  els.batchTagApplyButton.addEventListener("click", applyBatchTags);
  els.batchTagInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      applyBatchTags();
    }
  });
  els.batchDoneButton.addEventListener("click", batchMarkDone);
  els.batchDeleteButton.addEventListener("click", batchDelete);
  els.dashboardButton.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
  });
  if (els.toggleDefaultSidePanelButton) {
    els.toggleDefaultSidePanelButton.addEventListener("click", toggleDefaultMode);
  }
}

async function loadDefaultMode() {
  try {
    const result = await chrome.storage.local.get({ [SIDE_PANEL_PREF_KEY]: false });
    isDefaultSidePanel = Boolean(result[SIDE_PANEL_PREF_KEY]);
    updateDefaultModeUI();
  } catch {
    isDefaultSidePanel = false;
  }
}

function updateDefaultModeUI() {
  if (!els.toggleDefaultSidePanelButton) {
    return;
  }
  els.toggleDefaultSidePanelButton.dataset.active = String(isDefaultSidePanel);
  if (isDefaultSidePanel) {
    els.toggleDefaultSidePanelButton.textContent = `◨ ${t("switchToPopupButton")}`;
    els.toggleDefaultSidePanelButton.title = t("switchToPopupButton");
  } else {
    els.toggleDefaultSidePanelButton.textContent = `◨ ${t("toggleDefaultSidePanel")}`;
    els.toggleDefaultSidePanelButton.title = t("toggleDefaultSidePanel");
  }
}

async function toggleDefaultMode() {
  isDefaultSidePanel = !isDefaultSidePanel;
  updateDefaultModeUI();
  await chrome.storage.local.set({ [SIDE_PANEL_PREF_KEY]: isDefaultSidePanel });
  showMessage(isDefaultSidePanel ? t("toggleDefaultSidePanel") : t("switchToPopupButton"));
}

function bindTabListeners() {
  // 侧边栏长驻时，主窗口切换标签页自动感知
  chrome.tabs.onActivated.addListener(async () => {
    await loadCurrentTabUrl();
    render();
  });

  // 主窗口标签页加载完成或地址变更时自动感知
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    if (changeInfo.status === "complete" || changeInfo.url) {
      await loadCurrentTabUrl();
      render();
    }
  });

  // 监听来自其他页面（如后台快捷键、Popup、Dashboard 等）的数据存储变动
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local") {
      if (changes[ITEMS_KEY]) {
        items = Array.isArray(changes[ITEMS_KEY].newValue) ? changes[ITEMS_KEY].newValue.map(normalizeItem) : [];
        render();
      }
      if (changes[SIDE_PANEL_PREF_KEY]) {
        isDefaultSidePanel = Boolean(changes[SIDE_PANEL_PREF_KEY].newValue);
        updateDefaultModeUI();
      }
    }
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

async function saveCurrentTab() {
  els.saveCurrentButton.disabled = true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!isSupportedWebUrl(tab?.url)) {
      showMessage(t("messageUnsupportedPage"));
      return;
    }

    const meta = await readPageMeta(tab.id);
    const targetUrl = meta.url || tab.url;
    currentTabUrl = targetUrl;
    await upsertItem({
      title: meta.title || tab.title || targetUrl,
      url: targetUrl,
      description: meta.description || "",
      source: "sidepanel"
    });
    showMessage(t("messageSavedCurrent"));
  } finally {
    els.saveCurrentButton.disabled = false;
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
      status: "inbox",
      updatedAt: now
    });
  } else {
    items.unshift(normalizeItem({
      id: crypto.randomUUID(),
      title: item.title || item.url,
      url: item.url,
      description: item.description || "",
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
  els.list.classList.toggle("selecting", selectionMode);
  updateBatchBar();
  const stripHash = (u) => (u ? u.split("#")[0] : u);
  const isCurrentSaved = Boolean(currentTabUrl && items.some((item) => stripHash(item.url) === stripHash(currentTabUrl)));
  if (isCurrentSaved) {
    els.saveCurrentButton.textContent = t("saveCurrentButtonSaved");
    els.saveCurrentButton.classList.add("is-saved");
  } else {
    els.saveCurrentButton.textContent = t("saveCurrentButton");
    els.saveCurrentButton.classList.remove("is-saved");
  }

  const filteredItems = getFilteredItems()
    .sort((a, b) => Number(b.pinned) - Number(a.pinned));
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
  const checkbox = fragment.querySelector(".item-select");
  const title = fragment.querySelector(".item-title");
  const url = fragment.querySelector(".item-url");
  const description = fragment.querySelector(".item-description");
  const tags = fragment.querySelector(".item-tags");
  const note = fragment.querySelector(".item-note");
  const openTabButton = fragment.querySelector(".open-tab-btn");
  const readerButton = fragment.querySelector(".reader-button");
  const statusButton = fragment.querySelector(".status-button");
  const markdownButton = fragment.querySelector(".markdown-button");
  const deleteButton = fragment.querySelector(".delete-button");
  const pinButton = fragment.querySelector(".pin-button");

  article.dataset.id = item.id;
  article.dataset.pinned = String(Boolean(item.pinned));
  const stripHash = (u) => (u ? u.split("#")[0] : u);
  if (currentTabUrl && stripHash(item.url) === stripHash(currentTabUrl)) {
    article.classList.add("current-page");
  }
  title.textContent = item.title || item.url;
  title.href = item.url;
  url.textContent = item.url;
  description.textContent = item.description || t("noDescription");
  description.dataset.empty = String(!item.description);
  tags.value = item.tags.join(", ");
  note.value = item.note || "";
  statusButton.dataset.status = item.status;
  statusButton.textContent = item.status === "done" ? t("moveBackButton") : t("markDoneButton");
  pinButton.textContent = item.pinned ? t("unpinButton") : t("pinButton");
  pinButton.dataset.pinned = String(Boolean(item.pinned));
  checkbox.checked = selectedIds.has(item.id);
  checkbox.setAttribute("aria-label", t("selectItemLabel"));

  if (openTabButton) {
    openTabButton.addEventListener("click", (e) => {
      e.stopPropagation();
      chrome.tabs.create({ url: item.url });
    });
  }

  readerButton.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL(`reader.html?id=${item.id}`) });
  });
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
  deleteButton.addEventListener("click", () => {
    if (confirm(t("confirmDelete"))) {
      deleteItem(item.id);
    }
  });
  pinButton.addEventListener("click", () => updateItem(item.id, { pinned: !item.pinned }));
  checkbox.addEventListener("change", () => setSelected(item.id, checkbox.checked));

  // 左键点击标题：直接在当前活动的主标签页中加载该网页，实现一边看列表一边逐一查阅
  title.addEventListener("click", async (event) => {
    if (selectionMode) {
      event.preventDefault();
      setSelected(item.id, !selectedIds.has(item.id));
      return;
    }
    // 如果按住了 Ctrl / Meta / Shift，保留新标签页打开行为
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }
    event.preventDefault();
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await chrome.tabs.update(tab.id, { url: item.url });
        currentTabUrl = item.url;
        render();
      } else {
        chrome.tabs.create({ url: item.url });
      }
    } catch {
      chrome.tabs.create({ url: item.url });
    }
  });

  return fragment;
}

function getFilteredItems() {
  const query = els.searchInput.value.trim().toLowerCase();
  const status = els.statusFilter.value;

  return items.filter((item) => {
    const matchStatus = status === "all" ? true : item.status === status;
    const matchTag = !activeTag || item.tags.includes(activeTag);
    const matchQuery = !query || [
      item.title,
      item.description,
      item.url,
      item.note,
      item.tags.join(" ")
    ].join(" ").toLowerCase().includes(query);

    return matchStatus && matchTag && matchQuery;
  });
}

function getAllTags() {
  const set = new Set();
  for (const item of items) {
    for (const tag of item.tags) {
      set.add(tag);
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

async function updateItem(id, patch) {
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) {
    return;
  }

  items[index] = normalizeItem({
    ...items[index],
    ...patch,
    updatedAt: new Date().toISOString()
  });

  await persistItems();
  render();
}

async function deleteItem(id) {
  selectedIds.delete(id);
  items = items.filter((item) => item.id !== id);
  await persistItems();
  render();
  showMessage(t("messageDeletedLink"));
}

function normalizeUrl(value) {
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : "";
  } catch {
    try {
      const parsed = new URL(`https://${value}`);
      return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : "";
    } catch {
      return "";
    }
  }
}

function setSelected(id, checked) {
  if (checked) {
    selectedIds.add(id);
  } else {
    selectedIds.delete(id);
  }
  render();
}

function enterSelectionMode() {
  selectionMode = true;
  els.batchTagRow.hidden = true;
  render();
}

function exitSelectionMode() {
  selectionMode = false;
  selectedIds.clear();
  els.batchTagRow.hidden = true;
  render();
}

function toggleSelectAll() {
  const visible = getFilteredItems();
  const visibleIds = visible.map((item) => item.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));

  if (allVisibleSelected) {
    for (const id of visibleIds) {
      selectedIds.delete(id);
    }
  } else {
    for (const id of visibleIds) {
      selectedIds.add(id);
    }
  }
  render();
}

function updateBatchBar() {
  if (!selectionMode) {
    els.batchBar.hidden = true;
    return;
  }

  els.batchBar.hidden = false;
  const count = selectedIds.size;
  els.selectionCount.textContent = t("selectedCount", String(count));

  const visible = getFilteredItems();
  const visibleIds = visible.map((item) => item.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  els.selectAllButton.textContent = allVisibleSelected ? t("unselectAllButton") : t("selectAllButton");

  const hasSelection = count > 0;
  els.batchTagButton.disabled = !hasSelection;
  els.batchDoneButton.disabled = !hasSelection;
  els.batchDeleteButton.disabled = !hasSelection;
}

function toggleBatchTagRow() {
  els.batchTagRow.hidden = !els.batchTagRow.hidden;
  if (!els.batchTagRow.hidden) {
    els.batchTagInput.focus();
  }
}

async function applyBatchTags() {
  const rawTags = els.batchTagInput.value.trim();
  if (!rawTags || !selectedIds.size) {
    return;
  }

  const newTags = parseTags(rawTags);
  if (!newTags.length) {
    return;
  }

  const now = new Date().toISOString();
  for (const item of items) {
    if (selectedIds.has(item.id)) {
      const merged = Array.from(new Set([...item.tags, ...newTags]));
      item.tags = merged;
      item.updatedAt = now;
    }
  }

  await persistItems();
  els.batchTagInput.value = "";
  els.batchTagRow.hidden = true;
  render();
  showMessage(t("messageBatchTagged", String(selectedIds.size)));
}

async function batchMarkDone() {
  if (!selectedIds.size) {
    return;
  }

  const now = new Date().toISOString();
  let count = 0;
  for (const item of items) {
    if (selectedIds.has(item.id)) {
      item.status = "done";
      item.updatedAt = now;
      count += 1;
    }
  }

  await persistItems();
  exitSelectionMode();
  showMessage(t("messageBatchDone", String(count)));
}

async function batchDelete() {
  if (!selectedIds.size) {
    return;
  }

  const count = selectedIds.size;
  if (!confirm(t("confirmBatchDelete", String(count)))) {
    return;
  }

  items = items.filter((item) => !selectedIds.has(item.id));
  await persistItems();
  exitSelectionMode();
  showMessage(t("messageBatchDeleted", String(count)));
}

async function clearDoneItems() {
  const doneCount = items.filter((item) => item.status === "done").length;
  if (!doneCount) {
    showMessage(t("messageNoDoneItems"));
    return;
  }

  if (!confirm(t("confirmClearDone", String(doneCount)))) {
    return;
  }

  items = items.filter((item) => item.status !== "done");
  await persistItems();
  render();
  showMessage(t("messageClearedDone"));
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

  downloadText(buildMarkdownLines(items).join("\n"), `laterbox-${today()}.md`, "text/markdown");
}

function showMessage(text) {
  els.message.textContent = text;
  els.message.hidden = false;
  window.clearTimeout(showMessage.timer);
  showMessage.timer = window.setTimeout(() => {
    els.message.hidden = true;
  }, 2600);
}
