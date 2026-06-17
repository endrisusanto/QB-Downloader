(function () {
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("inject.js");
  script.onload = () => script.remove();
  (document.documentElement || document.head || document).appendChild(script);

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== "raonk-workflow-spy") return;
    chrome.runtime.sendMessage({ type: "page-event", event: event.data.event });
  });
})();
