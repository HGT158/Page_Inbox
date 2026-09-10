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
  dashboardButton: document.querySelector("#dashboardButton"),
  randomPickButton: document.querySelector("#randomPickButton"),
  serendipityCard: document.querySelector("#serendipityCard"),
  serendipityAge: document.querySelector("#serendipityAge"),
  serendipityCloseButton: document.querySelector("#serendipityCloseButton"),
  serendipityTitle: document.querySelector("#serendipityTitle"),
  serendipityMeta: document.querySelector("#serendipityMeta"),
  serendipityReadButton: document.querySelector("#serendipityReadButton"),
  serendipityOpenButton: document.querySelector("#serendipityOpenButton"),
  serendipityArchiveButton: document.querySelector("#serendipityArchiveButton"),
  serendipityNextButton: document.querySelector("#serendipityNextButton")
};

let items = [];
let features = { ...DEFAULT_FEATURES };
let activeTag = "";
let selectionMode = false;
const selectedIds = new Set();
const expandedTldrIds = new Set();
let currentTabUrl = "";
let isDefaultSidePanel = false;
let currentPickedItem = null;

init();

async function init() {
  localizeDocument();
  document.title = `${t("extensionName")} · ${t("openSidePanelButton")}`;
  await loadCurrentTabUrl();
  await loadDefaultMode();
  await loadItems();
  features = await loadFeatures();
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
  if (els.randomPickButton) {
    els.randomPickButton.addEventListener("click", pickRandomSerendipityItem);
  }
  if (els.serendipityCloseButton) {
    els.serendipityCloseButton.addEventListener("click", closeSerendipity);
  }
  if (els.serendipityNextButton) {
    els.serendipityNextButton.addEventListener("click", pickRandomSerendipityItem);
  }
  if (els.serendipityReadButton) {
    els.serendipityReadButton.addEventListener("click", () => {
      if (currentPickedItem) {
        chrome.tabs.create({ url: chrome.runtime.getURL(`reader.html?id=${currentPickedItem.id}`) });
      }
    });
  }
  if (els.serendipityOpenButton) {
    els.serendipityOpenButton.addEventListener("click", openPickedInActiveTab);
  }
  if (els.serendipityTitle) {
    els.serendipityTitle.addEventListener("click", (e) => {
      e.preventDefault();
      openPickedInActiveTab();
    });
  }
  if (els.serendipityArchiveButton) {
    els.serendipityArchiveButton.addEventListener("click", async () => {
      if (currentPickedItem) {
        const targetId = currentPickedItem.id;
        await updateItem(targetId, { status: "done" });
        showMessage(t("messageMarkDoneSuccess") || "已归档");
        const nextPending = items.filter((item) => item.status === "inbox" && item.id !== targetId);
        if (nextPending.length > 0) {
          pickRandomSerendipityItem();
        } else {
          closeSerendipity();
        }
      }
    });
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
      if (changes[FEATURES_KEY]) {
        features = { ...DEFAULT_FEATURES, ...(changes[FEATURES_KEY].newValue || {}) };
        render();
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
  const tagSuggestions = fragment.querySelector(".tag-suggestions");
  const note = fragment.querySelector(".item-note");
  const tldrButton = fragment.querySelector(".tldr-button");
  const openTabButton = fragment.querySelector(".open-tab-btn");
  const readerButton = fragment.querySelector(".reader-button");
  const statusButton = fragment.querySelector(".status-button");
  const markdownButton = fragment.querySelector(".markdown-button");
  const deleteButton = fragment.querySelector(".delete-button");
  const pinButton = fragment.querySelector(".pin-button");
  const tldrContainer = fragment.querySelector(".item-tldr");
  const tldrBody = fragment.querySelector(".tldr-body");
  const tldrCopyBtn = fragment.querySelector(".tldr-copy-btn");
  const tldrRegenBtn = fragment.querySelector(".tldr-regen-btn");
  const tldrCloseBtn = fragment.querySelector(".tldr-close-btn");

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

  // 1. 智能自动标签建议渲染与交互（需在「更多功能」中开启）
  if (tagSuggestions) {
    const suggestions = features.autoTags ? suggestTags(item, 3) : [];
    if (suggestions.length > 0) {
      tagSuggestions.hidden = false;
      tagSuggestions.replaceChildren();
      const label = document.createElement("span");
      label.className = "tag-sugg-label";
      label.textContent = t("tagSuggestionsLabel");
      tagSuggestions.append(label);

      for (const tag of suggestions) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "tag-sugg-chip";
        chip.textContent = `+ ${tag}`;
        chip.title = `点击采纳标签 #${tag}`;
        chip.addEventListener("click", async () => {
          const nextTags = Array.from(new Set([...item.tags, tag]));
          await updateItem(item.id, { tags: nextTags });
          showMessage(t("tagSuggestionAdopted", tag));
        });
        tagSuggestions.append(chip);
      }
    } else {
      tagSuggestions.hidden = true;
    }
  }

  // 2. 3 句话速读 (TL;DR) 交互与流式生成（需在「更多功能」中开启）
  let abortController = null;
  const tldrEnabled = Boolean(features.quickTldr);
  const isExpanded = tldrEnabled && expandedTldrIds.has(item.id);
  tldrButton.hidden = !tldrEnabled;
  if (tldrContainer) {
    tldrContainer.hidden = !isExpanded;
    if (isExpanded) {
      tldrButton.classList.add("is-active");
      if (item.tldr) {
        tldrBody.className = "tldr-body";
        tldrBody.textContent = item.tldr;
      }
    }
  }

  async function triggerTldr(forceRefresh = false) {
    if (!tldrEnabled) {
      return;
    }
    if (!forceRefresh && item.tldr) {
      tldrContainer.hidden = false;
      tldrButton.classList.add("is-active");
      expandedTldrIds.add(item.id);
      tldrBody.className = "tldr-body";
      tldrBody.textContent = item.tldr;
      return;
    }

    tldrContainer.hidden = false;
    tldrButton.classList.add("is-active");
    expandedTldrIds.add(item.id);
    tldrBody.className = "tldr-body is-loading";
    tldrBody.textContent = t("tldrLoading");

    if (abortController) {
      abortController.abort();
    }
    const controller = new AbortController();
    abortController = controller;

    try {
      let content = "";
      if (currentTabUrl && stripHash(item.url) === stripHash(currentTabUrl)) {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab?.id) {
            const [injection] = await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: () => document.body?.innerText?.slice(0, 3500) || ""
            });
            content = injection?.result || "";
          }
        } catch {
          content = "";
        }
      }
      if (!content && typeof loadPageText === "function") {
        try {
          content = await loadPageText(item.url, 3500);
        } catch {
          content = "";
        }
      }

      let accumulated = "";
      let isFirst = true;
      await generateTldrStream(
        { title: item.title, url: item.url, description: item.description, content },
        (delta) => {
          if (isFirst) {
            isFirst = false;
            tldrBody.className = "tldr-body";
            tldrBody.textContent = "";
          }
          accumulated += delta;
          if (tldrBody.isConnected) {
            tldrBody.textContent = accumulated;
          }
        },
        controller.signal
      );

      if (controller.signal.aborted) {
        return;
      }

      const finalSummary = accumulated.trim();
      if (finalSummary) {
        item.tldr = finalSummary;
        const existingIndex = items.findIndex((saved) => saved.id === item.id);
        if (existingIndex >= 0) {
          items[existingIndex].tldr = finalSummary;
          await persistItems();
        }
      }
    } catch (err) {
      if (controller.signal.aborted) {
        return;
      }
      tldrBody.className = "tldr-body";
      tldrBody.replaceChildren();
      if (err && err.code === "AI_NOT_CONFIGURED") {
        const hint = document.createElement("span");
        hint.textContent = `${t("tldrNotConfigured")} `;
        const link = document.createElement("a");
        link.className = "tldr-link";
        link.textContent = t("tldrOpenSettings");
        link.href = "#";
        link.addEventListener("click", (e) => {
          e.preventDefault();
          chrome.tabs.create({ url: chrome.runtime.getURL("ai.html") });
        });
        tldrBody.append(hint, link);
      } else {
        tldrBody.textContent = t("aiErrorGeneric", err?.message || String(err));
      }
    } finally {
      if (abortController === controller) {
        abortController = null;
      }
    }
  }

  tldrButton.addEventListener("click", () => {
    if (!tldrEnabled) {
      return;
    }
    if (!tldrContainer.hidden) {
      tldrContainer.hidden = true;
      tldrButton.classList.remove("is-active");
      expandedTldrIds.delete(item.id);
      if (abortController) {
        abortController.abort();
      }
    } else {
      triggerTldr(false);
    }
  });

  tldrCopyBtn?.addEventListener("click", async () => {
    const text = tldrBody.textContent.trim();
    if (text) {
      await navigator.clipboard.writeText(text);
      showMessage(t("tldrCopied"));
    }
  });

  tldrRegenBtn?.addEventListener("click", () => {
    triggerTldr(true);
  });

  tldrCloseBtn?.addEventListener("click", () => {
    tldrContainer.hidden = true;
    tldrButton.classList.remove("is-active");
    expandedTldrIds.delete(item.id);
    if (abortController) {
      abortController.abort();
    }
  });

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
  els.selectionCount.textContent = t("selectionCount", String(count));

  const visible = getFilteredItems();
  const visibleIds = visible.map((item) => item.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  els.selectAllButton.textContent = allVisibleSelected ? t("deselectAllButton") : t("selectAllButton");

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

async function openPickedInActiveTab() {
  if (!currentPickedItem) {
    return;
  }
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await chrome.tabs.update(tab.id, { url: currentPickedItem.url });
      currentTabUrl = currentPickedItem.url;
      render();
    } else {
      chrome.tabs.create({ url: currentPickedItem.url });
    }
  } catch {
    chrome.tabs.create({ url: currentPickedItem.url });
  }
}

