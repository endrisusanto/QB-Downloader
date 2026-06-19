import { Activity, Check, ChevronDown, ChevronRight, Download, Filter, RefreshCcw, Trash2, X } from "lucide-react";
import type { CSSProperties } from "react";
import type { Artifact, BuildArtifactGroup, DownloadEvent } from "../types";
import { formatBytes, groupProgress, kindLabel, progressState, selectedArtifacts, statusLabel, visibleArtifacts as getVisibleArtifacts } from "../utils";
import { ProgressBar } from "./ProgressBar";

export function BuildGroup({ group, rows, expanded, hideUncheckedArtifacts, onToggleExpanded, onToggleArtifact, onToggleAll, onDownload, onCancel, onRetry, onRemove, onProgress, onConfigureFilters, onDownloadArtifact, onRemoveArtifact }: {
  group: BuildArtifactGroup; rows: Record<string, DownloadEvent>; expanded: boolean;
  hideUncheckedArtifacts: boolean;
  onToggleExpanded: () => void; onToggleArtifact: (id: string) => void; onToggleAll: (selected: boolean) => void;
  onDownload: () => void; onCancel: () => void; onRetry: () => void; onRemove: () => void; onProgress: () => void;
  onConfigureFilters?: () => void;
  onDownloadArtifact?: (artifact: Artifact) => void;
  onRemoveArtifact?: (artifactId: string) => void;
}) {
  const artifacts = group.artifacts;
  const selected = selectedArtifacts(group);
  const statuses = selected.map((artifact) => rows[artifact.id]?.status);
  const watching = group.status === "watching";
  const active = statuses.some((status) => status === "queued" || status === "downloading" || status === "retrying");
  const failed = statuses.includes("failed");
  const hasCompleted = statuses.includes("completed");
  const hasFailed = statuses.includes("failed");
  const hasRows = statuses.some(Boolean);
  const allSelected = artifacts.length > 0 && selected.length === artifacts.length;
  const visibleArtifacts = getVisibleArtifacts(group, hideUncheckedArtifacts);
  const cardProgress = groupProgress(selected, rows);
  const nextCheck = group.nextCheckAt ? new Date(group.nextCheckAt).toLocaleTimeString() : "";
  const subtitle = watching
    ? `Build is running. Waiting for artifacts${nextCheck ? ` - next check ${nextCheck}` : ""}.`
    : group.error || `${selected.length}/${artifacts.length} selected${group.version ? ` - ${group.version}` : ""}`;
  return (
    <article className={`build-group progress-${cardProgress.mode} ${watching ? "watching" : ""} ${group.error || failed ? "failed" : ""}`} style={{ "--card-progress": `${cardProgress.percent}%` } as CSSProperties}>
      <div className="group-header">
        <button className="ghost-icon" title={expanded ? "Collapse build" : "Expand build"} onClick={onToggleExpanded}>{expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</button>
        <div className="group-title"><strong>{group.buildId || group.input}</strong><span>{subtitle}</span></div>
        <div className="group-actions">
          {watching && (
            <>
              <span className="watching-status"><span className="spinner" />Waiting</span>
              {onConfigureFilters && (
                <button className="icon-button" title="Configure auto-download filters" onClick={onConfigureFilters}>
                  <Filter size={16} />
                </button>
              )}
            </>
          )}
          {!watching && !active && !hasCompleted && !hasFailed && artifacts.length > 0 && <button className={`secondary-button compact selection-toggle ${allSelected ? "selected" : ""}`} aria-pressed={allSelected} onClick={() => onToggleAll(!allSelected)}><Check size={15} />{allSelected ? "Deselect all" : "Select all"}</button>}
          {hasRows && <button className="icon-button" title="Open progress" onClick={onProgress}><Activity size={16} /></button>}
          {failed && <button className="icon-button" title="Retry download" onClick={onRetry}><RefreshCcw size={16} /></button>}
          {active && <button className="icon-button danger" title="Cancel download" onClick={onCancel}><X size={16} /></button>}
          {!watching && !active && !failed && <button className="primary-button icon-only" title="Download selected artifacts" disabled={Boolean(group.error) || selected.length === 0} onClick={onDownload}><Download size={16} /></button>}
          <button className="icon-button" title="Delete build" onClick={onRemove}><Trash2 size={16} /></button>
        </div>
      </div>
      {expanded && visibleArtifacts.length > 0 && (
        <div className="artifact-table">
          {visibleArtifacts.map((artifact) => {
            const row = rows[artifact.id];
            const rowStatus = row?.status;
            const isDownloading = rowStatus === "queued" || rowStatus === "downloading" || rowStatus === "retrying";
            const isCompleted = rowStatus === "completed";
            return (
              <div className={`artifact-row ${active || isCompleted || rowStatus === "failed" ? "active-artifact" : ""}`} key={artifact.id}>
                {!active && !isCompleted && rowStatus !== "failed" && (
                  <button
                    className={`check-button ${artifact.selected ? "checked" : ""}`}
                    title={artifact.selected ? "Selected" : "Not selected"}
                    onClick={() => onToggleArtifact(artifact.id)}
                  >
                    {artifact.selected && <Check size={16} strokeWidth={3} />}
                  </button>
                )}
                <div className="artifact-name">
                  <strong>{artifact.name}</strong>
                  <span>{kindLabel(artifact.kind)}</span>
                </div>
                <div className="progress-cell">
                  <ProgressBar progress={progressState(row)} />
                  <span title={row?.message}>
                    {row?.message || (row ? `${formatBytes(row.downloaded)} / ${formatBytes(row.total)}` : "Ready")}
                  </span>
                </div>
                <span className={`pill ${row?.status || "ready"}`}>
                  {statusLabel(row)}
                </span>
                <div className="artifact-action">
                  {!isDownloading && !isCompleted && onDownloadArtifact && (
                    <button
                      className="icon-button compact-icon"
                      title="Download this artifact"
                      onClick={() => onDownloadArtifact(artifact)}
                    >
                      <Download size={14} />
                    </button>
                  )}
                  {onRemoveArtifact && (
                    <button
                      className="icon-button compact-icon danger-icon"
                      title="Delete this artifact"
                      onClick={() => onRemoveArtifact(artifact.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}
