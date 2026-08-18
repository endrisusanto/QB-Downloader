import { Check, ChevronDown, ChevronRight, Download, Filter, Pause, Play, RefreshCcw, Trash2, X } from "lucide-react";
import type { CSSProperties } from "react";
import type { Artifact, BuildArtifactGroup, DownloadEvent } from "../types";
import { formatBytes, groupProgress, progressState, selectedArtifacts, visibleArtifacts as getVisibleArtifacts } from "../utils";
import { ProgressBar } from "./ProgressBar";

import { memo } from "react";

const ArtifactName = memo(function ArtifactName({ name }: { name: string }) {
  return (
    <div className="artifact-name">
      <strong>{name}</strong>
    </div>
  );
});

const NO_ARTIFACTS_NOTICE = "Artifacts tidak ada. Mungkin QB ID sudah expired.";

export function BuildGroup({ group, rows, expanded, filters, readonlyCheckboxes, onToggleExpanded, onToggleArtifact, onToggleAll, onDownload, onCancel, onRetry, onRemove, onConfigureFilters, onDownloadArtifact, onPauseArtifact, onRemoveArtifact }: {
  group: BuildArtifactGroup; rows: Record<string, DownloadEvent>; expanded: boolean;
  filters: string[];
  readonlyCheckboxes?: boolean;
  onToggleExpanded: () => void; onToggleArtifact: (id: string) => void; onToggleAll: (selected: boolean) => void;
  onDownload: () => void; onCancel: () => void; onRetry: () => void; onRemove: () => void;
  onConfigureFilters?: () => void;
  onDownloadArtifact?: (artifact: Artifact) => void;
  onPauseArtifact?: (artifact: Artifact) => void;
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
  const hasPartial = artifacts.some((artifact) => (rows[artifact.id]?.downloaded || 0) > 0 && rows[artifact.id]?.status !== "completed");
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
        <button className="icon-button compact-icon" title={expanded ? "Collapse" : "Expand"} onClick={onToggleExpanded}>{expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</button>
        <div className="group-meta">
          <div className="group-title-row">
            <strong>{group.input}</strong>
          </div>
          <span>{subtitle}</span>
        </div>
        <div className="group-actions">
          {hasFailed && !active && <button className="icon-button danger-icon" title="Retry failed downloads" onClick={onRetry}><RefreshCcw size={16} /></button>}
          {active && <button className="icon-button warning-icon" title="Pause download" onClick={onCancel}><Pause size={16} /></button>}
          {onConfigureFilters && !active && !readonlyCheckboxes && (
            <button className="icon-button compact-icon" title="Configure artifact filters for this build" onClick={onConfigureFilters}>
              <Filter size={15} />
            </button>
          )}
          {!watching && !active && !failed && !hasCompleted && (
            <button
              className="primary-button icon-only"
              title={hasPartial ? "Resume download" : "Download selected artifacts"}
              disabled={Boolean(group.error) || selected.length === 0}
              onClick={onDownload}
            >
              {hasPartial ? <Play size={16} /> : <Download size={16} />}
            </button>
          )}
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
            const isDownloading = rowStatus === "downloading" || rowStatus === "retrying" || rowStatus === "queued";
            const isCompleted = rowStatus === "completed";
            const progress = progressState(row);
            // ponytail: apply active-artifact (4-column grid) whenever checkbox is not shown to prevent column offset bug
            const showCheckbox = !isCompleted && rowStatus !== "failed" && !readonlyCheckboxes;
            const isPartial = (row?.downloaded || 0) > 0 && !isCompleted;
            return (
              <div className={`artifact-row ${!showCheckbox ? "active-artifact" : ""}`} key={artifact.id}>
                {showCheckbox && (
                  <button
                    className={`check-button ${artifact.selected ? "checked" : ""}`}
                    title={artifact.selected ? "Selected" : "Not selected"}
                    onClick={() => onToggleArtifact(artifact.id)}
                  >
                    {artifact.selected && <Check size={16} strokeWidth={3} />}
                  </button>
                )}
                <ArtifactName name={artifact.name} />
                <div className="progress-cell">
                  <ProgressBar progress={progress} />
                  <span title={row?.message}>
                    {row?.message || (row ? `${progress.mode === "indeterminate" ? "Downloading" : `${progress.percent}%`} · ${formatBytes(row.downloaded)} / ${formatBytes(row.total)}` : (artifact.size ? `Ready · ${formatBytes(artifact.size)}` : "Ready"))}
                  </span>
                </div>
                <div className="artifact-action">
                  {isDownloading ? (
                    onPauseArtifact && (
                      <button
                        className="icon-button compact-icon warning-icon"
                        title="Pause downloading this artifact"
                        onClick={() => onPauseArtifact(artifact)}
                      >
                        <Pause size={14} />
                      </button>
                    )
                  ) : !isCompleted && onDownloadArtifact ? (
                    <button
                      className="icon-button compact-icon"
                      title={isPartial ? "Resume downloading this artifact" : "Download this artifact"}
                      onClick={() => onDownloadArtifact(artifact)}
                    >
                      {isPartial ? <Play size={14} /> : <Download size={14} />}
                    </button>
                  ) : null}
                </div>
                <div className="artifact-status">
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
