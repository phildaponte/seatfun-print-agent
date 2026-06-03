use std::process::Command;
use tauri::Manager;

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

      // Spawn Node.js sidecar process
      let node_path = "node";
      let dist_path = "dist/index.js";

      let child = Command::new(node_path)
        .arg(dist_path)
        .current_dir("..")
        .spawn()
        .expect("Failed to start Node.js process");

      // Store child process handle for cleanup
      app.manage(child);

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
