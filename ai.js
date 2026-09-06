const AI_SETTINGS_KEY = "laterbox.ai.v1";
const AI_CHATS_KEY = "laterbox.ai.chats.v1";
const DEFAULT_AI_SETTINGS = { provider: "auto", baseUrl: "", apiKey: "", model: "", includeContent: true };
const PAGE_TEXT_LIMIT = 8000;
const PAGE_CONTENT_MAX_ITEMS = 6;
const PAGE_FETCH_TIMEOUT = 15000;
const PAGE_TEXT_MIN_LENGTH = 200;
const TAB_LOAD_TIMEOUT = 15000;
const TAB_SETTLE_DELAY = 800;
const AI_CHATS_MAX = 30;
const AI_CHAT_MESSAGES_MAX = 200;
const byUpdatedDesc = (a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));

const els = {
  search: document.querySelector("#aiSearch"),
  selectedCount: document.querySelector("#selectedCount"),
  permissionBanner: document.querySelector("#permissionBanner"),
  bannerText: document.querySelector("#bannerText"),
  grantButton: document.querySelector("#grantButton"),
  itemList: document.querySelector("#itemList"),
  providerStatus: document.querySelector("#providerStatus"),
  chatSelect: document.querySelector("#chatSelect"),
  newChatButton: document.querySelector("#newChatButton"),
  deleteChatButton: document.querySelector("#deleteChatButton"),
  messages: document.querySelector("#messages"),
  input: document.querySelector("#aiInput"),
  sendButton: document.querySelector("#sendButton"),
  stopButton: document.querySelector("#stopButton"),
  settingsPanel: document.querySelector("#settingsPanel"),
  providerSelect: document.querySelector("#providerSelect"),
  modelInput: document.querySelector("#modelInput"),
  baseUrlInput: document.querySelector("#baseUrlInput"),
  apiKeyInput: document.querySelector("#apiKeyInput"),
  includeContentInput: document.querySelector("#includeContentInput"),
  saveSettingsButton: document.querySelector("#saveSettingsButton"),
  toast: document.querySelector("#aiToast")
};

let items = [];
let settings = { ...DEFAULT_AI_SETTINGS };
let chat = [];
let conversations = [];
let currentChatId = null;
let selectedIds = new Set();
let lastContextKey = "";
let streaming = false;
let stopRequested = false;
let controller = null;
let builtinSession = null;
const pageCache = new Map();

init();

async function init() {
  localizeDocument();
  document.title = `${t("extensionName")} · ${t("aiPageTitle")}`;
  await loadSettings();
  await loadItems();
  await loadChats();
  currentChatId = conversations.length ? [...conversations].sort(byUpdatedDesc)[0].id : null;
  restoreChatIntoMemory();
  bindEvents();
  renderItemList();
  renderChat();
  renderChatList();
  updateComposer();
  await updateStatus();
  await refreshPermissionBanner();
}

function bindEvents() {
  els.search.addEventListener("input", renderItemList);
  els.grantButton.addEventListener("click", grantContentPermission);
  els.chatSelect.addEventListener("change", () => switchChat(els.chatSelect.value));
  els.newChatButton.addEventListener("click", newChat);
  els.deleteChatButton.addEventListener("click", deleteChat);
  els.sendButton.addEventListener("click", send);
  els.stopButton.addEventListener("click", () => {
    stopRequested = true;
    if (controller) {
      controller.abort();
    }
  });
  els.input.addEventListener("input", updateComposer);
  els.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  });
  els.saveSettingsButton.addEventListener("click", saveSettings);
  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      els.input.value = chip.textContent;
      els.input.focus();
      updateComposer();
    });
  });
}

async function loadItems() {
  const result = await chrome.storage.local.get({ [ITEMS_KEY]: [] });
  items = Array.isArray(result[ITEMS_KEY]) ? result[ITEMS_KEY].map(normalizeItem) : [];
}

async function loadSettings() {
  const result = await chrome.storage.local.get({ [AI_SETTINGS_KEY]: DEFAULT_AI_SETTINGS });
  settings = { ...DEFAULT_AI_SETTINGS, ...(result[AI_SETTINGS_KEY] || {}) };
  els.providerSelect.value = settings.provider;
  els.baseUrlInput.value = settings.baseUrl;
  els.apiKeyInput.value = settings.apiKey;
  els.modelInput.value = settings.model;
  els.includeContentInput.checked = settings.includeContent !== false;
}

