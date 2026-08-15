import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useCallback, useEffect, useRef, useState } from "react";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "installing"
  | "up-to-date"
  | "error";

export type UpdateInfo = {
  version: string;
  currentVersion: string;
  body?: string;
  date?: string;
};

export function useUpdater(autoCheck: boolean = true) {
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const updateRef = useRef<Update | null>(null);
  const checkedOnMount = useRef(false);

  const checkForUpdates = useCallback(async (silent: boolean = false) => {
    try {
      if (!silent) setStatus("checking");
      setError(null);

      const update = await check();
      if (update?.available) {
        updateRef.current = update;
        setUpdateInfo({
          version: update.version,
          currentVersion: update.currentVersion,
          body: update.body,
          date: update.date,
        });
        setStatus("available");
      } else {
        updateRef.current = null;
        setUpdateInfo(null);
        if (!silent) setStatus("up-to-date");
      }
    } catch (err) {
      console.warn("Auto-update check failed:", err);
      updateRef.current = null;
      if (!silent) {
        setStatus("error");
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  }, []);

  const installUpdate = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;

    try {
      setStatus("downloading");
      setProgress(0);
      setError(null);

      let downloaded = 0;
      let contentLength = 0;

      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          contentLength = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (contentLength > 0) {
            setProgress(Math.min(100, Math.round((downloaded / contentLength) * 100)));
          }
        } else if (event.event === "Finished") {
          setStatus("installing");
        }
      });

      // Relaunch the newly installed version seamlessly
      await relaunch();
    } catch (err) {
      console.error("Failed to download/install update:", err);
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const dismiss = useCallback(() => {
    setStatus("idle");
  }, []);

  useEffect(() => {
    if (autoCheck && !checkedOnMount.current) {
      checkedOnMount.current = true;
      // Background non-blocking check after app startup
      const timer = window.setTimeout(() => {
        void checkForUpdates(true);
      }, 3_000);
      return () => window.clearTimeout(timer);
    }
  }, [autoCheck, checkForUpdates]);

  return {
    status,
    updateInfo,
    progress,
    error,
    checkForUpdates,
    installUpdate,
    dismiss,
  };
}
