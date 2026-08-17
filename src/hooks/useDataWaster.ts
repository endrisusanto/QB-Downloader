import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";

export type DataWasterStatus = {
  active: boolean;
  totalBytes: number;
  speedBps: number;
};

export function useDataWaster() {
  const [status, setStatus] = useState<DataWasterStatus>({
    active: false,
    totalBytes: 0,
    speedBps: 0,
  });

  useEffect(() => {
    void invoke<DataWasterStatus>("get_data_waster_status")
      .then((res) => setStatus(res))
      .catch(() => {});

    const unlisten = listen<DataWasterStatus>("waste://status", (event) => {
      setStatus(event.payload);
    });

    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  const start = useCallback(async (concurrency: number = 8, targetBytes?: number) => {
    try {
      await invoke("start_data_waster", { concurrency, targetBytes });
      setStatus((s) => ({ ...s, active: true }));
    } catch (err) {
      console.error("Failed to start data waster:", err);
    }
  }, []);

  const stop = useCallback(async () => {
    try {
      await invoke("stop_data_waster");
      setStatus((s) => ({ ...s, active: false, speedBps: 0 }));
    } catch (err) {
      console.error("Failed to stop data waster:", err);
    }
  }, []);

  return {
    ...status,
    start,
    stop,
  };
}
