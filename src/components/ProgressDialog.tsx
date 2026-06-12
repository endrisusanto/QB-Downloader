import { X } from "lucide-react";
import type { BuildArtifactGroup, DownloadEvent } from "../types";
import { formatBytes, groupProgress, progressPercent, selectedArtifacts } from "../utils";

export function ProgressDialog({ group, rows, onClose, embedded = false }: {
  group: BuildArtifactGroup; rows: Record<string, DownloadEvent>; onClose: () => void; embedded?: boolean;
}) {
  const artifacts = selectedArtifacts(group);
  const percent = groupProgress(artifacts, rows);
  const content = (
    <div className="modal progress-modal">
      <div className="modal-header"><div><h2>{group.buildId || group.input}</h2><span>{percent}% overall</span></div><button className="ghost-icon" title="Close" onClick={onClose}><X size={18} /></button></div>
      <div className="progress-overview"><div className="progress-bar large"><div style={{ width: `${percent}%` }} /></div><div className="thread-slot-grid">{artifacts.map((artifact, index) => { const row = rows[artifact.id]; return <div className={`thread-slot ${row?.status || "queued"}`} key={artifact.id}><strong>Thread {index + 1}</strong><span>{row?.status || "queued"}</span><small title={artifact.name}>{artifact.name}</small><em>{row?.status === "retrying" ? `Attempt ${row.attempt + 1}/${row.maxAttempts} in ${Math.ceil((row.nextRetryMs || 0) / 1000)}s` : row ? `${formatBytes(row.downloaded)} / ${formatBytes(row.total)}` : "Waiting"}</em></div>; })}</div></div>
      <div className="progress-file-list">{artifacts.map((artifact) => { const row = rows[artifact.id]; return <div className="progress-file" key={artifact.id}><div><strong>{artifact.name}</strong><span title={row?.message}>{row?.message || `${row?.status || "ready"} - ${formatBytes(row?.downloaded)} / ${formatBytes(row?.total)}`}</span></div><div className="progress-bar"><div style={{ width: `${progressPercent(row?.downloaded, row?.total)}%` }} /></div></div>; })}</div>
    </div>
  );
  return embedded ? content : <div className="modal-backdrop">{content}</div>;
}
