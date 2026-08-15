import { Download, RefreshCw, Sparkles, X } from "lucide-react";
import type { UpdateInfo, UpdateStatus } from "../hooks/useUpdater";

export function UpdateModal({
  status,
  updateInfo,
  progress,
  error,
  onInstall,
  onClose,
}: {
  status: UpdateStatus;
  updateInfo: UpdateInfo | null;
  progress: number;
  error: string | null;
  onInstall: () => Promise<void>;
  onClose: () => void;
}) {
  if (status === "idle" || status === "up-to-date") return null;

  const isDownloading = status === "downloading" || status === "installing";

  return (
    <div className="modal-backdrop">
      <div className="modal update-modal" style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <div>
            <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Sparkles size={20} color="#38bdf8" />
              {isDownloading ? "Updating Application..." : "Update Available"}
            </h2>
            <span>
              {updateInfo
                ? `Version ${updateInfo.version} is ready to install`
                : "Checking for updates..."}
            </span>
          </div>
          {!isDownloading && (
            <button className="ghost-icon" title="Close" onClick={onClose}>
              <X size={18} />
            </button>
          )}
        </div>

        {error && (
          <div className="settings-error" style={{ marginBottom: 12 }}>
            {error}
          </div>
        )}

        {updateInfo?.body && (
          <div
            style={{
              maxHeight: 140,
              overflowY: "auto",
              padding: "8px 12px",
              background: "rgba(0,0,0,0.15)",
              borderRadius: 6,
              fontSize: "0.85rem",
              lineHeight: 1.4,
              whiteSpace: "pre-wrap",
              marginBottom: 16,
              border: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            {updateInfo.body}
          </div>
        )}

        {isDownloading && (
          <div style={{ margin: "16px 0" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: "0.85rem",
                marginBottom: 6,
              }}
            >
              <span>{status === "installing" ? "Restarting application..." : "Downloading update..."}</span>
              <strong>{progress}%</strong>
            </div>
            <div
              style={{
                width: "100%",
                height: 8,
                background: "rgba(255,255,255,0.1)",
                borderRadius: 4,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${progress}%`,
                  height: "100%",
                  background: "linear-gradient(90deg, #38bdf8, #3b82f6)",
                  transition: "width 0.2s ease",
                }}
              />
            </div>
          </div>
        )}

        <div className="modal-actions" style={{ marginTop: 16, display: "flex", justifyContent: "flex-end", gap: 8 }}>
          {!isDownloading && (
            <>
              <button className="secondary-button" onClick={onClose}>
                Later
              </button>
              <button
                className="primary-button"
                onClick={() => void onInstall()}
                style={{ display: "flex", alignItems: "center", gap: 6 }}
              >
                <Download size={16} />
                Update & Relaunch
              </button>
            </>
          )}
          {isDownloading && (
            <button className="primary-button" disabled style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <RefreshCw size={16} className="spin" />
              {status === "installing" ? "Installing..." : `Downloading (${progress}%)`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
