import { Activity, Check, ChevronDown, ChevronRight, Download, RefreshCcw, Trash2, X } from "lucide-react";
import type { CSSProperties } from "react";
import type { BuildArtifactGroup, DownloadEvent } from "../types";
import { formatBytes, groupProgress, jobIdFromStatus, kindLabel, progressPercent, selectedArtifacts } from "../utils";

export function BuildGroup({ group, rows, expanded, onToggleExpanded, onToggleArtifact, onToggleAll, onDownload, onCancel, onRetry, onRemove, onProgress }: {
  group: BuildArtifactGroup; rows: Record<string, DownloadEvent>; expanded: boolean;
  onToggleExpanded: () => void; onToggleArtifact: (id: string) => void; onToggleAll: (selected: boolean) => void;
  onDownload: () => void; onCancel: () => void; onRetry: () => void; onRemove: () => void; onProgress: () => void;
}) {
  const artifacts = group.artifacts;
  const selected = selectedArtifacts(group);
  const statuses = selected.map((artifact) => rows[artifact.id]?.status);
  const active = statuses.some((status) => status === "queued" || status === "downloading" || status === "retrying");
  const failed = statuses.includes("failed");
  const hasRows = statuses.some(Boolean);
  const allSelected = artifacts.length > 0 && selected.length === artifacts.length;
  const visibleArtifacts = artifacts;
  return (
    <article className={`build-group ${group.error || failed ? "failed" : ""}`} style={{ "--card-progress": `${groupProgress(visibleArtifacts, rows)}%` } as CSSProperties}>
      <div className="group-header">
        <button className="ghost-icon" title={expanded ? "Collapse build" : "Expand build"} onClick={onToggleExpanded}>{expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</button>
        <div className="group-title"><strong>{group.buildId || group.input}</strong><span>{group.error || `${selected.length}/${artifacts.length} selected${group.version ? ` - ${group.version}` : ""}`}</span></div>
        <div className="group-actions">
          {!active && artifacts.length > 0 && <button className={`secondary-button compact selection-toggle ${allSelected ? "selected" : ""}`} aria-pressed={allSelected} onClick={() => onToggleAll(!allSelected)}><Check size={15} />{allSelected ? "Deselect all" : "Select all"}</button>}
          {hasRows && <button className="icon-button" title="Open progress" onClick={onProgress}><Activity size={16} /></button>}
          {failed && <button className="icon-button" title="Retry download" onClick={onRetry}><RefreshCcw size={16} /></button>}
          {active && <button className="icon-button danger" title="Cancel download" onClick={onCancel}><X size={16} /></button>}
          {!active && !failed && <button className="primary-button icon-only" title="Download selected artifacts" disabled={Boolean(group.error) || selected.length === 0} onClick={onDownload}><Download size={16} /></button>}
          <button className="icon-button" title="Delete build" onClick={onRemove}><Trash2 size={16} /></button>
        </div>
      </div>
      {expanded && visibleArtifacts.length > 0 && <div className="artifact-table">{visibleArtifacts.map((artifact) => { const row = rows[artifact.id]; return <div className={`artifact-row ${active ? "active-artifact" : ""}`} key={artifact.id}>{!active && <button className={`check-button ${artifact.selected ? "checked" : ""}`} title={artifact.selected ? "Selected" : "Not selected"} onClick={() => onToggleArtifact(artifact.id)}>{artifact.selected && <Check size={14} />}</button>}<div className="artifact-name"><strong>{artifact.name}</strong><span>{kindLabel(artifact.kind)}</span></div><div className="progress-cell"><div className="progress-bar"><div style={{ width: `${progressPercent(row?.downloaded, row?.total)}%` }} /></div><span title={row?.message}>{row?.message || (row ? `${formatBytes(row.downloaded)} / ${formatBytes(row.total)}` : "Ready")}</span></div><span className={`pill ${row?.status || "ready"}`}>{row?.status || "ready"}</span></div>; })}</div>}
    </article>
  );
}
