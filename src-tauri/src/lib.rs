mod artifact_parser;
mod download_manager;
mod path_safety;
mod qb_client;
mod types;

use download_manager::DownloadManager;
use qb_client::QbClient;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, State, WindowEvent,
};
use tauri_plugin_dialog::DialogExt;
use types::{BuildArtifactGroup, Credentials, DownloadRequest, TokenTestResult};

#[derive(Clone)]
struct AppState {
    downloads: DownloadManager,
}

#[tauri::command]
async fn fetch_build_artifacts(
    input: String,
    credentials: Credentials,
) -> Result<BuildArtifactGroup, String> {
    QbClient::new(credentials)
        .fetch_build_artifacts(&input)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn fetch_bulk_build_artifacts(
    inputs: Vec<String>,
    credentials: Credentials,
) -> Result<Vec<BuildArtifactGroup>, String> {
    let client = QbClient::new(credentials);
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
async fn test_token(credentials: Credentials) -> Result<TokenTestResult, String> {
    QbClient::new(credentials)
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
async fn pause_download(state: State<'_, AppState>, job_id: String) -> Result<(), String> {
    state
        .downloads
        .pause(&job_id)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn resume_download(state: State<'_, AppState>, job_id: String) -> Result<(), String> {
    state
        .downloads
        .resume(&job_id)
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

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png"))?;
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_icon(icon.clone());
            }

            TrayIconBuilder::with_id("main-tray")
                .tooltip("QuickBuild Download Manager")
                .icon(icon)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => show_main_window(app),
                    "quit" => app.exit(0),
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
            pause_download,
            resume_download,
            cancel_download,
            retry_download,
            pick_download_dir,
            open_folder
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
