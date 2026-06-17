(function () {
  const SOURCE = "raonk-workflow-spy";
  const MAX_VALUE_LENGTH = 1200;
  const SENSITIVE_KEYS = /authorization|cookie|token|password|passwd|secret|access[_-]?key|session/i;
  const RAON_KEYS = /raonk|kupload|kdownload|setdownload|download|endpoint|handler|cache_key|range|content-range|x-raon|guid_resume/i;
  const WRAPPED_NAMES = /raonk|kupload|kdownload|download/i;
  const RESPONSE_CAPTURE = /raonk|kupload|download|endpoint|handler|cache_key|method=file_end|srBinary/i;
  const wrappedFunctions = new Set();
  const rawPostMessage = window.postMessage.bind(window);

  function emit(kind, detail) {
    rawPostMessage({
      source: SOURCE,
      event: {
        at: new Date().toISOString(),
        location: location.href,
        kind,
        detail: sanitize(detail),
      },
    }, "*");
  }

  function sanitize(value, depth = 0, key = "") {
    if (SENSITIVE_KEYS.test(key)) return "<redacted>";
    if (depth > 3) return "<max-depth>";
    if (value == null || typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "string") {
      return value.length > MAX_VALUE_LENGTH ? `${value.slice(0, MAX_VALUE_LENGTH)}...<truncated>` : value;
    }
    if (value instanceof FormData) {
      const entries = {};
      for (const [formKey, formValue] of value.entries()) {
        entries[formKey] = formValue instanceof File
          ? { fileName: formValue.name, size: formValue.size, type: formValue.type }
          : sanitize(String(formValue), depth + 1, formKey);
      }
      return { type: "FormData", entries };
    }
    if (value instanceof URLSearchParams) {
      return Object.fromEntries([...value.entries()].map(([paramKey, paramValue]) => [paramKey, sanitize(paramValue, depth + 1, paramKey)]));
    }
    if (Array.isArray(value)) return value.slice(0, 40).map((item) => sanitize(item, depth + 1, key));
    if (typeof value === "object") {
      const out = {};
      for (const objectKey of Object.keys(value).slice(0, 50)) {
        try {
          out[objectKey] = sanitize(value[objectKey], depth + 1, objectKey);
        } catch {
          out[objectKey] = "<unreadable>";
        }
      }
      return out;
    }
    if (typeof value === "function") return `<function ${value.name || "anonymous"}>`;
    return String(value);
  }

  function toText(value) {
    try {
      if (typeof value === "string") return value;
      if (value instanceof URLSearchParams) return value.toString();
      if (value instanceof FormData) return JSON.stringify(sanitize(value));
      if (value && typeof value === "object") return JSON.stringify(sanitize(value));
      return String(value);
    } catch {
      return "";
    }
  }

  function maybeEmit(kind, detail) {
    const haystack = toText(detail);
    if (RAON_KEYS.test(haystack)) emit(kind, detail);
  }

  function shouldCaptureUrl(url) {
    return RESPONSE_CAPTURE.test(String(url || ""));
  }

  function summarizeBody(body) {
    if (body == null) return undefined;
    if (typeof body === "string") return sanitize(body);
    if (body instanceof URLSearchParams) return sanitize(body);
    if (body instanceof FormData) return sanitize(body);
    if (body instanceof Blob) return { type: "Blob", size: body.size, mime: body.type };
    if (body instanceof ArrayBuffer) return { type: "ArrayBuffer", byteLength: body.byteLength };
    if (ArrayBuffer.isView(body)) return { type: body.constructor.name, byteLength: body.byteLength };
    return `<${body.constructor?.name || typeof body}>`;
  }

  function summarizeResponse(url, text) {
    if (typeof text !== "string") return text;
    const summary = { preview: sanitize(text) };
    if (/raonkupload\.config\.txt/i.test(String(url || ""))) {
      const withoutLicense = text.replace(/<license>[\s\S]*?<\/license>/i, "<license><redacted></license>");
      const hints = [];
      for (const line of withoutLicense.split(/\r?\n/)) {
        if (/url|handler|download|upload|cache|path|method|agent|folder|server/i.test(line)) {
          hints.push(line.trim());
        }
      }
      summary.preview = sanitize(withoutLicense);
      summary.hints = hints.slice(0, 80);
    }
    return summary;
  }

  function wrapFunction(owner, name, kind) {
    const original = owner && owner[name];
    if (typeof original !== "function" || original.__raonkSpyWrapped) return;
    const wrapKey = `${kind || "call"}:${name}`;
    if (wrappedFunctions.has(wrapKey)) return;
    function wrapped(...args) {
      const callKind = kind || `call:${name}`;
      maybeEmit(callKind, { name, args });
      let result;
      if (new.target) {
        result = Reflect.construct(original, args, new.target);
      } else {
        result = original.apply(this, args);
      }
      maybeEmit(`${callKind}:return`, { name, result });
      return result;
    }
    wrapped.__raonkSpyWrapped = true;
    wrappedFunctions.add(wrapKey);
    owner[name] = wrapped;
  }

  function wrapRaonkWindowFunctions() {
    for (const name of Object.getOwnPropertyNames(window)) {
      if (!WRAPPED_NAMES.test(name)) continue;
      try {
        if (typeof window[name] === "function") wrapFunction(window, name, "raonk-window-call");
      } catch {
        // Some host objects throw on access; skip them.
      }
    }
  }

  function snapshotInputs() {
    const fields = [];
    const selectedFiles = [];
    const inputs = Array.from(document.querySelectorAll("input,select,textarea"));
    for (let index = 0; index < inputs.length; index += 1) {
      const element = inputs[index];
      const name = element.getAttribute("name") || element.id || element.getAttribute("data-name") || "";
      const type = element.getAttribute("type") || element.tagName.toLowerCase();
      const checked = "checked" in element ? element.checked : undefined;
      const selected = type === "checkbox" || type === "radio" ? checked : undefined;
      if (selected && name === "selectFile") {
        const group = { checkboxClass: element.className, checkboxId: element.id };
        for (let lookahead = index + 1; lookahead < Math.min(inputs.length, index + 8); lookahead += 1) {
          const sibling = inputs[lookahead];
          const siblingName = sibling.getAttribute("name") || sibling.id || "";
          if (siblingName === "selectFileMeta") {
            const [stamp, fileName, fileType, serverPath, size] = String(sibling.value || "").split("*");
            Object.assign(group, { stamp, fileName, fileType, serverPath, size });
          } else if (siblingName === "selectFileBinaryId") {
            group.binaryId = sibling.value;
          } else if (siblingName === "selectFileId") {
            group.fileId = sibling.value;
            break;
          }
        }
        selectedFiles.push(group);
      }
      const include = selected || /releaseInfoVo\.|approvalId|raonkFlag/i.test(name);
      if (!include || fields.length >= 50) continue;
      fields.push({
        tag: element.tagName,
        type,
        name,
        id: element.id,
        className: element.className,
        checked,
        value: sanitize(element.value, 0, name),
      });
    }
    return { fields, selectedFiles };
  }

  function snapshotRaonkGlobals() {
    const globals = {};
    for (const name of [
      "raonkUploadFileInfo",
      "raonkServerDataPath",
      "raonkFc",
    ]) {
      try {
        if (name in window) globals[name] = sanitize(window[name]);
      } catch {
        globals[name] = "<unreadable>";
      }
    }
    try {
      if (window.RAONKUPLOAD) {
        globals.RAONKUPLOAD = {
          rootPath: window.RAONKUPLOAD.rootPath,
          version: window.RAONKUPLOAD.version,
          UrlStamp: window.RAONKUPLOAD.UrlStamp,
          runtime: window.RAONKUPLOAD.Runtimes || window.RAONKUPLOAD.runtimes,
        };
      }
    } catch {
      globals.RAONKUPLOAD = "<unreadable>";
    }
    try {
      if (window.RAONKSolution?.Agent) {
        globals.RAONKSolutionAgent = {
          connectedPort: window.RAONKSolution.Agent.connectedPort,
          managerFinalUrl: window.RAONKSolution.Agent.managerFinalUrl,
          isLoaded: window.RAONKSolution.Agent.isLoaded,
        };
      }
    } catch {
      globals.RAONKSolutionAgent = "<unreadable>";
    }
    return globals;
  }

  wrapFunction(window, "RaonKSetDownload", "raonk-call");
  wrapFunction(window, "RaonKSetUpload", "raonk-call");

  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = function (...args) {
      const url = args[0] instanceof Request ? args[0].url : args[0];
      maybeEmit("fetch", {
        url,
        method: args[1]?.method || (args[0] instanceof Request ? args[0].method : "GET"),
        headers: args[1]?.headers || (args[0] instanceof Request ? Object.fromEntries(args[0].headers.entries()) : undefined),
        body: summarizeBody(args[1]?.body),
      });
      return originalFetch.apply(this, args).then((response) => {
        if (shouldCaptureUrl(url)) {
          const contentType = response.headers?.get?.("content-type") || "";
          if (/json|text|javascript|xml|html/i.test(contentType)) {
            response.clone().text().then((text) => {
              emit("fetch-response", {
                url,
                status: response.status,
                contentType,
                body: summarizeResponse(url, text),
              });
            }).catch(() => {});
          }
        }
        return response;
      });
    };
  }

  const OriginalXHR = window.XMLHttpRequest;
  if (OriginalXHR) {
    const originalOpen = OriginalXHR.prototype.open;
    const originalSetHeader = OriginalXHR.prototype.setRequestHeader;
    const originalSend = OriginalXHR.prototype.send;
    OriginalXHR.prototype.open = function (method, url, ...rest) {
      this.__raonkSpy = { method, url, headers: {} };
      return originalOpen.call(this, method, url, ...rest);
    };
    OriginalXHR.prototype.setRequestHeader = function (name, value) {
      if (this.__raonkSpy) this.__raonkSpy.headers[name] = value;
      return originalSetHeader.call(this, name, value);
    };
    OriginalXHR.prototype.send = function (body) {
      maybeEmit("xhr", { ...(this.__raonkSpy || {}), body: summarizeBody(body) });
      if (this.__raonkSpy && shouldCaptureUrl(this.__raonkSpy.url)) {
        this.addEventListener("loadend", () => {
          let responseText;
          try {
            responseText = typeof this.responseText === "string" ? this.responseText : undefined;
          } catch {
            responseText = "<unreadable>";
          }
          emit("xhr-response", {
            method: this.__raonkSpy.method,
            url: this.__raonkSpy.url,
            status: this.status,
            responseURL: this.responseURL,
            responseType: this.responseType,
            response: summarizeResponse(this.__raonkSpy.url, responseText),
          });
        }, { once: true });
      }
      return originalSend.call(this, body);
    };
  }

  const OriginalWebSocket = window.WebSocket;
  if (OriginalWebSocket) {
    window.WebSocket = function (url, protocols) {
      maybeEmit("websocket-open", { url, protocols });
      const socket = protocols ? new OriginalWebSocket(url, protocols) : new OriginalWebSocket(url);
      const originalSend = socket.send;
      socket.send = function (data) {
        maybeEmit("websocket-send", { url, data: sanitize(String(data)) });
        return originalSend.call(this, data);
      };
      return socket;
    };
    window.WebSocket.prototype = OriginalWebSocket.prototype;
  }

  const originalPostMessage = window.postMessage;
  window.postMessage = function (message, targetOrigin, transfer) {
    if (message?.source !== SOURCE) maybeEmit("postMessage", { message, targetOrigin });
    return originalPostMessage.call(this, message, targetOrigin, transfer);
  };

  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    maybeEmit("form-submit", {
      action: form.action,
      method: form.method,
      fields: new FormData(form),
    });
  }, true);

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("button,input,a,[onclick]") : null;
    if (!target) return;
    const text = target.textContent || target.getAttribute("value") || target.getAttribute("title") || "";
    const html = target.outerHTML || "";
    if (/download|raonk|kupload|다운|다운로드/i.test(`${text} ${html}`)) {
      emit("download-click", {
        tag: target.tagName,
        text,
        href: target.getAttribute("href"),
        id: target.id,
        className: target.className,
        outerHTML: html.slice(0, 1500),
      });
      const inputSnapshot = snapshotInputs();
      emit("download-state-snapshot", {
        fields: inputSnapshot.fields,
        selectedFiles: inputSnapshot.selectedFiles,
        raonkGlobals: snapshotRaonkGlobals(),
      });
      wrapRaonkWindowFunctions();
    }
  }, true);

  function emitWindowSymbols() {
    const symbols = [];
    for (const name of Object.getOwnPropertyNames(window)) {
      if (/raonk|kupload|kdownload/i.test(name)) {
        let value;
        try {
          value = window[name];
        } catch {
          value = undefined;
        }
        symbols.push({ name, type: typeof value });
      }
    }
    if (symbols.length) emit("window-symbols", { symbols });
  }

  setTimeout(() => {
    wrapRaonkWindowFunctions();
    emitWindowSymbols();
  }, 3000);

  setTimeout(wrapRaonkWindowFunctions, 6000);

  emit("spy-ready", { userAgent: navigator.userAgent });
})();
