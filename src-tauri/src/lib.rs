use std::env;
use std::process::Command;
use tauri::{menu::{Menu, MenuItem}, tray::TrayIconBuilder, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Enable auto-start on login
      app.handle().plugin(tauri_plugin_autostart::init(
        tauri_plugin_autostart::MacosLauncher::LaunchAgent,
        Some(vec!["--minimized"]),
      ))?;

      // Create system tray with Show Status, Show Settings, and Quit menu items
      let show_status_i = MenuItem::with_id(app, "show-status", "Show Status", true, None::<&str>)
        .expect("Failed to create show status menu item");
      let show_settings_i = MenuItem::with_id(app, "show-settings", "Show Settings", true, None::<&str>)
        .expect("Failed to create show settings menu item");
      let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)
        .expect("Failed to create quit menu item");
      let menu = Menu::with_items(app, &[&show_status_i, &show_settings_i, &quit_i])
        .expect("Failed to create tray menu");

      let _tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| {
          match event.id.as_ref() {
            "show-status" => {
              // Check if window already exists, if so just focus it
              if let Some(window) = app.get_webview_window("status") {
                let _ = window.set_focus();
                let _ = window.show();
              } else {
                // Create new status window
                let _window = tauri::WebviewWindowBuilder::new(app, "status", tauri::WebviewUrl::App("status.html".into()))
                  .title("Seatfun Print Agent Status")
                  .inner_size(500.0, 400.0)
                  .resizable(false)
                  .build();
              }
            }
            "show-settings" => {
              // Check if window already exists, if so just focus it
              if let Some(window) = app.get_webview_window("settings") {
                let _ = window.set_focus();
                let _ = window.show();
              } else {
                // Create new settings window
                let _window = tauri::WebviewWindowBuilder::new(app, "settings", tauri::WebviewUrl::App("settings.html".into()))
                  .title("Seatfun Print Agent Settings")
                  .inner_size(550.0, 400.0)
                  .resizable(false)
                  .build();
              }
            }
            "quit" => {
              println!("Quit menu item was clicked");
              app.exit(0);
            }
            _ => {
              println!("Menu item {:?} not handled", event.id);
            }
          }
        })
        .build(app)
        .expect("Failed to create tray icon");

      // Handle window close event - hide instead of close
      if let Some(window) = app.get_webview_window("main") {
        let window_clone = window.clone();
        window.on_window_event(move |event| {
          if let tauri::WindowEvent::CloseRequested { .. } = event {
            window_clone.hide().unwrap();
          }
        });
      }

      // Spawn Node.js sidecar process
      // Try to get resource directory, fallback to executable directory
      let resource_path = match app.path().resource_dir() {
        Ok(path) => path,
        Err(e) => {
          eprintln!("Warning: Could not get resource_dir: {}. Trying exe dir...", e);
          match std::env::current_exe() {
            Ok(exe_path) => {
              // In macOS bundles, exe is in Contents/MacOS/, resources are in Contents/Resources/
              let exe_dir = exe_path.parent().unwrap_or(&exe_path);
              exe_dir.join("../Resources")
            }
            Err(_) => {
              eprintln!("Failed to get exe path. Node.js sidecar will not start.");
              return Ok(());
            }
          }
        }
      };
      
      eprintln!("Using resource path: {:?}", resource_path);
      
      // Find Node.js - GUI apps don't inherit shell PATH, so check common locations
      let node_path = if let Ok(output) = std::process::Command::new("which").arg("node").output() {
        String::from_utf8_lossy(&output.stdout).trim().to_string()
      } else {
        // Fallback to common locations
        let home = std::env::var("HOME").unwrap_or_default();
        let nvm_path = format!("{}/.nvm/versions/node/v20.20.0/bin/node", home);
        
        let common_paths = vec![
          "/usr/local/bin/node".to_string(),
          "/opt/homebrew/bin/node".to_string(),
          "/usr/bin/node".to_string(),
          nvm_path,
        ];
        
        common_paths.into_iter()
          .find(|p| std::path::Path::new(p).exists())
          .unwrap_or_else(|| "node".to_string())
      };
      
      eprintln!("Found Node.js at: {}", node_path);
      
      // In dev mode, dist is in project root; in production, it's in resource dir
      let (dist_path, working_dir) = if cfg!(debug_assertions) {
        // Dev mode: dist is in project root (parent of src-tauri)
        let project_root = resource_path.join("../..");
        (project_root.join("dist/index.js"), project_root)
      } else {
        // Production: dist is bundled in _up_ subdirectory
        // Run from _up_ so node_modules can be found naturally by ESM
        let up_dir = resource_path.join("_up_");
        (up_dir.join("dist/index.js"), up_dir)
      };

      eprintln!("Attempting to spawn Node.js:");
      eprintln!("  node_path: {}", node_path);
      eprintln!("  dist_path: {:?}", dist_path);
      eprintln!("  working_dir: {:?}", working_dir);

      let child = Command::new(node_path)
        .arg(&dist_path)
        .current_dir(&working_dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn();

      match child {
        Ok(mut child) => {
          eprintln!("Node.js process started successfully!");
          
          // Read stderr in a separate thread to see errors
          if let Some(stderr) = child.stderr.take() {
            std::thread::spawn(move || {
              use std::io::{BufRead, BufReader};
              let reader = BufReader::new(stderr);
              for line in reader.lines() {
                if let Ok(line) = line {
                  eprintln!("[Node.js stderr] {}", line);
                }
              }
            });
          }
          
          // Store child process handle for cleanup
          app.manage(child);
        }
        Err(e) => {
          eprintln!("CRITICAL: Failed to start Node.js process: {}", e);
          eprintln!("Make sure Node.js is installed and in PATH");
          // Don't crash the app if Node.js fails to start
          // The app will run but the HTTP server won't be available
        }
      }

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