function pickRandomSerendipityItem() {
  const pendingItems = items.filter((item) => item.status === "inbox");
  if (pendingItems.length === 0) {
    showMessage(t("serendipityEmpty"));
    closeSerendipity();
    return;
  }

  // 避免连续抽中同一条（若大于1条）
  const candidates = pendingItems.length > 1 && currentPickedItem
    ? pendingItems.filter((item) => item.id !== currentPickedItem.id)
    : pendingItems;

  // 防积压核心策略：按创建时间由旧到新排序，沉睡越久的旧藏赋予更高权重
  candidates.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  // 优先从最久远的 60% 条目池中抽选
  const poolSize = Math.max(1, Math.ceil(candidates.length * 0.6));
  const randomIndex = Math.floor(Math.random() * poolSize);
  const picked = candidates[randomIndex] || candidates[0];

  showSerendipityCard(picked);
}

function showSerendipityCard(item) {
  if (!item || !els.serendipityCard) {
    return;
  }
  currentPickedItem = item;

  const daysAgo = getDaysAgo(item.createdAt);
  els.serendipityAge.textContent = daysAgo > 0 ? t("serendipityDaysAgo", [String(daysAgo)]) : t("serendipityToday");
  els.serendipityTitle.textContent = item.title || item.url;
  els.serendipityTitle.href = item.url;

  const tagsStr = item.tags.length > 0 ? item.tags.map((tg) => `#${tg}`).join(" ") : "";
  let host = "";
  try {
    host = new URL(item.url).hostname;
  } catch {
    host = "";
  }
  els.serendipityMeta.textContent = [host, tagsStr, item.note].filter(Boolean).join(" · ");

  els.serendipityCard.hidden = false;
  highlightItemInList(item.id);
}

function closeSerendipity() {
  if (els.serendipityCard) {
    els.serendipityCard.hidden = true;
  }
  currentPickedItem = null;
}

function highlightItemInList(itemId) {
  if (!els.list) {
    return;
  }
  const domItem = els.list.querySelector(`[data-id="${itemId}"]`);
  if (domItem) {
    domItem.scrollIntoView({ behavior: "smooth", block: "nearest" });
    domItem.classList.remove("highlight-pulse");
    void domItem.offsetWidth;
    domItem.classList.add("highlight-pulse");
    setTimeout(() => {
      domItem.classList.remove("highlight-pulse");
    }, 3200);
  }
}

