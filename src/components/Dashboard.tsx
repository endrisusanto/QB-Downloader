import { FolderOpen } from "lucide-react";
import { formatSpeed } from "../utils";

export function Dashboard({ builds, selected, active, completed, failed, totalSpeed, folder }: {
  builds: number; selected: number; active: number; completed: number; failed: number; totalSpeed: number; folder: string;
}) {
  return (
    <section className="dashboard-strip">
      <div className="metric-card builds"><span>Builds</span><strong>{builds}</strong><small>{selected} selected</small></div>
      <div className="metric-card active"><span>Active</span><strong>{active}</strong><small>{formatSpeed(totalSpeed)}</small></div>
      <div className="metric-card done"><span>Completed</span><strong>{completed}</strong><small>{failed} failed</small></div>
      <div className="metric-card storage"><span>Total speed</span><strong>{formatSpeed(totalSpeed)}</strong><small title={folder || "No folder selected"}><FolderOpen size={14} />{folder || "Set download folder"}</small></div>
    </section>
  );
}
