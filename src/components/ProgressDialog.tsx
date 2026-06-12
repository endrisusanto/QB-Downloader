import { X } from "lucide-react";
import type { BuildArtifactGroup, DownloadEvent } from "../types";
import { formatBytes, formatSpeed, groupProgress, progressState, selectedArtifacts } from "../utils";
import { ProgressBar } from "./ProgressBar";

export function ProgressDialog({ group, rows, slotSpeeds, onClose, embedded = false }: {
  group: BuildArtifactGroup;
  rows: Record<string, DownloadEvent>;
  slotSpeeds: Record<string, number>;
  onClose: () => void;
  embedded?: boolean;
}) {
  const artifacts = selectedArtifacts(group);
  const overall = groupProgress(artifacts, rows);
  const overallLabel = overall.mode === "indeterminate" ? "Downloading" : `${overall.percent}% overall`;
  const content = (
    <div className="modal progress-modal compact-progress-modal">
      <div className="modal-header">
        <div><h2>{group.buildId || group.input}</h2><span>{overallLabel}</span></div>
        <button className="ghost-icon" title="Close" onClick={onClose}><X size={18} /></button>
      </div>
      <ProgressBar progress={overall} large />
      <div className="compact-thread-list">
        {artifacts.map((artifact, index) => {
          const row = rows[artifact.id];
          const progress = progressState(row);
          const detail = row?.status === "retrying"
            ? `Attempt ${Math.min(row.attempt + 1, row.maxAttempts)}/${row.maxAttempts} in ${Math.ceil((row.nextRetryMs || 0) / 1000)}s`
            : `${formatBytes(row?.downloaded)} / ${formatBytes(row?.total)}`;
          return (
            <div className={`compact-thread-row ${row?.status || "queued"}`} key={artifact.id}>
              <div className="thread-index">{index + 1}</div>
              <div className="thread-file">
                <strong title={artifact.name}>{artifact.name}</strong>
                <span>{detail}</span>
              </div>
              <span className={`pill ${row?.status || "queued"}`}>{row?.status || "queued"}</span>
              <div className="thread-speed"><strong>{formatSpeed(slotSpeeds[artifact.id] || 0)}</strong><span>avg 5s</span></div>
              <div className="thread-progress"><ProgressBar progress={progress} /><span>{progress.mode === "indeterminate" ? "Streaming" : `${progress.percent}%`}</span></div>
            </div>
          );
        })}
      </div>
    </div>
  );
  return embedded ? content : <div className="modal-backdrop">{content}</div>;
}
