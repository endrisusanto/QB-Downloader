import { FolderOpen } from "lucide-react";
import { formatBytes, formatSpeed } from "../utils";

export function Dashboard({ builds, selected, active, completed, failed, totalSpeed, averageThreadSpeed, folder, totalBytes, downloadedBytes, etaStr }: {
  builds: number; selected: number; active: number; completed: number; failed: number; totalSpeed: number; averageThreadSpeed: number; folder: string; totalBytes: number; downloadedBytes: number; etaStr: string | null;
}) {
  return (
    <section className="dashboard-strip">
      <div className="metric-card builds"><span>Builds</span><strong>{builds}</strong><small>{selected} selected</small></div>
      <div className="metric-card active">
        <span>Active</span>
        <strong>{active}</strong>
        <small>{formatSpeed(averageThreadSpeed)} avg/thread</small>
      </div>
      <div className="metric-card done"><span>Completed</span><strong>{completed}</strong><small>{failed} failed</small></div>
      <div className="metric-card progress-eta">
        <span>Total Progress</span>
        <strong>{totalBytes > 0 ? `${Math.round(downloadedBytes * 100 / totalBytes)}%` : "0%"}</strong>
        <small>{totalBytes > 0 ? `${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}${etaStr ? ` (ETA: ${etaStr})` : ""}` : "No active downloads"}</small>
      </div>
      <div className="metric-card storage">
        <span>Total speed</span>
        <strong>{formatSpeed(totalSpeed)}</strong>
        <small title={folder || "No folder selected"}><FolderOpen size={14} />{folder || "Set download folder"}</small>
      </div>
    </section>
  );
}
