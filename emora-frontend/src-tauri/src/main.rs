// Emora desktop shell.
//
// Deliberately thin: the app is a native window onto the FastAPI backend, which
// already serves the built React UI at http://127.0.0.1:8000 (see main.py's
// single-process mode). Bundling Python + torch + TensorFlow would turn a 10 MB
// app into a multi-gigabyte installer, so the shell starts the project's own
// virtualenv instead.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

const BACKEND_ADDR: &str = "127.0.0.1:8000";
const BACKEND_URL: &str = "http://127.0.0.1:8000";
/// Cold start loads no models (EMORA_WARMUP=0), but imports alone take a while.
const STARTUP_TIMEOUT: Duration = Duration::from_secs(120);

struct Backend(Mutex<Option<Child>>);

fn backend_is_up() -> bool {
    let addr: SocketAddr = BACKEND_ADDR.parse().expect("valid address");
    TcpStream::connect_timeout(&addr, Duration::from_millis(400)).is_ok()
}

/// Where the Python project lives. EMORA_HOME wins; otherwise try the usual spots.
fn project_root() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(env_home) = std::env::var("EMORA_HOME") {
        candidates.push(PathBuf::from(env_home));
    }
    // Running from the repo (cargo run / tauri dev): src-tauri/../..
    if let Ok(exe) = std::env::current_exe() {
        let mut dir: Option<&Path> = exe.parent();
        while let Some(d) = dir {
            if d.join("backend/app/main.py").exists() {
                candidates.push(d.to_path_buf());
                break;
            }
            dir = d.parent();
        }
    }
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        candidates.push(home.join("Desktop/my_apps/emotion-assistant"));
        candidates.push(home.join("emotion-assistant"));
    }
    candidates
        .into_iter()
        .find(|p| p.join("backend/app/main.py").exists())
}

fn venv_uvicorn(root: &Path) -> Option<PathBuf> {
    let unix = root.join("venv/bin/uvicorn");
    let windows = root.join("venv/Scripts/uvicorn.exe");
    [unix, windows].into_iter().find(|p| p.exists())
}

/// Start the backend unless one is already listening (the developer may have
/// started it in a terminal — never run two on the same port).
fn spawn_backend() -> Option<Child> {
    if backend_is_up() {
        return None;
    }
    let root = project_root()?;
    let uvicorn = venv_uvicorn(&root)?;
    Command::new(uvicorn)
        .args([
            "backend.app.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            "8000",
        ])
        .current_dir(&root)
        // Models load on first use: a desktop launch shouldn't pin 2-3 GB up front.
        .env("EMORA_WARMUP", std::env::var("EMORA_WARMUP").unwrap_or_else(|_| "0".into()))
        .spawn()
        .ok()
}

fn main() {
    tauri::Builder::default()
        .manage(Backend(Mutex::new(None)))
        .setup(|app| {
            let child = spawn_backend();
            *app.state::<Backend>().0.lock().unwrap() = child;

            let window = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External(BACKEND_URL.parse().unwrap()),
            )
            .title("Emora")
            .inner_size(1280.0, 860.0)
            .min_inner_size(900.0, 640.0)
            .build()?;

            // The first paint may land before uvicorn is listening; reload once it is.
            std::thread::spawn(move || {
                let deadline = std::time::Instant::now() + STARTUP_TIMEOUT;
                while std::time::Instant::now() < deadline {
                    if backend_is_up() {
                        std::thread::sleep(Duration::from_millis(600));
                        let _ = window.eval(&format!("location.replace('{BACKEND_URL}')"));
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(500));
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Emora")
        // Window "Destroyed" doesn't fire on a macOS Quit, which left the backend
        // running after the app closed. Exit does.
        .run(|app, event| {
            if let tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. } = event {
                // Only kills a backend this app started; one you ran yourself keeps going.
                if let Some(child) = app.state::<Backend>().0.lock().unwrap().as_mut() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        });
}
