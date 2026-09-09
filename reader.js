// reader.js - 极简纯净阅读模式交互逻辑

const READER_SETTINGS_KEY = "laterbox.reader.settings.v1";
const DEFAULT_READER_SETTINGS = {
  fontSize: 18,
  theme: "light",
  font: "sans",
  width: "normal"
};

const els = {
  backButton: document.querySelector("#backButton"),
  drawerToggle: document.querySelector("#drawerToggle"),
  drawer: document.querySelector("#drawer"),
  drawerCloseBtn: document.querySelector("#drawerCloseBtn"),
  drawerSearchInput: document.querySelector("#drawerSearchInput"),
  drawerList: document.querySelector("#drawerList"),
  sourceSiteLink: document.querySelector("#sourceSiteLink"),
  sourceSiteText: document.querySelector("#sourceSiteText"),
  fontFamilySelect: document.querySelector("#fontFamilySelect"),
  fontDecBtn: document.querySelector("#fontDecBtn"),
  fontSizeDisplay: document.querySelector("#fontSizeDisplay"),
  fontIncBtn: document.querySelector("#fontIncBtn"),
  contentWidthSelect: document.querySelector("#contentWidthSelect"),
  themeBtns: document.querySelectorAll(".theme-btn"),
  toggleStatusBtn: document.querySelector("#toggleStatusBtn"),
  copyTextBtn: document.querySelector("#copyTextBtn"),
  openOriginalLink: document.querySelector("#openOriginalLink"),
  articleContainer: document.querySelector("#articleContainer"),
  articleTitle: document.querySelector("#articleTitle"),
  articleDomain: document.querySelector("#articleDomain"),
  articleDate: document.querySelector("#articleDate"),
  articleStats: document.querySelector("#articleStats"),
  articleTags: document.querySelector("#articleTags"),
  loadingIndicator: document.querySelector("#loadingIndicator"),
  permissionCard: document.querySelector("#permissionCard"),
  grantPermBtn: document.querySelector("#grantPermBtn"),
  permOriginalLink: document.querySelector("#permOriginalLink"),
  errorCard: document.querySelector("#errorCard"),
  retryBtn: document.querySelector("#retryBtn"),
  errOriginalLink: document.querySelector("#errOriginalLink"),
  articleBody: document.querySelector("#articleBody"),
  readerToast: document.querySelector("#readerToast")
};

let items = [];
let currentItem = null;
let currentExtractedText = "";
let readerSettings = { ...DEFAULT_READER_SETTINGS };
const contentCache = new Map();

init();

async function init() {
  localizeDocument();
  await loadReaderSettings();
  applyReaderSettings();
  await loadItems();
  bindEvents();

  const urlParams = new URLSearchParams(window.location.search);
  const requestedId = urlParams.get("id");
  if (requestedId) {
    currentItem = items.find((item) => item.id === requestedId) || null;
  }
  if (!currentItem && items.length) {
    currentItem = items[0];
  }

  renderDrawerList();
  if (currentItem) {
    displayArticle(currentItem);
  } else {
    showEmptyState();
  }
}

function bindEvents() {
  // 抽屉开关与搜索
  els.drawerToggle.addEventListener("click", () => {
    els.drawer.hidden = !els.drawer.hidden;
  });
  els.drawerCloseBtn.addEventListener("click", () => {
    els.drawer.hidden = true;
  });
  els.drawerSearchInput.addEventListener("input", renderDrawerList);

  // 字体大小调节 (14px ~ 26px)
  els.fontDecBtn.addEventListener("click", () => {
    if (readerSettings.fontSize > 14) {
      readerSettings.fontSize -= 1;
      applyReaderSettings();
      saveReaderSettings();
    }
  });
  els.fontIncBtn.addEventListener("click", () => {
    if (readerSettings.fontSize < 26) {
      readerSettings.fontSize += 1;
      applyReaderSettings();
      saveReaderSettings();
    }
  });

  // 字体风格
  els.fontFamilySelect.addEventListener("change", (e) => {
    readerSettings.font = e.target.value;
    applyReaderSettings();
    saveReaderSettings();
  });

  // 页面宽度
  els.contentWidthSelect.addEventListener("change", (e) => {
    readerSettings.width = e.target.value;
    applyReaderSettings();
    saveReaderSettings();
  });

  // 主题配色
  els.themeBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      readerSettings.theme = btn.dataset.theme;
      applyReaderSettings();
      saveReaderSettings();
    });
  });

  // 标记完成 / 移回待处理
  els.toggleStatusBtn.addEventListener("click", async () => {
    if (!currentItem) {
      return;
    }
    const nextStatus = currentItem.status === "done" ? "inbox" : "done";
    await updateItemStatus(currentItem.id, nextStatus);
  });

  // 复制正文
  els.copyTextBtn.addEventListener("click", async () => {
    if (!currentExtractedText) {
      return;
    }
    try {
      await navigator.clipboard.writeText(currentExtractedText);
      showToast(t("readerTextCopied"));
    } catch {
      // 忽略复制异常
    }
  });

  // 权限授权与重试
  els.grantPermBtn.addEventListener("click", async () => {
    if (!currentItem) {
      return;
    }
    const granted = await requestOriginPermission(currentItem.url);
    if (granted) {
      loadArticleContent(currentItem);
    }
  });
  els.retryBtn.addEventListener("click", () => {
    if (currentItem) {
      contentCache.delete(currentItem.url);
      loadArticleContent(currentItem);
    }
  });
}

