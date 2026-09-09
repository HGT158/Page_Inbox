importScripts("shared.js");

const flashTimers = new Map();
const SIDE_PANEL_PREF_KEY = "laterbox.openInSidePanel";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "save-page",
    title: t("contextMenuSavePage"),
    contexts: ["page"]
  });

  chrome.contextMenus.create({
    id: "save-link",
    title: t("contextMenuSaveLink"),
    contexts: ["link"]
  });

  chrome.contextMenus.create({
    id: "open-sidepanel",
    title: t("contextMenuOpenSidePanel"),
    contexts: ["page", "action"]
  });

  syncPanelBehavior();
  updateAllBadges();
});

chrome.runtime.onStartup.addListener(() => {
  syncPanelBehavior();
  updateAllBadges();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "open-sidepanel") {
    if (tab?.windowId && chrome.sidePanel?.open) {
      chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
    }
    return;
  }

  if (info.menuItemId !== "save-page" && info.menuItemId !== "save-link") {
    return;
  }

  const url = info.linkUrl || info.pageUrl || tab?.url;
  if (!isSupportedWebUrl(url)) {
    return;
  }

  const item = info.menuItemId === "save-link"
    ? {
        title: info.selectionText || info.linkUrl,
        url,
        description: "",
        source: "context-link"
      }
    : await collectCurrentPage(tab);

  await saveItem(item);
  if (tab?.id) {
    await flashBadgeFeedback(tab.id, "✓", "#10b981");
  }
});

// 全局快捷键监听 (默认 Alt+S 保存，Alt+B 打开侧边栏)
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "save-current-page") {
    await handleSaveCurrentCommand();
  } else if (command === "open-sidepanel") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.windowId && chrome.sidePanel?.open) {
      chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
    }
  }
});

// 监听存储变化（在 popup、sidepanel、dashboard 等任何地方修改均可同步触发）
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local") {
    if (changes[ITEMS_KEY]) {
      updateAllBadges();
    }
    if (changes[SIDE_PANEL_PREF_KEY]) {
      syncPanelBehavior();
    }
  }
});

async function syncPanelBehavior() {
  try {
    const result = await chrome.storage.local.get({ [SIDE_PANEL_PREF_KEY]: false });
    const openInSidePanel = Boolean(result[SIDE_PANEL_PREF_KEY]);
    if (chrome.sidePanel?.setPanelBehavior) {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: openInSidePanel });
    }
    if (chrome.action?.setPopup) {
      await chrome.action.setPopup({ popup: openInSidePanel ? "" : "popup.html" });
    }
  } catch {
    // 忽略特定平台暂不支持异常
  }
}

// 监听标签页激活与切换
chrome.tabs.onActivated.addListener((activeInfo) => {
  updateBadgeForTab(activeInfo.tabId);
});

// 监听标签页更新（如导航新网址或加载完成）
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete" || changeInfo.url) {
    updateBadgeForTab(tabId);
  }
});

async function handleSaveCurrentCommand() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !isSupportedWebUrl(tab.url)) {
    if (tab?.id) {
      await flashBadgeFeedback(tab.id, "!", "#ef4444");
    }
    return;
  }

  const item = await collectCurrentPage(tab);
  item.source = "shortcut";
  await saveItem(item);
  await flashBadgeFeedback(tab.id, "✓", "#10b981");
}

async function collectCurrentPage(tab) {
  const pageMeta = await readPageMeta(tab?.id);

  return {
    title: pageMeta.title || tab?.title || pageMeta.url || tab?.url,
    url: pageMeta.url || tab?.url,
    description: pageMeta.description || "",
    source: "context-page"
  };
}

