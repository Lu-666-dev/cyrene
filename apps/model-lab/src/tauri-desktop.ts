import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { interactionBindingsEvent } from "./runtime/interaction-bindings.js";
import type { InteractionActionBindings } from "./runtime/interaction-bindings.js";

interface TauriCursorSample {
  readonly cursor: { readonly x: number; readonly y: number };
  readonly bounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

if (isTauri()) {
  window.cyreneDesktop = {
    setMousePassthrough(value) {
      return invoke<void>("set_mouse_passthrough", { shouldPassThrough: Boolean(value) });
    },
    setWindowShape(rects) {
      return invoke<void>("set_window_shape", { rects });
    },
    setTrayIcon(imageBytes) {
      return invoke<void>("set_tray_icon", { imageBytes: Array.from(imageBytes) });
    },
    setDragActive(value) {
      return invoke<void>("set_drag_active", { dragActive: Boolean(value) });
    },
    beginWindowDrag() {},
    endWindowDrag() {},
    recordPetDebugSnapshot() {},
    onCursorSample(callback) {
      const unlistenPromise = listen<TauriCursorSample>("cyrene:cursor-sample", (event) => {
        callback(event.payload);
      });
      return () => {
        void unlistenPromise.then((unlisten) => unlisten());
      };
    },
    onInteractionBindingsUpdated(callback) {
      const unlistenPromise = listen<InteractionActionBindings>(interactionBindingsEvent, (event) => {
        callback(event.payload);
      });
      return () => {
        void unlistenPromise.then((unlisten) => unlisten());
      };
    }
  };
}