async function loadReaderSettings() {
  try {
    const result = await chrome.storage.local.get({ [READER_SETTINGS_KEY]: DEFAULT_READER_SETTINGS });
    readerSettings = { ...DEFAULT_READER_SETTINGS, ...result[READER_SETTINGS_KEY] };
  } catch {
    readerSettings = { ...DEFAULT_READER_SETTINGS };
  }
}

async function saveReaderSettings() {
  try {
    await chrome.storage.local.set({ [READER_SETTINGS_KEY]: readerSettings });
  } catch {
    // 忽略存储异常
  }
}

function applyReaderSettings() {
  // 字号
  document.documentElement.style.setProperty("--reader-font-size", `${readerSettings.fontSize}px`);
  els.fontSizeDisplay.textContent = `${readerSettings.fontSize}px`;

  // 字体风格
  document.body.classList.remove("font-sans", "font-serif", "font-mono");
  document.body.classList.add(`font-${readerSettings.font}`);
  els.fontFamilySelect.value = readerSettings.font;

  // 宽度
  document.body.classList.remove("width-compact", "width-normal", "width-wide");
  document.body.classList.add(`width-${readerSettings.width}`);
  els.contentWidthSelect.value = readerSettings.width;

  // 主题
  document.body.classList.remove("theme-light", "theme-sepia", "theme-dark", "theme-black");
  document.body.classList.add(`theme-${readerSettings.theme}`);
  els.themeBtns.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.theme === readerSettings.theme);
  });
}

async function loadItems() {
  const result = await chrome.storage.local.get({ [ITEMS_KEY]: [] });
  items = Array.isArray(result[ITEMS_KEY]) ? result[ITEMS_KEY].map(normalizeItem) : [];
}

async function persistItems() {
  await chrome.storage.local.set({ [ITEMS_KEY]: items });
}

async function updateItemStatus(itemId, nextStatus) {
  const index = items.findIndex((i) => i.id === itemId);
  if (index >= 0) {
    items[index].status = nextStatus;
    items[index].updatedAt = new Date().toISOString();
    currentItem = items[index];
    await persistItems();
    updateStatusButtonUI();
    renderDrawerList();
  }
}

function updateStatusButtonUI() {
  if (!currentItem) {
    els.toggleStatusBtn.hidden = true;
    return;
  }
  els.toggleStatusBtn.hidden = false;
  if (currentItem.status === "done") {
    els.toggleStatusBtn.textContent = t("readerMarkInbox");
  } else {
    els.toggleStatusBtn.textContent = t("readerMarkDone");
  }
}

function displayArticle(item) {
  currentItem = item;
  currentExtractedText = "";
  document.title = `${item.title || item.url} · ${t("readerPageTitle")}`;

  // 头部元信息
  els.articleTitle.textContent = item.title || item.url;
  let domain = "";
  try {
    domain = new URL(item.url).hostname;
  } catch {
    domain = "";
  }
  els.articleDomain.textContent = domain;
  els.sourceSiteText.textContent = domain || "原站";
  els.sourceSiteLink.href = item.url;
  els.openOriginalLink.href = item.url;
  els.permOriginalLink.href = item.url;
  els.errOriginalLink.href = item.url;

  // 日期格式化
  const dateStr = item.createdAt ? new Date(item.createdAt).toLocaleDateString() : "";
  els.articleDate.textContent = dateStr;
  els.articleStats.textContent = "";

  // 标签
  els.articleTags.replaceChildren();
  if (Array.isArray(item.tags) && item.tags.length) {
    item.tags.forEach((tag) => {
      const tagEl = document.createElement("span");
      tagEl.className = "article-tag";
      tagEl.textContent = tag;
      els.articleTags.append(tagEl);
    });
  }

  updateStatusButtonUI();
  renderDrawerList();

  // 读取正文
  loadArticleContent(item);
}

