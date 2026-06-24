import { app, BrowserWindow, ipcMain, screen } from "electron";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const petUrl = process.env.CYRENE_PET_URL ?? "http://127.0.0.1:5173/pet.html";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDataDir = path.resolve(".tmp", "electron-user-data");
mkdirSync(appDataDir, { recursive: true });
app.setPath("userData", appDataDir);
app.setPath("cache", path.join(appDataDir, "cache"));

function createPetWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  const windowWidth = 420;
  const windowHeight = 560;

  const petWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: Math.max(0, width - windowWidth - 24),
    y: Math.max(0, height - windowHeight - 24),
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  petWindow.setAlwaysOnTop(true, "screen-saver");
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  petWindow.loadURL(petUrl);
  startCursorSampling(petWindow);

  return petWindow;
}

function startCursorSampling(petWindow) {
  const timer = setInterval(() => {
    if (petWindow.isDestroyed()) {
      clearInterval(timer);
      return;
    }

    petWindow.webContents.send("cyrene:cursor-sample", {
      cursor: screen.getCursorScreenPoint(),
      bounds: petWindow.getBounds()
    });
  }, 50);
}

ipcMain.on("cyrene:set-mouse-passthrough", (event, shouldPassThrough) => {
  const sourceWindow = BrowserWindow.fromWebContents(event.sender);
  sourceWindow?.setIgnoreMouseEvents(Boolean(shouldPassThrough), { forward: true });
});

app.whenReady().then(() => {
  createPetWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createPetWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
