const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cyreneDesktop", {
  setMousePassthrough(value) {
    ipcRenderer.send("cyrene:set-mouse-passthrough", Boolean(value));
  },
  onCursorSample(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("cyrene:cursor-sample", listener);
    return () => ipcRenderer.removeListener("cyrene:cursor-sample", listener);
  }
});
