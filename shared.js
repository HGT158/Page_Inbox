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
