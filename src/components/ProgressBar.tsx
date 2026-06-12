import type { ProgressState } from "../types";

export function ProgressBar({ progress, large = false }: { progress: ProgressState; large?: boolean }) {
  return (
    <div
      className={`progress-bar ${large ? "large" : ""} ${progress.mode}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={progress.mode === "indeterminate" ? undefined : progress.percent}
    >
      <div
        style={
          progress.mode === "indeterminate"
            ? undefined
            : { width: `${progress.percent}%`, minWidth: progress.percent > 0 ? 3 : 0 }
        }
      />
    </div>
  );
}
