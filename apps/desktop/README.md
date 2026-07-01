# Desktop Shell

The desktop shell uses Tauri 2 with a Rust host and the system WebView2 runtime on Windows.

Responsibilities:

- Transparent, always-on-top, full-monitor pet window.
- Dynamic mouse pass-through outside the visible model bounds.
- Tray visibility controls and active-model tray icon.
- Global cursor sampling for Live2D focus and hit testing.
- A narrow Tauri command bridge for native window operations.

The current Windows implementation reproduces Electron's shaped-window behavior by sampling the global cursor and toggling whole-window input pass-through from the model's dynamic hit rectangle. The shell does not own model actions or interaction behavior.

Development loads the Vite pet page. `tauri build --no-bundle` verifies that the desktop application compiles. Installer bundling and publishing are outside the current milestone.
