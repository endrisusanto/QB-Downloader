// ponytail: zero-disk high-speed bandwidth consumer with atomic telemetry
use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc,
};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::sync::broadcast;

const ENDPOINTS: &[&str] = &[
    "https://speed.cloudflare.com/__down?bytes=50000000",
    "https://speedtest.tele2.net/100MB.zip",
    "https://proof.ovh.net/files/100Mb.dat",
    "https://ash-speed.hetzner.com/100MB.bin",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataWasterStatus {
    pub active: bool,
    pub total_bytes: u64,
    pub speed_bps: f64,
}

#[derive(Clone)]
pub struct DataWasterManager {
    active: Arc<AtomicBool>,
    total_bytes: Arc<AtomicU64>,
    cancel_tx: Arc<tokio::sync::Mutex<Option<broadcast::Sender<()>>>>,
}

impl Default for DataWasterManager {
    fn default() -> Self {
        Self {
            active: Arc::new(AtomicBool::new(false)),
            total_bytes: Arc::new(AtomicU64::new(0)),
            cancel_tx: Arc::new(tokio::sync::Mutex::new(None)),
        }
    }
}

impl DataWasterManager {
    pub async fn start(&self, app: AppHandle, concurrency: usize, target_bytes: Option<u64>, server_url: Option<String>) {
        if self.active.swap(true, Ordering::SeqCst) {
            return; // already running
        }

        let (tx, _rx) = broadcast::channel(1);
        {
            let mut lock = self.cancel_tx.lock().await;
            *lock = Some(tx.clone());
        }

        let active = self.active.clone();
        let total_bytes = self.total_bytes.clone();
        let slots = concurrency.clamp(1, 32);

        let mut endpoints: Vec<String> = Vec::new();
        if let Some(ref s_url) = server_url {
            let trimmed = s_url.trim().trim_end_matches('/');
            if !trimmed.is_empty() {
                endpoints.push(format!("{}/api/waste/stream?bytes=50000000", trimmed));
            }
        }
        for ep in ENDPOINTS {
            endpoints.push((*ep).to_string());
        }
        let endpoints: Arc<Vec<String>> = Arc::new(endpoints);

        let http = Client::builder()
            .timeout(Duration::from_secs(20))
            .connect_timeout(Duration::from_secs(6))
            .pool_max_idle_per_host(slots)
            .danger_accept_invalid_certs(true)
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .build()
            .unwrap_or_default();

        // Speed tracker task
        let tracker_active = active.clone();
        let tracker_total = total_bytes.clone();
        let tracker_app = app.clone();
        let mut tracker_rx = tx.subscribe();

        tokio::spawn(async move {
            let mut last_bytes = tracker_total.load(Ordering::Relaxed);
            let mut last_time = Instant::now();

            loop {
                tokio::select! {
                    _ = tokio::time::sleep(Duration::from_millis(500)) => {
                        let current_bytes = tracker_total.load(Ordering::Relaxed);
                        let now = Instant::now();
                        let elapsed = now.duration_since(last_time).as_secs_f64();
                        let speed_bps = if elapsed > 0.0 {
                            (current_bytes.saturating_sub(last_bytes)) as f64 / elapsed
                        } else {
                            0.0
                        };

                        last_bytes = current_bytes;
                        last_time = now;

                        let status = DataWasterStatus {
                            active: tracker_active.load(Ordering::Relaxed),
                            total_bytes: current_bytes,
                            speed_bps,
                        };

                        let _ = tracker_app.emit("waste://status", &status);

                        if !tracker_active.load(Ordering::Relaxed) {
                            break;
                        }
                    }
                    _ = tracker_rx.recv() => {
                        let status = DataWasterStatus {
                            active: false,
                            total_bytes: tracker_total.load(Ordering::Relaxed),
                            speed_bps: 0.0,
                        };
                        let _ = tracker_app.emit("waste://status", &status);
                        break;
                    }
                }
            }
        });

        // Worker tasks
        for worker_id in 0..slots {
            let http = http.clone();
            let active = active.clone();
            let total_bytes = total_bytes.clone();
            let endpoints = endpoints.clone();
            let mut cancel_rx = tx.subscribe();

            tokio::spawn(async move {
                let endpoint_count = endpoints.len();
                let mut idx = worker_id % endpoint_count;

                while active.load(Ordering::Relaxed) {
                    if let Some(target) = target_bytes {
                        if total_bytes.load(Ordering::Relaxed) >= target {
                            active.store(false, Ordering::SeqCst);
                            break;
                        }
                    }

                    let url = &endpoints[idx % endpoint_count];
                    idx += 1;

                    tokio::select! {
                        _ = cancel_rx.recv() => break,
                        res = http.get(url).send() => {
                            if let Ok(response) = res {
                                if response.status().is_success() {
                                    let mut stream = response.bytes_stream();
                                    loop {
                                        tokio::select! {
                                            _ = cancel_rx.recv() => {
                                                return;
                                            }
                                            chunk = stream.next() => {
                                                match chunk {
                                                    Some(Ok(bytes)) => {
                                                        total_bytes.fetch_add(bytes.len() as u64, Ordering::Relaxed);
                                                        if let Some(target) = target_bytes {
                                                            if total_bytes.load(Ordering::Relaxed) >= target {
                                                                active.store(false, Ordering::SeqCst);
                                                                return;
                                                            }
                                                        }
                                                        if !active.load(Ordering::Relaxed) {
                                                            return;
                                                        }
                                                    }
                                                    _ => break,
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
            });
        }
    }

    pub async fn stop(&self) {
        if self.active.swap(false, Ordering::SeqCst) {
            let mut lock = self.cancel_tx.lock().await;
            if let Some(tx) = lock.take() {
                let _ = tx.send(());
            }
        }
    }

    pub fn get_status(&self) -> DataWasterStatus {
        DataWasterStatus {
            active: self.active.load(Ordering::Relaxed),
            total_bytes: self.total_bytes.load(Ordering::Relaxed),
            speed_bps: 0.0,
        }
    }
}
