const MAX_EVENTS = 800;
const FLUSH_MS = 1500;
const SENSITIVE_HEADER = /authorization|cookie|token|password|secret|access/i;
const INTERESTING = /raonk|kupload|download|endpoint|handler|cache_key|method=file_end|x-raon|range|quickbuild|qb|ads5|android/i;

let events = [];
let recording = true;
let loaded = false;
let flushTimer = null;

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.set({ events: [], recording: true });
});

chrome.runtime.onStartup.addListener(() => {
  void ensureLoaded();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void (async () => {
    await ensureLoaded();
    if (message?.type === "page-event") {
      appendEvent({
        ...message.event,
        tabId: sender.tab?.id,
        tabUrl: sender.tab?.url,
        frameId: sender.frameId,
      });
      sendResponse({ ok: true });
    } else if (message?.type === "get-events") {
      const limit = Number(message.limit) || events.length;
      sendResponse({ events: events.slice(-limit), total: events.length, recording });
    } else if (message?.type === "clear-events") {
      events = [];
      await flushEvents();
      sendResponse({ ok: true });
    } else if (message?.type === "set-recording") {
      recording = Boolean(message.recording);
      await chrome.storage.local.set({ recording });
      sendResponse({ ok: true, recording });
    } else {
      sendResponse({ ok: false });
    }
  })();
  return true;
});

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (!recording) return;
    if (!INTERESTING.test(details.url) && !hasInterestingHeader(details.requestHeaders || [])) return;
    appendEvent({
      at: new Date().toISOString(),
      kind: "request-headers",
      tabId: details.tabId,
      frameId: details.frameId,
      method: details.method,
      url: details.url,
      requestId: details.requestId,
      headers: sanitizeHeaders(details.requestHeaders || []),
    });
  },
  { urls: ["<all_urls>"] },
  ["requestHeaders", "extraHeaders"],
);

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (!recording) return;
    if (!INTERESTING.test(details.url) && !hasInterestingHeader(details.responseHeaders || [])) return;
    appendEvent({
      at: new Date().toISOString(),
      kind: "response-headers",
      tabId: details.tabId,
      frameId: details.frameId,
      method: details.method,
      url: details.url,
      requestId: details.requestId,
      statusCode: details.statusCode,
      statusLine: details.statusLine,
      headers: sanitizeHeaders(details.responseHeaders || []),
    });
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders", "extraHeaders"],
);

async function ensureLoaded() {
  if (loaded) return;
  const stored = await chrome.storage.local.get({ events: [], recording: true });
  events = Array.isArray(stored.events) ? stored.events.slice(-MAX_EVENTS) : [];
  recording = stored.recording !== false;
  loaded = true;
}

function appendEvent(event) {
  if (!recording) return;
  events.push(trimEvent(event));
  events = events.slice(-MAX_EVENTS);
  scheduleFlush();
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushEvents();
  }, FLUSH_MS);
}

async function flushEvents() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await chrome.storage.local.set({ events, recording });
}

function trimEvent(event) {
  const json = JSON.stringify(event);
  if (json.length <= 12000) return event;
  return {
    at: event.at,
    kind: event.kind,
    url: event.url,
    location: event.location,
    tabUrl: event.tabUrl,
    detail: {
      truncated: true,
      preview: json.slice(0, 8000),
    },
  };
}

function hasInterestingHeader(headers) {
  return headers.some((header) => INTERESTING.test(`${header.name}:${header.value || ""}`));
}

function sanitizeHeaders(headers) {
  return headers.map((header) => ({
    name: header.name,
    value: SENSITIVE_HEADER.test(header.name) ? "<redacted>" : header.value,
  }));
}
