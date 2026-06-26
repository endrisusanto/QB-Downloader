mod artifact_parser;
mod download_manager;
mod path_safety;
mod qb_client;
mod secure_storage;
mod types;
mod system_stats;

use download_manager::DownloadManager;
use qb_client::QbClient;
use tauri::{
    menu::{CheckMenuItemBuilder, Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, State, WindowEvent,
};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_dialog::DialogExt;
use types::{BuildArtifactGroup, Credentials, DownloadRequest, QuickBuildConfig, TokenTestResult};

#[derive(Clone)]
struct AppState {
    downloads: DownloadManager,
}

#[tauri::command]
async fn fetch_build_artifacts(
    input: String,
    credentials: Credentials,
    quick_build_config: QuickBuildConfig,
) -> Result<BuildArtifactGroup, String> {
    QbClient::new(credentials, quick_build_config)
        .map_err(|err| err.to_string())?
        .fetch_build_artifacts(&input)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn fetch_bulk_build_artifacts(
    inputs: Vec<String>,
    credentials: Credentials,
    quick_build_config: QuickBuildConfig,
) -> Result<Vec<BuildArtifactGroup>, String> {
    let client = QbClient::new(credentials, quick_build_config).map_err(|err| err.to_string())?;
    let mut groups = Vec::with_capacity(inputs.len());

    for input in inputs {
        match client.fetch_build_artifacts(&input).await {
            Ok(group) => groups.push(group),
            Err(err) => groups.push(BuildArtifactGroup::failed(input, err.to_string())),
        }
    }

    Ok(groups)
}

#[tauri::command]
async fn test_token(
    credentials: Credentials,
    quick_build_config: QuickBuildConfig,
) -> Result<TokenTestResult, String> {
    QbClient::new(credentials, quick_build_config)
        .map_err(|err| err.to_string())?
        .test_token()
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn start_download(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    group: DownloadRequest,
) -> Result<String, String> {
    state
        .downloads
        .start(app, group)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn cancel_download(state: State<'_, AppState>, job_id: String) -> Result<(), String> {
    state
        .downloads
        .cancel(&job_id)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn retry_download(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    job_id: String,
) -> Result<String, String> {
    state
        .downloads
        .retry(app, &job_id)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn pick_download_dir(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let folder = app
        .dialog()
        .file()
        .blocking_pick_folder()
        .map(|path| path.to_string());
    Ok(folder)
}

#[tauri::command]
async fn open_folder(path: String) -> Result<(), String> {
    opener::open(path).map_err(|err| err.to_string())
}

#[tauri::command]
async fn secure_vault_password() -> Result<String, String> {
    tokio::task::spawn_blocking(secure_storage::get_or_create_vault_password)
        .await
        .map_err(|err| err.to_string())?
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn delete_file(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if p.exists() {
        std::fs::remove_file(p).map_err(|err| err.to_string())?;
    }
    let part_path = format!("{}.part", path);
    let part_p = std::path::Path::new(&part_path);
    if part_p.exists() {
        std::fs::remove_file(part_p).map_err(|err| err.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn get_system_stats(target_dir: String) -> Result<system_stats::SystemStats, String> {
    tokio::task::spawn_blocking(move || {
        Ok(system_stats::get_stats(&target_dir))
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
fn get_local_ipv4() -> Option<String> {
    system_stats::local_ipv4()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::Builder::default().build())
        .setup(|app| {
            let salt_path = app
                .path()
                .app_local_data_dir()
                .map_err(|err| err.to_string())?
                .join("stronghold-salt.txt");
            app.handle()
                .plugin(tauri_plugin_stronghold::Builder::with_argon2(&salt_path).build())?;

            let autostart_manager = app.autolaunch();
            let is_autostart_enabled = autostart_manager.is_enabled().unwrap_or(false);

            let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
            let autostart_item = CheckMenuItemBuilder::new("Start on Windows Startup")
                .id("toggle-autostart")
                .checked(is_autostart_enabled)
                .build(app)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &autostart_item, &quit])?;
            let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png"))?;
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_icon(icon.clone());
            }

            let autostart_item_clone = autostart_item.clone();
            TrayIconBuilder::with_id("main-tray")
                .tooltip("QuickBuild Download Manager")
                .icon(icon)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "show" => show_main_window(app),
                    "quit" => app.exit(0),
                    "toggle-autostart" => {
                        let app_handle = app.clone();
                        let autostart_item = autostart_item_clone.clone();
                        let _ = app.run_on_main_thread(move || {
                            if let Ok(is_checked) = autostart_item.is_checked() {
                                let new_state = !is_checked;
                                let manager = app_handle.autolaunch();
                                let res = if new_state {
                                    manager.enable()
                                } else {
                                    manager.disable()
                                };
                                if res.is_ok() {
                                    let _ = autostart_item.set_checked(new_state);
                                }
                            }
                        });
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .manage(AppState {
            downloads: DownloadManager::default(),
        })
        .invoke_handler(tauri::generate_handler![
            fetch_build_artifacts,
            fetch_bulk_build_artifacts,
            test_token,
            start_download,
            cancel_download,
            retry_download,
            pick_download_dir,
            open_folder,
            secure_vault_password,
            delete_file,
            get_system_stats,
            get_local_ipv4
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