async function saveSettings() {
  const provider = els.providerSelect.value;
  const baseUrl = els.baseUrlInput.value.trim();
  if (baseUrl) {
    try {
      new URL(baseUrl);
    } catch {
      showToast(t("aiInvalidEndpoint"));
      return;
    }
  }

  settings = {
    provider,
    baseUrl,
    apiKey: els.apiKeyInput.value.trim(),
    model: els.modelInput.value.trim(),
    includeContent: els.includeContentInput.checked
  };
  await chrome.storage.local.set({ [AI_SETTINGS_KEY]: settings });
  builtinSession = null;

  if (resolveProvider(settings) === "openai" && baseUrl) {
    await ensureEndpointPermission();
  }
  await updateStatus();
  await refreshPermissionBanner();
  showToast(t("aiSettingsSaved"));
}

async function ensureEndpointPermission() {
  if (!settings.baseUrl) {
    return false;
  }
  let origin;
  try {
    origin = `${new URL(settings.baseUrl).origin}/*`;
  } catch {
    return false;
  }
  try {
    if (await chrome.permissions.contains({ origins: [origin] })) {
      return true;
    }
    return await chrome.permissions.request({ origins: [origin] });
  } catch {
    return false;
  }
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

function resolveProvider(current) {
  if (current.provider === "openai") {
    return "openai";
  }
  if (current.provider === "builtin") {
    return "builtin";
  }
  return getLanguageModel() ? "builtin" : "openai";
}

async function updateStatus() {
  const provider = resolveProvider(settings);
  if (provider === "builtin") {
    els.providerStatus.textContent = t("aiStatusBuiltin");
  } else if (settings.baseUrl && settings.apiKey) {
    els.providerStatus.textContent = t("aiStatusOpenai", settings.model || "-");
  } else {
    els.providerStatus.textContent = t("aiStatusNotConfigured");
  }
}

async function ensureBuiltinSession() {
  if (builtinSession) {
    return builtinSession;
  }
  const lm = getLanguageModel();
  if (!lm) {
    return null;
  }
  let availability = "unavailable";
  if (typeof lm.availability === "function") {
    availability = await lm.availability();
  } else if (typeof lm.capabilities === "function") {
    availability = (await lm.capabilities()).available;
  }
  if (availability === "unavailable" || availability === "no") {
    return null;
  }
  builtinSession = await lm.create({
    initialPrompts: [{ role: "system", content: systemPrompt() }]
  });
  return builtinSession;
}

async function streamTurn(history, newUserText, onDelta) {
  const provider = resolveProvider(settings);
  stopRequested = false;

  if (provider === "builtin") {
    const session = await ensureBuiltinSession();
    if (!session) {
      throw new Error(t("aiStatusNotConfigured"));
    }
    const reader = session.promptStreaming(newUserText).getReader();
    let full = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done || stopRequested) {
        if (stopRequested) {
          reader.cancel().catch(() => {});
        }
        break;
      }
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
  }

  controller = new AbortController();
  const response = await fetch(settings.baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify({
      model: settings.model || undefined,
      messages: history,
      stream: true
    }),
    signal: controller.signal
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status} ${detail.slice(0, 200)}`);
  }

  let full = "";
  const emit = (text) => {
    full += text;
    onDelta(text);
  };
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("text/event-stream") && response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done || stopRequested) {
        if (stopRequested) {
          reader.cancel().catch(() => {});
        }
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) {
          continue;
        }
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") {
          continue;
        }
        try {
          const json = JSON.parse(payload);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            emit(delta);
          }
        } catch {
          // Skip malformed SSE chunks; the model stream may split lines arbitrarily.
        }
      }
    }
  } else {
    const json = await response.json();
    emit(json.choices?.[0]?.message?.content || "");
  }
  return full;
}

async function send() {
  const question = els.input.value.trim();
  if (!question || streaming) {
    return;
  }
  if (!selectedIds.size) {
    showToast(t("aiNeedSelection"));
    return;
  }

  if (resolveProvider(settings) === "openai") {
    if (!settings.baseUrl || !settings.apiKey) {
      showToast(t("aiStatusNotConfigured"));
      els.settingsPanel.open = true;
      return;
    }
    if (!(await ensureEndpointPermission())) {
      showToast(t("aiPermissionNeeded"));
      return;
    }
  }

  const selectedItems = items.filter((item) => selectedIds.has(item.id));
  setStreaming(true);

  const assistantEl = appendBubble("assistant", t("aiLoading"));
  let gotDelta = false;
  let streamedRaw = "";
  let renderPending = false;
  const renderStreamed = () => {
    renderPending = false;
    renderMarkdown(assistantEl, streamedRaw);
    scrollBottom();
  };

  try {
    if (settings.includeContent) {
      await prefetchSelectedContent(selectedItems);
    }

    let text = question;
    const contextKey = selectedItems.map((item) => item.url).join("\n");
    if (contextKey !== lastContextKey) {
      text = `${question}\n\n---\n${t("aiContextPrefix")}\n${buildContext(selectedItems)}`;
      lastContextKey = contextKey;
    }

    chat.push({ role: "user", content: text, display: question });
    appendBubble("user", question);
    els.input.value = "";
    updateComposer();

    const history = [
      { role: "system", content: systemPrompt() },
      ...chat.map(({ role, content }) => ({ role, content }))
    ];

    const full = await streamTurn(history, text, (delta) => {
      gotDelta = true;
      streamedRaw += delta;
      if (!renderPending) {
        renderPending = true;
        setTimeout(renderStreamed, 80);
      }
    });
    const reply = full.trim() || t("aiEmptyReply");
    chat.push({ role: "assistant", content: reply });
  } catch (err) {
    if (gotDelta) {
      chat.push({ role: "assistant", content: streamedRaw.trim() });
    }
    if (!stopRequested) {
      chat.push({ role: "error", content: t("aiErrorGeneric", (err && err.message) || String(err)) });
    }
  } finally {
    controller = null;
    setStreaming(false);
    renderChat();
    await saveCurrentChat();
    renderChatList();
  }
}

async function loadChats() {
  const result = await chrome.storage.local.get({ [AI_CHATS_KEY]: [] });
  conversations = Array.isArray(result[AI_CHATS_KEY])
    ? result[AI_CHATS_KEY].filter((c) => c && typeof c.id === "string" && Array.isArray(c.messages))
    : [];
}

async function saveCurrentChat() {
  if (!chat.length) {
    return;
  }
  const now = new Date().toISOString();
  if (!currentChatId) {
    currentChatId = crypto.randomUUID();
  }
  let entry = conversations.find((c) => c.id === currentChatId);
  if (!entry) {
    entry = { id: currentChatId, title: chatTitle(), createdAt: now, messages: [] };
    conversations.push(entry);
  }
  if (!entry.title) {
    entry.title = chatTitle();
  }
  entry.updatedAt = now;
  entry.messages = chat
    .map((message) => ({
      role: message.role,
      // 用户消息只存提问本身,不把网页正文上下文写进存储
      content: message.role === "user" ? (message.display || message.content) : message.content
    }))
    .slice(-AI_CHAT_MESSAGES_MAX);
  conversations.sort(byUpdatedDesc);
  if (conversations.length > AI_CHATS_MAX) {
    conversations.length = AI_CHATS_MAX;
  }
  try {
    await chrome.storage.local.set({ [AI_CHATS_KEY]: conversations });
  } catch {
    // 历史保存失败不影响对话本身
  }
}

function restoreChatIntoMemory() {
  const entry = conversations.find((c) => c.id === currentChatId);
  chat = entry
    ? entry.messages.map((message) => ({
        role: message.role,
        content: message.content,
        display: message.role === "user" ? message.content : undefined
      }))
    : [];
  lastContextKey = "";
}

async function switchChat(id) {
  await saveCurrentChat();
  currentChatId = id || null;
  restoreChatIntoMemory();
  renderChat();
  renderChatList();
  updateComposer();
}

async function newChat() {
  await saveCurrentChat();
  currentChatId = null;
  chat = [];
  lastContextKey = "";
  renderChat();
  renderChatList();
  updateComposer();
}

async function deleteChat() {
  if (!currentChatId) {
    return;
  }
  if (!confirm(t("confirmDeleteChat"))) {
    return;
  }
  conversations = conversations.filter((c) => c.id !== currentChatId);
  currentChatId = conversations.length ? [...conversations].sort(byUpdatedDesc)[0].id : null;
  restoreChatIntoMemory();
  try {
    await chrome.storage.local.set({ [AI_CHATS_KEY]: conversations });
  } catch {
    // ignore
  }
  renderChat();
  renderChatList();
  updateComposer();
  showToast(t("messageChatDeleted"));
}

function chatTitle() {
  const firstUser = chat.find((message) => message.role === "user");
  const text = (firstUser?.display || firstUser?.content || "").trim();
  if (!text) {
    return t("aiChatUntitled");
  }
  return text.length > 30 ? `${text.slice(0, 30)}…` : text;
}

function renderChatList() {
  const selected = currentChatId || "";
  els.chatSelect.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = t("aiChatPickerLabel");
  els.chatSelect.append(placeholder);
  for (const entry of [...conversations].sort(byUpdatedDesc)) {
    const option = document.createElement("option");
    option.value = entry.id;
    option.textContent = entry.title || t("aiChatUntitled");
    els.chatSelect.append(option);
  }
  els.chatSelect.value = selected;
  if (els.chatSelect.value !== selected) {
    els.chatSelect.value = "";
  }
  els.deleteChatButton.disabled = !currentChatId;
}

function setStreaming(value) {
  streaming = value;
  els.stopButton.hidden = !value;
  updateComposer();
}

function updateComposer() {
  els.sendButton.disabled = streaming || !selectedIds.size || !els.input.value.trim();
}

function renderItemList() {
  const keyword = els.search.value.trim().toLowerCase();
  const filtered = items.filter((item) => {
    if (item.status === "done") {
      return false;
    }
    return !keyword || `${item.title} ${item.url}`.toLowerCase().includes(keyword);
  });

  els.itemList.replaceChildren();
  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "list-empty";
    empty.textContent = items.length ? t("emptyNoMatches") : t("aiEmptyItems");
    els.itemList.append(empty);
  }

  for (const item of filtered) {
    const row = document.createElement("label");
    row.className = "list-item";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedIds.has(item.id);
    const text = document.createElement("span");
    text.className = "li-text";
    const title = document.createElement("span");
    title.className = "li-title";
    title.textContent = item.title || item.url;
    const host = document.createElement("span");
    host.className = "li-host";
    host.textContent = hostOf(item.url);
    text.append(title, host);
    row.append(checkbox, text);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        selectedIds.add(item.id);
      } else {
        selectedIds.delete(item.id);
      }
      updateSelectedCount();
      updateComposer();
      refreshPermissionBanner();
    });
    els.itemList.append(row);
  }

  updateSelectedCount();
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function updateSelectedCount() {
  els.selectedCount.textContent = t("aiSelectedCount", String(selectedIds.size));
}

function renderChat() {
  els.messages.replaceChildren();
  if (!chat.length) {
    const hint = document.createElement("div");
    hint.className = "msg hint";
    hint.textContent = t("aiChatEmpty");
    els.messages.append(hint);
    return;
  }
  for (const message of chat) {
    appendBubble(message.role, message.display || message.content);
  }
}

function appendBubble(role, text) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  if (role === "assistant") {
    renderMarkdown(div, text);
  } else {
    div.textContent = text;
  }
  els.messages.append(div);
  scrollBottom();
  return div;
}

const INLINE_MARKDOWN = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\n]+\*)|(~~[^~\n]+~~)|(!?\[[^\]\n]*\]\([^)\s]+\))/g;

function renderMarkdown(container, text) {
  container.replaceChildren();
  parseBlocks(String(text || "").split("\n"), container);
}

function parseBlocks(lines, target) {
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }

    if (/^\s*```/.test(line)) {
      const codeLines = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) {
        i += 1;
      }
      target.append(buildCodeBlock(codeLines.join("\n")));
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) {
      const h = document.createElement(`h${heading[1].length}`);
      h.append(renderInline(heading[2]));
      target.append(h);
      i += 1;
      continue;
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      target.append(document.createElement("hr"));
      i += 1;
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quoted = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        quoted.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      const blockquote = document.createElement("blockquote");
      parseBlocks(quoted, blockquote);
      target.append(blockquote);
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length &&
      /^\s*\|?\s*:?-{2,}[-: |]*\|?\s*$/.test(lines[i + 1])) {
      const header = lines[i];
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(lines[i]);
        i += 1;
      }
      target.append(buildTable(header, rows));
      continue;
    }

    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const { node, next } = buildList(lines, i);
      target.append(node);
      i = next;
      continue;
    }

    const paragraph = [];
    while (i < lines.length && lines[i].trim() &&
      !/^\s*```/.test(lines[i]) &&
      !/^#{1,6}\s+/.test(lines[i]) &&
      !/^\s*>/.test(lines[i]) &&
      !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
      paragraph.push(lines[i]);
      i += 1;
    }
    const p = document.createElement("p");
    paragraph.forEach((part, index) => {
      if (index) {
        p.append(document.createElement("br"));
      }
      p.append(renderInline(part));
    });
    target.append(p);
  }
}

function buildList(lines, start) {
  const ordered = /^\s*\d/.test(lines[start]);
  const listEl = document.createElement(ordered ? "ol" : "ul");
  const baseIndent = lines[start].match(/^\s*/)[0].length;
  let i = start;

  while (i < lines.length) {
    const match = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (!match) {
      break;
    }
    const indent = match[1].length;
    if (indent < baseIndent) {
      break;
    }
    if (indent > baseIndent) {
      const nested = buildList(lines, i);
      const lastItem = listEl.lastElementChild;
      if (lastItem) {
        lastItem.append(nested.node);
      }
      i = nested.next;
      continue;
    }
    const li = document.createElement("li");
    li.append(renderInline(match[3]));
    listEl.append(li);
    i += 1;
  }
  return { node: listEl, next: i };
}

function buildTable(headerLine, rows) {
  const cells = (row) => row
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((cell) => cell.trim());

  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const cell of cells(headerLine)) {
    const th = document.createElement("th");
    th.append(renderInline(cell));
    headRow.append(th);
  }
  thead.append(headRow);
  table.append(thead);

  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const cell of cells(row)) {
      const td = document.createElement("td");
      td.append(renderInline(cell));
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(tbody);
  return table;
}

function buildCodeBlock(codeText) {
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.textContent = codeText;
  pre.append(code);
  return pre;
}

function safeHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

function renderInline(text) {
  const fragment = document.createDocumentFragment();
  let last = 0;
  for (const match of String(text).matchAll(INLINE_MARKDOWN)) {
    if (match.index > last) {
      fragment.append(text.slice(last, match.index));
    }
    const [raw] = match;
    if (match[1]) {
      const code = document.createElement("code");
      code.textContent = raw.slice(1, -1);
      fragment.append(code);
    } else if (match[2] || match[3]) {
      const strong = document.createElement("strong");
      strong.append(renderInline(raw.slice(2, -2)));
      fragment.append(strong);
    } else if (match[4]) {
      const em = document.createElement("em");
      em.append(renderInline(raw.slice(1, -1)));
      fragment.append(em);
    } else if (match[5]) {
      const del = document.createElement("del");
      del.append(renderInline(raw.slice(2, -2)));
      fragment.append(del);
    } else if (match[6]) {
      const isImage = raw.startsWith("!");
      const label = raw.slice(isImage ? 2 : 1, raw.indexOf("]("));
      const url = raw.slice(raw.indexOf("](") + 2, -1);
      const safe = safeHttpUrl(url);
      if (safe) {
        const a = document.createElement("a");
        a.href = safe;
        a.target = "_blank";
        a.rel = "noreferrer noopener";
        a.append(renderInline(label || url));
        fragment.append(a);
      } else {
        fragment.append(raw);
      }
    }
    last = match.index + raw.length;
  }
  if (last < text.length) {
    fragment.append(text.slice(last));
  }
  return fragment;
}

function scrollBottom() {
  els.messages.scrollTop = els.messages.scrollHeight;
}

function buildContext(selectedItems) {
  let contentBudget = PAGE_CONTENT_MAX_ITEMS;
  const data = selectedItems.map((item) => {
    const entry = {
      title: item.title,
      url: item.url,
      description: item.description || "",
      note: item.note || "",
      tags: item.tags
    };
    if (settings.includeContent && contentBudget > 0) {
      const text = pageCache.get(item.url);
      if (text) {
        entry.content = text;
        contentBudget -= 1;
      }
    }
    return entry;
  });
  return `\`\`\`\n${JSON.stringify(data, null, 2)}\n\`\`\``;
}