async function saveItem(item) {
  const result = await chrome.storage.local.get({ [ITEMS_KEY]: [] });
  const items = Array.isArray(result[ITEMS_KEY]) ? result[ITEMS_KEY] : [];
  const existingIndex = items.findIndex((saved) => saved.url === item.url);
  const now = new Date().toISOString();

  if (existingIndex >= 0) {
    items[existingIndex] = {
      ...items[existingIndex],
      title: item.title || items[existingIndex].title,
      description: item.description || items[existingIndex].description || "",
      status: "inbox",
      updatedAt: now
    };
  } else {
    items.unshift({
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
    });
  }

  try {
    await chrome.storage.local.set({ [ITEMS_KEY]: items });
  } catch {
    // Silently fail — the popup will show errors on its own writes.
  }
}

// 瞬时闪烁 Badge 反馈
async function flashBadgeFeedback(tabId, text, color) {
  if (!tabId) {
    return;
  }
  if (flashTimers.has(tabId)) {
    clearTimeout(flashTimers.get(tabId));
  }
  try {
    await chrome.action.setBadgeText({ tabId, text });
    await chrome.action.setBadgeBackgroundColor({ tabId, color });
  } catch {
    // Tab 可能已关闭或无效
  }

  const timer = setTimeout(async () => {
    flashTimers.delete(tabId);
    await updateBadgeForTab(tabId);
  }, 1500);
  flashTimers.set(tabId, timer);
}

// 更新指定 Tab 的角标与已存感知
async function updateBadgeForTab(tabId) {
  if (!tabId || flashTimers.has(tabId)) {
    return;
  }
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab) {
      return;
    }
    const result = await chrome.storage.local.get({ [ITEMS_KEY]: [] });
    const items = Array.isArray(result[ITEMS_KEY]) ? result[ITEMS_KEY] : [];
    const inboxCount = items.filter((i) => i.status !== "done").length;
    const stripHash = (u) => (u ? u.split("#")[0] : u);
    const isSaved = Boolean(tab.url && isSupportedWebUrl(tab.url)
      && items.some((i) => stripHash(i.url) === stripHash(tab.url)));
    const extName = t("extensionName");

    if (isSaved) {
      const text = inboxCount > 0
        ? `✓${inboxCount > 99 ? "99+" : inboxCount}`
        : "✓";
      await chrome.action.setBadgeText({ tabId, text });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: "#10b981" });
      const title = inboxCount > 0
        ? t("actionTitleSaved", [extName, String(inboxCount)])
        : t("actionTitleSavedNoInbox", [extName]);
      await chrome.action.setTitle({ tabId, title });
    } else {
      const countStr = inboxCount > 99 ? "99+" : (inboxCount > 0 ? String(inboxCount) : "");
      await chrome.action.setBadgeText({ tabId, text: countStr });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: "#475569" });
      const title = inboxCount > 0
        ? t("actionTitleNormal", [extName, String(inboxCount)])
        : extName;
      await chrome.action.setTitle({ tabId, title });
    }
  } catch {
    // 忽略 tab 不可用错误
  }
}

// 更新全局角标基准及当前活跃窗口的 active tab
async function updateAllBadges() {
  const result = await chrome.storage.local.get({ [ITEMS_KEY]: [] });
  const items = Array.isArray(result[ITEMS_KEY]) ? result[ITEMS_KEY] : [];
  const inboxCount = items.filter((i) => i.status !== "done").length;
  const countStr = inboxCount > 99 ? "99+" : (inboxCount > 0 ? String(inboxCount) : "");
  const extName = t("extensionName");

  try {
    await chrome.action.setBadgeText({ text: countStr });
    await chrome.action.setBadgeBackgroundColor({ color: "#475569" });
    const defaultTitle = inboxCount > 0
      ? t("actionTitleNormal", [extName, String(inboxCount)])
      : extName;
    await chrome.action.setTitle({ title: defaultTitle });
  } catch {
    // 忽略异常
  }

  try {
    const tabs = await chrome.tabs.query({ active: true });
    for (const tab of tabs) {
      if (tab.id) {
        await updateBadgeForTab(tab.id);
      }
    }
  } catch {
    // 忽略异常
  }
}

