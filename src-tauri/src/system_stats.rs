use std::{net::UdpSocket, path::Path};
use sysinfo::{Disks, System};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemStats {
    pub cpu_usage: f32,
    pub ram_total: u64,
    pub ram_used: u64,
    pub disk_total: u64,
    pub disk_available: u64,
}

pub fn get_stats(target_dir: &str) -> SystemStats {
    let mut sys = System::new_all();
    sys.refresh_cpu();
    // Brief sleep to get a non-zero CPU delta
    std::thread::sleep(std::time::Duration::from_millis(100));
    sys.refresh_cpu();

    let cpu_usage = sys.global_cpu_info().cpu_usage();
    let ram_total = sys.total_memory();
    let ram_used = sys.used_memory();

    let disks = Disks::new_with_refreshed_list();
    let target_path = Path::new(target_dir);

    let mut best_match: Option<&sysinfo::Disk> = None;
    let mut best_match_len = 0;

    for disk in &disks {
        let mount_point = disk.mount_point();
        if target_path.starts_with(mount_point) {
            let len = mount_point.as_os_str().len();
            if len > best_match_len {
                best_match_len = len;
                best_match = Some(disk);
            }
        }
    }

    let (disk_total, disk_available) = if let Some(disk) = best_match {
        (disk.total_space(), disk.available_space())
    } else if let Some(disk) = disks.first() {
        (disk.total_space(), disk.available_space())
    } else {
        (0, 0)
    };

    SystemStats {
        cpu_usage,
        ram_total,
        ram_used,
        disk_total,
        disk_available,
    }
}

pub fn local_ipv4() -> Option<String> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("1.1.1.1:80").ok()?;
    let ip = socket.local_addr().ok()?.ip();
    ip.is_ipv4().then_some(ip.to_string())
}