function neededContentOrigins() {
  if (!settings.includeContent) {
    return [];
  }
  return Array.from(new Set(items
    .filter((item) => selectedIds.has(item.id) && !pageCache.has(item.url) && isSupportedWebUrl(item.url))
    .map((item) => `${new URL(item.url).origin}/*`)));
}

async function refreshPermissionBanner() {
  if (!settings.includeContent || !selectedIds.size) {
    els.permissionBanner.hidden = true;
    return;
  }
  const origins = neededContentOrigins();
  const missing = [];
  for (const origin of origins) {
    try {
      if (!(await chrome.permissions.contains({ origins: [origin] }))) {
        missing.push(origin);
      }
    } catch {
      missing.push(origin);
    }
  }
  els.permissionBanner.hidden = !missing.length;
  if (missing.length) {
    els.bannerText.textContent = t("aiPermissionBanner", String(missing.length));
  }
}

async function grantContentPermission() {
  const origins = neededContentOrigins();
  if (!origins.length) {
    await refreshPermissionBanner();
    return;
  }
  let granted = false;
  try {
    granted = await chrome.permissions.request({ origins });
  } catch {
    granted = false;
  }
  if (granted) {
    await prefetchSelectedContent(items.filter((item) => selectedIds.has(item.id)));
    showToast(t("aiContentLoaded"));
  }
  await refreshPermissionBanner();
}