async function loadArticleContent(item) {
  els.loadingIndicator.hidden = false;
  els.permissionCard.hidden = true;
  els.errorCard.hidden = true;
  els.articleBody.replaceChildren();
  els.copyTextBtn.disabled = true;

  // 优先取缓存
  if (contentCache.has(item.url)) {
    const cached = contentCache.get(item.url);
    renderArticleBody(cached);
    return;
  }

  // 检查权限
  const hasPerm = await hasOriginPermission(item.url);

  // 尝试抓取正文
  let text = await loadPageText(item.url);

  if (!text && !hasPerm) {
    // 缺失权限导致的读取失败
    els.loadingIndicator.hidden = true;
    els.permissionCard.hidden = false;
    return;
  }

  if (!text) {
    // 读取为空或抓取失败
    els.loadingIndicator.hidden = true;
    els.errorCard.hidden = false;
    return;
  }

  contentCache.set(item.url, text);
  renderArticleBody(text);
}

function renderArticleBody(text) {
  currentExtractedText = text;
  els.loadingIndicator.hidden = true;
  els.permissionCard.hidden = true;
  els.errorCard.hidden = true;
  els.copyTextBtn.disabled = false;

  // 估算字数与阅读时间
  const wordsCount = text.replace(/\s+/g, "").length;
  // 中文按 400 字/分，英文按 200 词/分估算
  const minutes = Math.max(1, Math.round(wordsCount / 350));
  els.articleStats.textContent = t("readerStats", [String(wordsCount), String(minutes)]);

  // 正文段落排版
  els.articleBody.replaceChildren();
  const paragraphs = text.split(/\n+/).map((p) => p.trim()).filter(Boolean);

  paragraphs.forEach((pText) => {
    if (pText.startsWith("### ")) {
      const h3 = document.createElement("h3");
      h3.textContent = pText.replace(/^###\s+/, "");
      els.articleBody.append(h3);
    } else if (pText.startsWith("## ")) {
      const h2 = document.createElement("h2");
      h2.textContent = pText.replace(/^##\s+/, "");
      els.articleBody.append(h2);
    } else if (pText.startsWith("# ")) {
      const h2 = document.createElement("h2");
      h2.textContent = pText.replace(/^#\s+/, "");
      els.articleBody.append(h2);
    } else if (pText.startsWith("> ")) {
      const blockquote = document.createElement("blockquote");
      blockquote.textContent = pText.replace(/^>\s+/, "");
      els.articleBody.append(blockquote);
    } else {
      const p = document.createElement("p");
      p.textContent = pText;
      els.articleBody.append(p);
    }
  });
}

function renderDrawerList() {
  const query = (els.drawerSearchInput.value || "").trim().toLowerCase();
  els.drawerList.replaceChildren();

  const filtered = items.filter((item) => {
    if (!query) {
      return true;
    }
    const matchTitle = (item.title || "").toLowerCase().includes(query);
    const matchUrl = (item.url || "").toLowerCase().includes(query);
    const matchTags = (item.tags || []).some((t) => t.toLowerCase().includes(query));
    return matchTitle || matchUrl || matchTags;
  });

  if (!filtered.length) {
    const emptyEl = document.createElement("div");
    emptyEl.className = "drawer-item muted";
    emptyEl.textContent = t("dashArticlesEmpty");
    els.drawerList.append(emptyEl);
    return;
  }

  filtered.forEach((item) => {
    const itemEl = document.createElement("div");
    itemEl.className = "drawer-item";
    if (currentItem && item.id === currentItem.id) {
      itemEl.classList.add("active");
    }

    const titleEl = document.createElement("div");
    titleEl.className = "drawer-item-title";
    titleEl.textContent = item.title || item.url;

    const metaEl = document.createElement("div");
    metaEl.className = "drawer-item-meta";
    let host = "";
    try {
      host = new URL(item.url).hostname;
    } catch {
      host = "";
    }
    metaEl.textContent = host;

    itemEl.append(titleEl, metaEl);
    itemEl.addEventListener("click", () => {
      if (currentItem?.id === item.id) {
        return;
      }
      // 更新 URL 参数但不刷新
      const newUrl = new URL(window.location);
      newUrl.searchParams.set("id", item.id);
      window.history.pushState({}, "", newUrl);

      displayArticle(item);
    });

    els.drawerList.append(itemEl);
  });
}

function showEmptyState() {
  els.loadingIndicator.hidden = true;
  els.articleTitle.textContent = t("dashArticlesEmpty");
  els.articleBody.replaceChildren();
}

function showToast(text) {
  els.readerToast.textContent = text;
  els.readerToast.hidden = false;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    els.readerToast.hidden = true;
  }, 2400);
}
