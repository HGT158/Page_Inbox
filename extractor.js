// extractor.js - 网页正文抽取共享模块
// 供 ai.js 与 reader.js 共同使用

const EXTRACTOR_FETCH_TIMEOUT = 15000;
const EXTRACTOR_TAB_TIMEOUT = 15000;
const EXTRACTOR_SETTLE_DELAY = 800;
const EXTRACTOR_TEXT_MIN_LENGTH = 150;

/**
 * 注入页面的自包含函数，提取主区域文字（通过 chrome.scripting.executeScript 注入）
 * 必须保持完全独立，不能引用外部闭包变量
 */
function extractPageMainText() {
  document.querySelectorAll("script, style, noscript, svg, iframe, template, nav, footer, header, aside, form, button, .ad, .ads, .advertisement")
    .forEach((el) => el.remove());
  const main = document.querySelector("article, main, [role=\"main\"], #content, .content, .post-content, .article-content, .entry-content") || document.body || document.documentElement;
  document.querySelectorAll("br").forEach((el) => el.replaceWith("\n"));
  for (const tag of ["p", "div", "li", "tr", "section", "article", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "dd", "dt"]) {
    document.querySelectorAll(tag).forEach((el) => el.append("\n"));
  }
  return (main.textContent || "")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/**
 * 清理提取出的文本空白与换行
 */
function cleanExtractedText(text) {
  return (text || "")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/**
 * 通过 DOMParser 解析 HTML 字符串并提取正文
 */
function extractReadableText(html) {
  if (!html || typeof html !== "string") {
    return "";
  }
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelectorAll("script, style, noscript, svg, iframe, template, nav, footer, header, aside, form, button, .ad, .ads, .advertisement")
      .forEach((el) => el.remove());
    const main = doc.querySelector("article, main, [role=\"main\"], #content, .content, .post-content, .article-content, .entry-content") || doc.body || doc.documentElement;
    doc.querySelectorAll("br").forEach((el) => el.replaceWith("\n"));
    for (const tag of ["p", "div", "li", "tr", "section", "article", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "dd", "dt"]) {
      doc.querySelectorAll(tag).forEach((el) => el.append("\n"));
    }
    return cleanExtractedText(main.textContent || "");
  } catch {
    return "";
  }
}

/**
 * 等待后台标签页加载完毕
 */
function waitForTabLoaded(tabId, timeoutMs = EXTRACTOR_TAB_TIMEOUT) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        finish();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") {
        finish();
      }
    }).catch(finish);
    setTimeout(finish, timeoutMs);
  });
}

/**
 * 检查当前扩展是否拥有某网址所在 origin 的权限
 */
async function hasOriginPermission(url) {
  try {
    const origin = `${new URL(url).origin}/*`;
    return await chrome.permissions.contains({ origins: [origin] });
  } catch {
    return false;
  }
}

/**
 * 请求某网址所在 origin 的权限
 */
async function requestOriginPermission(url) {
  try {
    const origin = `${new URL(url).origin}/*`;
    return await chrome.permissions.request({ origins: [origin] });
  } catch {
    return false;
  }
}

/**
 * 直接 fetch 网页并解析正文
 */
async function fetchPageText(url, timeoutMs = EXTRACTOR_FETCH_TIMEOUT) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      return "";
    }
    const html = await response.text();
    return extractReadableText(html);
  } catch {
    return "";
  }
}

/**
 * 在后台静默打开一个 active: false 的标签页注入脚本抽取正文，然后关闭
 */
async function extractViaTab(url) {
  let origin;
  try {
    origin = `${new URL(url).origin}/*`;
  } catch {
    return "";
  }

  try {
    if (!(await chrome.permissions.contains({ origins: [origin] }))) {
      return "";
    }
  } catch {
    return "";
  }

  let tab = null;
  try {
    tab = await chrome.tabs.create({ url, active: false });
    await waitForTabLoaded(tab.id, EXTRACTOR_TAB_TIMEOUT);
    await new Promise((resolve) => setTimeout(resolve, EXTRACTOR_SETTLE_DELAY));
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPageMainText
    });
    return String(injection?.result || "").trim();
  } catch {
    return "";
  } finally {
    if (tab) {
      chrome.tabs.remove(tab.id).catch(() => {});
    }
  }
}

/**
 * 综合加载正文（先尝试 fetch，若过短或为空则通过后台 tab 注入抽取）
 * @param {string} url 目标链接
 * @param {number|null} limit 最大字符数限制，null 则不截断
 */
async function loadPageText(url, limit = null) {
  let text = await fetchPageText(url);
  if (!text || text.length < EXTRACTOR_TEXT_MIN_LENGTH) {
    const tabText = await extractViaTab(url);
    if (tabText && tabText.length > (text ? text.length : 0)) {
      text = tabText;
    }
  }
  if (!text) {
    return "";
  }
  return limit ? text.slice(0, limit) : text;
}