async function prefetchSelectedContent(selectedItems) {
  const targets = selectedItems
    .filter((item) => settings.includeContent && isSupportedWebUrl(item.url) && !pageCache.has(item.url))
    .slice(0, PAGE_CONTENT_MAX_ITEMS);
  await Promise.all(targets.map(async (item) => {
    const text = await loadPageText(item.url);
    if (text) {
      pageCache.set(item.url, text);
    }
  }));
}

async function loadPageText(url) {
  let text = await fetchPageText(url);
  if (!text || text.length < PAGE_TEXT_MIN_LENGTH) {
    const tabText = await extractViaTab(url);
    if (tabText && tabText.length > text.length) {
      text = tabText;
    }
  }
  return text ? text.slice(0, PAGE_TEXT_LIMIT) : "";
}

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
    await waitForTabLoaded(tab.id, TAB_LOAD_TIMEOUT);
    await new Promise((resolve) => setTimeout(resolve, TAB_SETTLE_DELAY));
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

function waitForTabLoaded(tabId, timeoutMs) {
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

// Injected into the page via chrome.scripting; must stay self-contained.
function extractPageMainText() {
  document.querySelectorAll("script, style, noscript, svg, iframe, template, nav, footer, header, aside, form, button")
    .forEach((el) => el.remove());
  const main = document.querySelector("article, main, [role=\"main\"], #content, .content") || document.body || document.documentElement;
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

async function fetchPageText(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(PAGE_FETCH_TIMEOUT) });
    if (!response.ok) {
      return "";
    }
    const html = await response.text();
    return extractReadableText(html).slice(0, PAGE_TEXT_LIMIT);
  } catch {
    return "";
  }
}

function cleanExtractedText(text) {
  return (text || "")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function extractReadableText(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, noscript, svg, iframe, template, nav, footer, header, aside, form, button")
    .forEach((el) => el.remove());
  const main = doc.querySelector("article, main, [role=\"main\"], #content, .content") || doc.body || doc.documentElement;
  doc.querySelectorAll("br").forEach((el) => el.replaceWith("\n"));
  for (const tag of ["p", "div", "li", "tr", "section", "article", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "dd", "dt"]) {
    doc.querySelectorAll(tag).forEach((el) => el.append("\n"));
  }
  return cleanExtractedText(main.textContent || "");
}

function systemPrompt() {
  return t("aiSystemPrompt");
}

function showToast(text) {
  els.toast.textContent = text;
  els.toast.hidden = false;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    els.toast.hidden = true;
  }, 2600);
}
