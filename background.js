const ITEMS_KEY = "laterbox.items.v1";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "save-page",
    title: "存入网页稍后处理",
    contexts: ["page"]
  });

  chrome.contextMenus.create({
    id: "save-link",
    title: "存入网页稍后处理",
    contexts: ["link"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "save-page" && info.menuItemId !== "save-link") {
    return;
  }

  const url = info.linkUrl || info.pageUrl || tab?.url;
  if (!url || isUnsupportedUrl(url)) {
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
    faviconUrl: pageMeta.faviconUrl || tab?.favIconUrl || "",
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
        const icon = Array.from(document.querySelectorAll("link[rel]"))
          .find((link) => /\b(icon|apple-touch-icon)\b/i.test(link.rel || ""))?.href || "";

        return {
          title: document.title,
          url: location.href,
          description: meta("description") || meta("og:description") || meta("twitter:description"),
          faviconUrl: icon ? new URL(icon, location.href).href : ""
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
  const items = result[ITEMS_KEY];
  const existingIndex = items.findIndex((saved) => saved.url === item.url);
  const now = new Date().toISOString();

  if (existingIndex >= 0) {
    items[existingIndex] = {
      ...items[existingIndex],
      title: item.title || items[existingIndex].title,
      description: item.description || items[existingIndex].description || "",
      faviconUrl: item.faviconUrl || items[existingIndex].faviconUrl || "",
      status: "inbox",
      updatedAt: now
    };
  } else {
    items.unshift({
      id: crypto.randomUUID(),
      title: item.title || item.url,
      url: item.url,
      description: item.description || "",
      faviconUrl: item.faviconUrl || "",
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

function isUnsupportedUrl(url) {
  return /^(chrome|edge|about|devtools):/i.test(url);
}
