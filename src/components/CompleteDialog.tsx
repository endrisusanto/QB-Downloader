import { CheckCircle2, FolderOpen } from "lucide-react";
import type { BuildArtifactGroup, DownloadEvent } from "../types";
import { selectedArtifacts } from "../utils";

export function CompleteDialog({ group, rows, onClose, onOpenFolder, embedded = false }: {
  group: BuildArtifactGroup; rows: Record<string, DownloadEvent>; onClose: () => void; onOpenFolder: () => void; embedded?: boolean;
}) {
  const count = selectedArtifacts(group).filter((artifact) => rows[artifact.id]?.status === "completed").length;
  const content = <div className="modal complete-modal"><CheckCircle2 size={42} /><h2>Download complete</h2><p>{group.buildId || group.input} completed with {count} file{count === 1 ? "" : "s"}.</p><div className="modal-actions"><button className="secondary-button" onClick={onOpenFolder}><FolderOpen size={16} />Open folder</button><button className="primary-button" onClick={onClose}>Done</button></div></div>;
  return embedded ? content : <div className="modal-backdrop">{content}</div>;
}
