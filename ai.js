const AI_SETTINGS_KEY = "laterbox.ai.v1";
const DEFAULT_AI_SETTINGS = { provider: "auto", baseUrl: "", apiKey: "", model: "" };

const els = {
  search: document.querySelector("#aiSearch"),
  selectedCount: document.querySelector("#selectedCount"),
  itemList: document.querySelector("#itemList"),
  providerStatus: document.querySelector("#providerStatus"),
  messages: document.querySelector("#messages"),
  input: document.querySelector("#aiInput"),
  sendButton: document.querySelector("#sendButton"),
  stopButton: document.querySelector("#stopButton"),
  providerSelect: document.querySelector("#providerSelect"),
  modelInput: document.querySelector("#modelInput"),
  baseUrlInput: document.querySelector("#baseUrlInput"),
  apiKeyInput: document.querySelector("#apiKeyInput"),
  saveSettingsButton: document.querySelector("#saveSettingsButton"),
  toast: document.querySelector("#aiToast")
};

let items = [];
let settings = { ...DEFAULT_AI_SETTINGS };
let chat = [];
let selectedIds = new Set();
let lastContextKey = "";
let streaming = false;
let stopRequested = false;
let controller = null;
let builtinSession = null;

init();

async function init() {
  localizeDocument();
  document.title = `${t("extensionName")} · ${t("aiPageTitle")}`;
  await loadSettings();
  await loadItems();
  bindEvents();
  renderItemList();
  renderChat();
  updateComposer();
  await updateStatus();
}

function bindEvents() {
  els.search.addEventListener("input", renderItemList);
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
    model: els.modelInput.value.trim()
  };
  await chrome.storage.local.set({ [AI_SETTINGS_KEY]: settings });
  builtinSession = null;

  if (resolveProvider(settings) === "openai" && baseUrl) {
    await ensureEndpointPermission();
  }
  await updateStatus();
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
  let text = question;
  const contextKey = selectedItems.map((item) => item.url).join("\n");
  if (contextKey !== lastContextKey) {
    text = `${question}\n\n---\n${t("aiContextPrefix")}\n${buildContext(selectedItems)}`;
    lastContextKey = contextKey;
  }

  chat.push({ role: "user", content: text, display: question });
  renderChat();
  els.input.value = "";
  setStreaming(true);

  const assistantEl = appendBubble("assistant", "");
  const history = [
    { role: "system", content: systemPrompt() },
    ...chat.map(({ role, content }) => ({ role, content }))
  ];

  try {
    const full = await streamTurn(history, text, (delta) => {
      assistantEl.textContent += delta;
      scrollBottom();
    });
    const reply = full.trim() || t("aiEmptyReply");
    assistantEl.textContent = reply;
    chat.push({ role: "assistant", content: reply });
  } catch (err) {
    const partial = assistantEl.textContent.trim();
    if (partial) {
      chat.push({ role: "assistant", content: partial });
    }
    if (!stopRequested) {
      chat.push({ role: "error", content: t("aiErrorGeneric", (err && err.message) || String(err)) });
    }
  } finally {
    controller = null;
    setStreaming(false);
    renderChat();
  }
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
  div.textContent = text;
  els.messages.append(div);
  scrollBottom();
  return div;
}

function scrollBottom() {
  els.messages.scrollTop = els.messages.scrollHeight;
}

function buildContext(selectedItems) {
  const data = selectedItems.map((item) => ({
    title: item.title,
    url: item.url,
    description: item.description || "",
    note: item.note || "",
    tags: item.tags
  }));
  return `\`\`\`\n${JSON.stringify(data, null, 2)}\n\`\`\``;
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
