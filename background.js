const ITEMS_KEY = "laterbox.items.v1";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "save-page",
    title: chrome.i18n.getMessage("contextMenuSavePage"),
    contexts: ["page"]
  });

  chrome.contextMenus.create({
    id: "save-link",
    title: chrome.i18n.getMessage("contextMenuSaveLink"),
    contexts: ["link"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
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
        faviconUrl: "",
        source: "context-link"
      }
    : await collectCurrentPage(tab);

  await saveItem(item);
});

async function collectCurrentPage(tab) {
  const pageMeta = await readPageMeta(tab?.id);

  return {
    title: pageMeta.title || tab?.title || tab?.url,
    url: tab?.url || pageMeta.url,
    description: pageMeta.description || "",
    faviconUrl: "",
    source: "context-page"
  };
}

async function readPageMeta(tabId) {
  if (!tabId) {
    return {};
  }

  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
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
      faviconUrl: "",
      status: "inbox",
      updatedAt: now
    };
  } else {
    items.unshift({
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
    });
  }

  await chrome.storage.local.set({ [ITEMS_KEY]: items });
}

function isSupportedWebUrl(url) {
  try {
    return ["http:", "https:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}
