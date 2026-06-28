const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cyreneDesktop", {
  setMousePassthrough(value) {
    ipcRenderer.send("cyrene:set-mouse-passthrough", Boolean(value));
  },
  setWindowShape(rects) {
    return ipcRenderer.invoke("cyrene:set-window-shape", rects);
  },
  setTrayIcon(imageBytes) {
    ipcRenderer.send("cyrene:set-tray-icon", imageBytes);
  },
  setDragActive(value) {
    ipcRenderer.send("cyrene:set-drag-active", Boolean(value));
  },
  beginWindowDrag() {
    ipcRenderer.send("cyrene:begin-window-drag");
  },
  endWindowDrag() {
    ipcRenderer.send("cyrene:end-window-drag");
  },
  recordPetDebugSnapshot(payload) {
    ipcRenderer.send("cyrene:pet-debug-snapshot", payload);
  },
  onCursorSample(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("cyrene:cursor-sample", listener);
    return () => ipcRenderer.removeListener("cyrene:cursor-sample", listener);
  }
});
