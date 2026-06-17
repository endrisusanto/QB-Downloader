const count = document.querySelector("#count");
const list = document.querySelector("#events");
const toggleRecording = document.querySelector("#toggle-recording");
let recording = true;

document.querySelector("#refresh").addEventListener("click", render);
toggleRecording.addEventListener("click", async () => {
  recording = !recording;
  await chrome.runtime.sendMessage({ type: "set-recording", recording });
  await render();
});
document.querySelector("#clear").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "clear-events" });
  await render();
});
document.querySelector("#export").addEventListener("click", async () => {
  const { events } = await chrome.runtime.sendMessage({ type: "get-events" });
  const blob = new Blob([JSON.stringify(events, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `raonk-workflow-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

async function render() {
  const result = await chrome.runtime.sendMessage({ type: "get-events", limit: 30 });
  recording = result.recording !== false;
  toggleRecording.textContent = recording ? "Pause" : "Resume";
  count.textContent = `${result.total} event${result.total === 1 ? "" : "s"}`;
  list.replaceChildren(...result.events.slice().reverse().map(renderEvent));
}

function renderEvent(event) {
  const node = document.createElement("div");
  node.className = "event";

  const title = document.createElement("strong");
  title.textContent = event.kind || "event";

  const meta = document.createElement("small");
  meta.textContent = compactMeta(event);

  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "Details";
  const pre = document.createElement("pre");
  details.addEventListener("toggle", () => {
    if (details.open && !pre.textContent) {
      pre.textContent = JSON.stringify(event.detail || compactNetworkEvent(event), null, 2);
    }
  }, { once: true });
  details.append(summary, pre);

  node.append(title, meta, details);
  return node;
}

function compactMeta(event) {
  const url = event.url || event.location || event.tabUrl || "";
  const shortUrl = url.length > 130 ? `${url.slice(0, 130)}...` : url;
  const status = event.statusCode ? ` ${event.statusCode}` : "";
  const method = event.method ? ` ${event.method}` : "";
  return `${event.at || ""}${method}${status} ${shortUrl}`;
}

function compactNetworkEvent(event) {
  return {
    method: event.method,
    statusCode: event.statusCode,
    requestId: event.requestId,
    headers: event.headers,
  };
}

void render();
