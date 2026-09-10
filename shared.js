const ITEMS_KEY = "laterbox.items.v1";
const FEATURES_KEY = "laterbox.features.v1";

// 三项 AI 增强功能默认关闭，需在「更多功能」页开启后才生效
const DEFAULT_FEATURES = {
  quickTldr: false,
  promptTemplates: false,
  autoTags: false
};

async function loadFeatures() {
  try {
    const result = await chrome.storage.local.get({ [FEATURES_KEY]: DEFAULT_FEATURES });
    return { ...DEFAULT_FEATURES, ...(result[FEATURES_KEY] || {}) };
  } catch {
    return { ...DEFAULT_FEATURES };
  }
}

async function saveFeature(key, enabled) {
  const current = await loadFeatures();
  const next = { ...current, [key]: Boolean(enabled) };
  await chrome.storage.local.set({ [FEATURES_KEY]: next });
  return next;
}

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
  root.querySelectorAll("[data-i18n-title]").forEach((element) => {
    element.title = t(element.dataset.i18nTitle);
  });
}

function normalizeItem(item) {
  return {
    ...item,
    description: item.description || "",
    tags: Array.isArray(item.tags) ? item.tags : [],
    note: item.note || "",
    tldr: item.tldr || "",
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

function getDaysAgo(dateStr) {
  if (!dateStr) return 0;
  const time = new Date(dateStr).getTime();
  if (Number.isNaN(time)) return 0;
  return Math.max(0, Math.floor((Date.now() - time) / (1000 * 60 * 60 * 24)));
}

const AI_SETTINGS_KEY = "laterbox.ai.v1";

const TAG_RULE_DICTIONARY = [
  { tag: "前端", keywords: ["html", "css", "javascript", "typescript", "react", "vue", "svelte", "angular", "tailwind", "vite", "webpack", "前端", "web前端", "css3", "canvas", "dom", "ui组件", "next.js", "nuxt", "electron"] },
  { tag: "后端", keywords: ["golang", "java", "python", "rust", "c++", "c#", "后端", "服务端", "spring", "django", "flask", "gin", "express", "nodejs", "node.js", "mysql", "postgresql", "redis", "mongodb", "数据库", "api", "微服务", "restful", "grpc"] },
  { tag: "架构", keywords: ["系统设计", "系统架构", "架构", "分布式", "高并发", "性能优化", "重构", "缓存", "负载均衡", "高可用", "云原生", "kubernetes", "k8s", "docker", "容器", "微服务架构"] },
  { tag: "AI", keywords: ["ai", "大模型", "llm", "gpt", "gemini", "claude", "deepseek", "提示词", "prompt", "深度学习", "机器学习", "智能体", "agent", "rag", "神经网络", "transformer", "openai", "人工智能"] },
  { tag: "开源", keywords: ["github", "gitlab", "open source", "开源", "源码", "开源项目", "仓库", "repo", "apache", "mit license"] },
  { tag: "工具", keywords: ["chrome 扩展", "extension", "插件", "效率工具", "工具", "cli", "自动化", "快捷键", "devtools", "脚本", "workflow", "终端"] },
  { tag: "产品", keywords: ["产品经理", "产品设计", "需求", "ux", "交互设计", "用户体验", "原型", "figma", "商业模式", "增长", "用户研究"] },
  { tag: "算法", keywords: ["算法", "数据结构", "复杂度", "leetcode", "动态规划", "二叉树", "图论", "排序算法"] },
  { tag: "移动端", keywords: ["ios", "android", "swift", "kotlin", "flutter", "react native", "移动端", "app开发"] },
  { tag: "安全", keywords: ["网络安全", "漏洞", "认证", "jwt", "csrf", "xss", "权限系统", "加密", "安全攻防", "渗透测试", "信息安全", "security"] }
];

/**
 * 关键词匹配：纯 ASCII 关键词按词边界匹配，避免 "ai" 命中 "email"、"gin" 命中 "login" 之类的误报；
 * 含中文等非 ASCII 的关键词仍按子串匹配。
 * @param {string} haystack 已转为小写的待匹配文本
 * @param {string} keyword 关键词（大小写均可）
 */
function matchesKeyword(haystack, keyword) {
  const kw = String(keyword || "").toLowerCase();
  if (!kw) return false;
  // eslint-disable-next-line no-control-regex
  if (!/^[\x20-\x7e]+$/.test(kw)) {
    return haystack.includes(kw);
  }
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}(?![a-z0-9])`).test(haystack);
}

/**
 * 智能自动标签建议：基于标题、描述和 URL 快速推测 2~3 个最贴切的分类标签
 * 过滤掉已有标签，按相关度排序
 * @param {object} itemOrMeta 包含 title, description, url, tags 等
 * @param {number} maxCount 建议数量上限（默认 3 个）
 * @returns {string[]} 标签数组，例如 ["前端", "架构", "开源"]
 */
function suggestTags(itemOrMeta, maxCount = 3) {
  if (!itemOrMeta) return [];
  const title = String(itemOrMeta.title || "").toLowerCase();
  const desc = String(itemOrMeta.description || "").toLowerCase();
  const url = String(itemOrMeta.url || "").replace(/^https?:\/\//i, "").toLowerCase();
  const existingTags = new Set((itemOrMeta.tags || []).map((t) => String(t).trim().toLowerCase()));

  const scores = [];

  for (const rule of TAG_RULE_DICTIONARY) {
    if (existingTags.has(rule.tag.toLowerCase())) {
      continue;
    }
    let score = 0;
    for (const kw of rule.keywords) {
      if (matchesKeyword(title, kw)) {
        score += 3;
      } else if (matchesKeyword(desc, kw)) {
        score += 1.5;
      } else if (matchesKeyword(url, kw)) {
        score += 1;
      }
    }
    if (score > 0) {
      scores.push({ tag: rule.tag, score });
    }
  }

  // 排序并截取
  scores.sort((a, b) => b.score - a.score);
  const result = scores.slice(0, maxCount).map((item) => item.tag);

  // 兜底策略：规则库一个都没匹配上时，只从标题中挑疑似专有名词/技术术语
  // （全大写缩写 / 驼峰 / 含数字或符号的词元），避免把 "your"、"Spain" 这类普通英文单词当成标签
  if (!result.length && title) {
    const techWords = String(itemOrMeta.title || "").match(/[A-Za-z][A-Za-z0-9+#.-]{1,}/g) || [];
    const picked = new Set();
    for (const word of techWords) {
      const clean = word.replace(/^[.#+-]+|[.#+-]+$/g, "");
      const lower = clean.toLowerCase();
      const looksLikeTechTerm = /^[A-Z0-9]{2,6}$/.test(clean)   // GPT、RAG、API
        || /[0-9+#.]/.test(clean)                               // Next.js、C++、GPT-4
        || /[a-z][A-Z]/.test(clean);                            // TypeScript、GitHub、DeepSeek
      const letterCount = (clean.match(/[A-Za-z]/g) || []).length;
      if (clean.length < 2 || letterCount < 2 || !looksLikeTechTerm) {
        continue;
      }
      if (existingTags.has(lower) || picked.has(lower)) {
        continue;
      }
      picked.add(lower);
      result.push(clean);
      if (result.length >= maxCount) break;
    }
  }

  return result;
}

function getLanguageModel() {
  if (typeof LanguageModel !== "undefined") {
    return LanguageModel;
  }
  if (globalThis.ai?.languageModel) {
    return globalThis.ai.languageModel;
  }
  return null;
}

function resolveAiProvider(current) {
  if (current.provider === "openai") {
    return "openai";
  }
  if (current.provider === "builtin") {
    return "builtin";
  }
  return getLanguageModel() ? "builtin" : "openai";
}

/**
 * 针对单个条目生成 3 句话速读 (TL;DR)，支持流式 onDelta 回调
 */
async function generateTldrStream(article, onDelta, signal) {
  const result = await chrome.storage.local.get({ [AI_SETTINGS_KEY]: { provider: "auto", baseUrl: "", apiKey: "", model: "" } });
  const settings = result[AI_SETTINGS_KEY] || {};
  const provider = resolveAiProvider(settings);

  if (provider === "openai" && (!settings.baseUrl || !settings.apiKey)) {
    const err = new Error(t("tldrNotConfigured"));
    err.code = "AI_NOT_CONFIGURED";
    throw err;
  }

  const articleText = (article.content || article.description || "").slice(0, 3500);
  const promptText = `请用且仅用 3 句话速读（TL;DR）提炼以下网页的核心内容，帮助读者在 5 秒内评估是否值得精读：
网页标题：${article.title || ""}
网页链接：${article.url || ""}
网页正文/摘要：
${articleText || "（仅有标题与链接元数据）"}

严格要求：
1. 必须输出且仅输出 3 条精炼要点，按编号排版：
1. [背景/主题] 概括主要讨论的核心问题或背景。
2. [方案/见解] 提炼作者的核心观点、方案或关键逻辑。
3. [价值/行动] 说明实用结论、行动建议或启发。
2. 语言简明扼要，直击要害，杜绝任何客套与多余废话。请使用中文输出。`;

  if (provider === "builtin") {
    const lm = getLanguageModel();
    if (!lm) {
      const err = new Error(t("tldrNotConfigured"));
      err.code = "AI_NOT_CONFIGURED";
      throw err;
    }
    let availability = "unavailable";
    if (typeof lm.availability === "function") {
      availability = await lm.availability();
    } else if (typeof lm.capabilities === "function") {
      availability = (await lm.capabilities()).available;
    }
    if (availability === "unavailable" || availability === "no") {
      const err = new Error(t("tldrNotConfigured"));
      err.code = "AI_NOT_CONFIGURED";
      throw err;
    }
    const session = await lm.create({
      initialPrompts: [{ role: "system", content: "你是专业的速读与内容提炼助手，擅长在 3 句话内精准提炼文章核心。" }]
    });
    try {
      const reader = session.promptStreaming(promptText).getReader();
      let full = "";
      while (true) {
        if (signal?.aborted) {
          reader.cancel().catch(() => {});
          break;
        }
        const { done, value } = await reader.read();
        if (done) break;
        const chunkText = String(value ?? "");
        if (chunkText.startsWith(full) && chunkText.length > full.length) {
          onDelta(chunkText.slice(full.length));
          full = chunkText;
        } else {
          full += chunkText;
          onDelta(chunkText);
        }
      }
      return full;
    } finally {
      if (typeof session.destroy === "function") {
        session.destroy();
      }
    }
  }

  // 自定义 OpenAI 接口调用
  const response = await fetch(settings.baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify({
      model: settings.model || undefined,
      messages: [
        { role: "system", content: "你是专业的速读与内容提炼助手，擅长在 3 句话内精准提炼文章核心。" },
        { role: "user", content: promptText }
      ],
      stream: true
    }),
    signal
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status} ${detail.slice(0, 200)}`);
  }

  let full = "";
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("text/event-stream") && response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      if (signal?.aborted) {
        reader.cancel().catch(() => {});
        break;
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            full += delta;
            onDelta(delta);
          }
        } catch {}
      }
    }
  } else {
    const json = await response.json();
    const text = json.choices?.[0]?.message?.content || "";
    full = text;
    onDelta(text);
  }
  return full;
}

