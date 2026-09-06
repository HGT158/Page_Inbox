const ITEMS_KEY = "laterbox.items.v1";

function isSupportedWebUrl(url) {
  try {
    return ["http:", "https:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

function readPageMeta(tabId) {
  if (!tabId) {
    return Promise.resolve({});
  }

  return chrome.scripting.executeScript({
    target: { tabId },
    func: extractPageMeta
  }).then(([injection]) => injection?.result || {}).catch(() => ({}));
}

function extractPageMeta() {
  const meta = (name) => document.querySelector(`meta[name="${name}"], meta[property="${name}"]`)?.content?.trim() || "";

  return {
    title: document.title,
    url: location.href,
    description: meta("description") || meta("og:description") || meta("twitter:description")
  };
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

function normalizeItem(item) {
  return {
    ...item,
    description: item.description || "",
    tags: Array.isArray(item.tags) ? item.tags : [],
    note: item.note || "",
    status: item.status || "inbox",
    pinned: Boolean(item.pinned)
  };
}

function parseTags(value) {
  return Array.from(new Set(value
    .split(/[,，\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean)));
}

function toMarkdownLink(item) {
  return `[${escapeMarkdown(item.title || item.url)}](${item.url})`;
}

function escapeMarkdown(text) {
  return text.replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function buildMarkdownLines(items) {
  return items.map((item) => {
    const tags = item.tags.map((tag) => `#${tag}`).join(" ");
    const note = item.note ? ` - ${item.note}` : "";
    return `- ${toMarkdownLink(item)}${tags ? ` ${tags}` : ""}${note}`;
  });
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

function today() {
  return new Date().toISOString().slice(0, 10);
}
