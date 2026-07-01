# Architecture

Cyrene currently has three runtime boundaries:

```text
Tauri desktop host (Rust)
  transparent window, tray, cursor sampling, mouse pass-through, native commands

Model page (TypeScript)
  PixiJS, Live2D rendering, model transform, hit testing, interaction playback

Content packages (TypeScript)
  manifest parsing, model/action validation, action compilation, shared types
```

## Desktop Boundary

`apps/desktop/src-tauri` owns operating-system behavior. It creates the transparent Tauri window and exposes a narrow command surface for model hit rectangles, mouse pass-through state, drag state, and tray icons.

Tauri does not expose Electron-style dynamic window shapes. On Windows, the host keeps a full-monitor transparent window, samples the global cursor, tests it against the current model rectangle, and toggles whole-window input pass-through. New native commands should be added only when a model-page feature requires operating-system access.

## Model Boundary

`apps/model-lab/src/pet-main.ts` is the desktop model page. It loads the selected content-pack entry, renders the model, maps interaction regions to actions, and synchronizes the visible model bounds with the Tauri host.

`apps/model-lab/src/tauri-desktop.ts` adapts Tauri commands and events to the small desktop bridge consumed by the model page. The Model Lab UI uses the same content contracts to inspect and preview actions.

## Content Boundary

`packages/content` accepts untrusted JSON as `unknown`, parses it into typed contracts, and validates references against the Live2D model catalog. `pets/` is the canonical asset directory; the public copy used by Vite is generated and must not be edited directly.

Each character content pack owns three payloads: raw resources under `live2d/`, immutable chat defaults in `chat.json`, and model-specific adaptation in `runtime.json`. Shared renderer behavior lives once in `pets/live2d-defaults.json`. User chat overrides, interaction bindings, and encrypted memory are keyed by the stable content-pack ID and never written back into the installed character package.

Dynamic executable plugins, a plugin SDK, feeding, and pet-stat systems are outside the current project scope. The active architecture work is limited to completing the Electron-to-Tauri migration and keeping the desktop pet, Model Lab, and content validation paths maintainable.
