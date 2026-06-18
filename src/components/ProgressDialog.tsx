import { X, Info, Zap, Flag, ChevronUp, ChevronDown, Ban, LogOut } from "lucide-react";
import { useState } from "react";
import type { BuildArtifactGroup, DownloadEvent } from "../types";
import { formatBytes, formatSpeed, groupProgress, progressState, selectedArtifacts, statusLabel } from "../utils";
import { ProgressBar } from "./ProgressBar";
import { DIALOG_CHANNEL } from "../constants";

type Props = {
  group: BuildArtifactGroup;
  rows: Record<string, DownloadEvent>;
  slotSpeeds: Record<string, number>;
  onClose: () => void;
  onCancel?: () => void;
  embedded?: boolean;
};

function formatTimeLeft(seconds: number) {
  if (!isFinite(seconds) || seconds <= 0) return "Estimating...";
  if (seconds > 3600) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h} hr ${m} min left`;
  }
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m} min ${s} sec left`;
}

export function ProgressDialog({
  group,
  rows,
  slotSpeeds,
  onClose,
  onCancel,
  embedded = false,
}: Props) {
  const [activeTab, setActiveTab] = useState<"info" | "speed" | "completion">("info");
  const [expanded, setExpanded] = useState(true);

  const artifacts = selectedArtifacts(group);
  const overall = groupProgress(artifacts, rows);

  // Computations
  const displayName = artifacts[0]?.name || group.buildId || group.input;
  const isCompleted = overall.mode === "completed";

  const statuses = artifacts.map((art) => rows[art.id]?.status);
  const isDownloading = statuses.some((s) => s === "downloading" || s === "retrying");
  const isQueued = statuses.some((s) => s === "queued");

  const statusText = isCompleted
    ? "Completed"
    : isDownloading
    ? "Downloading"
    : isQueued
    ? "Queued"
    : "Idle";

  const totalSize = artifacts.reduce(
    (sum, art) => sum + (art.size || rows[art.id]?.total || 0),
    0
  );
  const totalDownloaded = artifacts.reduce(
    (sum, art) => sum + (rows[art.id]?.downloaded || 0),
    0
  );
  const overallSpeed = artifacts.reduce((sum, art) => sum + (slotSpeeds[art.id] || 0), 0);
  const remainingBytes = Math.max(0, totalSize - totalDownloaded);
  const timeLeftSeconds = overallSpeed > 0 ? remainingBytes / overallSpeed : 0;
  const resumable = artifacts.some((art) => rows[art.id]?.resumable) ? "Yes" : "No";

  const handleCancel = () => {
    if (onCancel) {
      onCancel();
    } else {
      const channel = new BroadcastChannel(DIALOG_CHANNEL);
      channel.postMessage({ type: "cancel", groupId: group.id });
      channel.close();
    }
    onClose();
  };

  const content = (
    <div className="modal progress-modal compact-progress-modal screenshot-style">
      {/* Tab bar */}
      <div className="dialog-tabs">
        <button
          className={`tab-btn ${activeTab === "info" ? "active" : ""}`}
          onClick={() => setActiveTab("info")}
        >
          <Info size={16} />
          <span>Info</span>
        </button>
        <button
          className={`tab-btn ${activeTab === "speed" ? "active" : ""}`}
          onClick={() => setActiveTab("speed")}
        >
          <Zap size={16} />
          <span>Speed</span>
        </button>
        <button
          className={`tab-btn ${activeTab === "completion" ? "active" : ""}`}
          onClick={() => setActiveTab("completion")}
        >
          <Flag size={16} />
          <span>On Completion</span>
        </button>
        <button className="dialog-header-close" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      {/* Tab Contents */}
      <div className="tab-viewport">
        {activeTab === "info" && (
          <table className="info-grid-table">
            <tbody>
              <tr>
                <td>Name:</td>
                <td title={displayName}>{displayName}</td>
              </tr>
              <tr>
                <td>Status:</td>
                <td>{statusText}</td>
              </tr>
              <tr>
                <td>Size:</td>
                <td>{formatBytes(totalSize)}</td>
              </tr>
              <tr>
                <td>Downloaded:</td>
                <td>
                  {formatBytes(totalDownloaded)} ({overall.percent}%)
                </td>
              </tr>
              <tr>
                <td>Speed:</td>
                <td>{formatSpeed(overallSpeed)}</td>
              </tr>
              <tr>
                <td>Time Left:</td>
                <td>{isCompleted ? "Done" : formatTimeLeft(timeLeftSeconds)}</td>
              </tr>
              <tr>
                <td>Resume Support:</td>
                <td className={`resume-support-${resumable.toLowerCase()}`}>{resumable}</td>
              </tr>
            </tbody>
          </table>
        )}

        {activeTab === "speed" && (
          <div className="speed-tab-pane">
            {artifacts.map((art) => {
              const speed = slotSpeeds[art.id] || 0;
              const row = rows[art.id];
              const progress = progressState(row);
              return (
                <div className="speed-tab-row" key={art.id}>
                  <div className="speed-row-meta">
                    <span className="speed-row-name" title={art.name}>
                      {art.name}
                    </span>
                    <span className="speed-row-val">{formatSpeed(speed)}</span>
                  </div>
                  <ProgressBar progress={progress} />
                </div>
              );
            })}
            {artifacts.length === 0 && <div className="tab-pane-empty">No active downloads.</div>}
          </div>
        )}

        {activeTab === "completion" && (
          <div className="completion-tab-pane">
            <label className="completion-checkbox-label">
              <input type="checkbox" defaultChecked />
              <span>Show Dialog Notification on Complete</span>
            </label>
            <label className="completion-checkbox-label">
              <input type="checkbox" defaultChecked />
              <span>Open folder when download finishes</span>
            </label>
            <label className="completion-checkbox-label">
              <input type="checkbox" />
              <span>Exit application when all downloads finish</span>
            </label>
          </div>
        )}
      </div>

      {/* Progress Bar Container */}
      <div className="dialog-progress-bar-container">
        <ProgressBar progress={overall} large />
      </div>

      {/* Controls row */}
      <div className="dialog-controls-row">
        <button
          className="controls-expand-btn"
          onClick={() => setExpanded(!expanded)}
          title={expanded ? "Collapse details" : "Expand details"}
        >
          {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>

        <div className="controls-right-btns">
          {!isCompleted && (
            <button className="primary-action-btn cancel-btn" onClick={handleCancel}>
              <Ban size={15} />
              <span>Cancel</span>
            </button>
          )}
          <button className="secondary-action-btn close-btn" onClick={onClose}>
            <LogOut size={15} />
            <span>Close</span>
          </button>
        </div>
      </div>

      {/* Expanded Table */}
      {expanded && (
        <div className="dialog-detail-table-wrapper">
          <table className="dialog-detail-table">
            <thead>
              <tr>
                <th style={{ width: "38px" }}>#</th>
                <th>Status</th>
                <th>Downloaded</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {artifacts.map((artifact, index) => {
                const row = rows[artifact.id];
                return (
                  <tr key={artifact.id}>
                    <td>{index + 1}</td>
                    <td className="detail-status-cell">
                      <div className="detail-filename" title={artifact.name}>
                        {artifact.name}
                      </div>
                      <div className="detail-status-label">{statusLabel(row)}</div>
                    </td>
                    <td>{formatBytes(row?.downloaded || 0)}</td>
                    <td>{formatBytes(row?.total || artifact.size || 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  return embedded ? content : <div className="modal-backdrop">{content}</div>;
}
