use tauri::{menu::{Menu, MenuItem}, tray::TrayIconBuilder, Manager};
use std::sync::Arc;

mod server;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      tauri::async_runtime::block_on(async move {
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

      // Start Rust HTTP server
      let config = Arc::new(server::Config::from_env());
      let logger = Arc::new(server::Logger::new(&config.log_level));
      
      let printer = config.printer_ip.as_ref().map(|ip| {
        Arc::new(server::PrinterClient::new(ip.clone(), config.printer_port))
      });
      
      let probe = server::PrinterProbe::new(printer.clone()).start();
      let pairing = server::PairingState::new(config.env_token.clone()).init().await;
      
      if !pairing.is_paired() {
        logger.warn("agent.unpaired", Some(serde_json::json!({
          "hint": "POST /v1/pair from the dashboard, or set SEATFUN_AGENT_TOKEN for dev."
        })));
      }
      
      let state = server::AppState {
        config: config.clone(),
        logger: logger.clone(),
        printer,
        probe,
        pairing,
        started_at: std::time::Instant::now(),
      };
      
      // Start HTTP server in background
      tokio::spawn(async move {
        if let Err(e) = server::start_server(state).await {
          eprintln!("HTTP server error: {}", e);
        }
      });

      Ok(())
      })
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

