import { Activity, Check, ChevronDown, ChevronRight, Download, Filter, RefreshCcw, Trash2, X } from "lucide-react";
import type { CSSProperties } from "react";
import type { Artifact, BuildArtifactGroup, DownloadEvent } from "../types";
import { formatBytes, groupProgress, kindLabel, progressState, selectedArtifacts, statusLabel, visibleArtifacts as getVisibleArtifacts } from "../utils";
import { ProgressBar } from "./ProgressBar";

import { memo } from "react";

const ArtifactName = memo(function ArtifactName({ name, kindLabelText }: { name: string; kindLabelText: string }) {
  return (
    <div className="artifact-name">
      <strong>{name}</strong>
      <span>{kindLabelText}</span>
    </div>
  );
});

const NO_ARTIFACTS_NOTICE = "Artifacts tidak ada. Mungkin QB ID sudah expired.";

export function BuildGroup({ group, rows, expanded, filters, onToggleExpanded, onToggleArtifact, onToggleAll, onDownload, onCancel, onRetry, onRemove, onProgress, onConfigureFilters, onDownloadArtifact, onRemoveArtifact }: {
  group: BuildArtifactGroup; rows: Record<string, DownloadEvent>; expanded: boolean;
  filters: string[];
  onToggleExpanded: () => void; onToggleArtifact: (id: string) => void; onToggleAll: (selected: boolean) => void;
  onDownload: () => void; onCancel: () => void; onRetry: () => void; onRemove: () => void; onProgress: () => void;
  onConfigureFilters?: () => void;
  onDownloadArtifact?: (artifact: Artifact) => void;
  onRemoveArtifact?: (artifactId: string) => void;
}) {
  const artifacts = group.artifacts;
  const selected = selectedArtifacts(group);
  const statuses = artifacts.map((artifact) => rows[artifact.id]?.status);
  const watching = group.status === "watching";
  const active = statuses.some((status) => status === "downloading" || status === "retrying");
  const failed = statuses.includes("failed");
  const hasCompleted = statuses.includes("completed");
  const hasFailed = statuses.includes("failed");
  const hasRows = statuses.some(Boolean);
  const allSelected = artifacts.length > 0 && selected.length === artifacts.length;
  const visibleArtifacts = getVisibleArtifacts(group, filters, rows);
  const noArtifacts = !watching && artifacts.length === 0;
  const cardProgress = groupProgress(artifacts, rows);
  const nextCheck = group.nextCheckAt ? new Date(group.nextCheckAt).toLocaleTimeString() : "";
  const totalSelectedSize = selected.reduce((sum, art) => sum + (art.size || 0), 0);
  const subtitle = watching
    ? `Build is running. Waiting for artifacts${nextCheck ? ` - next check ${nextCheck}` : ""}.`
    : group.error || `${selected.length}/${artifacts.length} selected${totalSelectedSize > 0 ? ` (${formatBytes(totalSelectedSize)})` : ""}${group.version ? ` - ${group.version}` : ""}`;
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
      {expanded && (visibleArtifacts.length > 0 || noArtifacts) && (
        <div className="artifact-table">
          {noArtifacts && (
            <div className="artifact-row artifact-empty">
              <div className="artifact-name">
                <strong>{NO_ARTIFACTS_NOTICE}</strong>
                <span>Fetch berhasil, tapi QuickBuild tidak mengembalikan artifact.</span>
              </div>
            </div>
          )}
          {visibleArtifacts.map((artifact) => {
            const row = rows[artifact.id];
            const rowStatus = row?.status;
            const isDownloading = rowStatus === "downloading" || rowStatus === "retrying";
            const isCompleted = rowStatus === "completed";
            const progress = progressState(row);
            return (
              <div className={`artifact-row ${isCompleted || rowStatus === "failed" ? "active-artifact" : ""}`} key={artifact.id}>
                {(!isCompleted && rowStatus !== "failed") && (
                  <button
                    className={`check-button ${artifact.selected ? "checked" : ""}`}
                    title={artifact.selected ? "Selected" : "Not selected"}
                    onClick={() => onToggleArtifact(artifact.id)}
                  >
                    {artifact.selected && <Check size={16} strokeWidth={3} />}
                  </button>
                )}
                <ArtifactName name={artifact.name} kindLabelText={kindLabel(artifact.kind)} />
                <div className="progress-cell">
                  <ProgressBar progress={progress} />
                  <span title={row?.message}>
                    {row?.message || (row ? `${progress.mode === "indeterminate" ? "Downloading" : `${progress.percent}%`} · ${formatBytes(row.downloaded)} / ${formatBytes(row.total)}` : (artifact.size ? `Ready · ${formatBytes(artifact.size)}` : "Ready"))}
                  </span>
                </div>
                <div className="artifact-status">
                  <span className={`pill ${row?.status || "ready"}`}>
                    {statusLabel(row)}
                  </span>
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
                </div>
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}
