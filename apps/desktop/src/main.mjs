import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from "electron";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const petUrl = process.env.CYRENE_PET_URL ?? "http://127.0.0.1:5173/pet.html";
const targetFrameMs = 1000 / 60;
const cursorSampleMs = targetFrameMs;
const dragSampleMs = targetFrameMs;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceTmpDir = path.resolve(__dirname, "../../../.tmp");
const debugLatestPath = path.join(workspaceTmpDir, "pet-debug-latest.json");
const debugLogPath = path.join(workspaceTmpDir, "pet-debug.ndjson");
const enablePetDebug = process.env.CYRENE_PET_DEBUG === "1" || petUrl.includes("debugPet=1");
const appDataDir = path.resolve(".tmp", "electron-user-data");
if (enablePetDebug) {
  mkdirSync(workspaceTmpDir, { recursive: true });
  writeFileSync(debugLogPath, "");
}
mkdirSync(appDataDir, { recursive: true });
app.setPath("userData", appDataDir);
app.setPath("cache", path.join(appDataDir, "cache"));
const hasSingleInstanceLock = app.requestSingleInstanceLock();

let activeDrag = null;
let petWindow = null;
let tray = null;
const petInputStates = new WeakMap();

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function clampWindowPositionToDisplay(x, y, width, height, display) {
  const { workArea } = display;
  const maxX = workArea.x + Math.max(0, workArea.width - width);
  const maxY = workArea.y + Math.max(0, workArea.height - height);
  return {
    x: clamp(x, workArea.x, maxX),
    y: clamp(y, workArea.y, maxY)
  };
}

function getDragPosition(drag, cursor) {
  const rawX = Math.round(drag.startBounds.x + cursor.x - drag.startCursor.x);
  const rawY = Math.round(drag.startBounds.y + cursor.y - drag.startCursor.y);
  const display = screen.getDisplayNearestPoint(cursor);
  const position = clampWindowPositionToDisplay(
    rawX,
    rawY,
    drag.startBounds.width,
    drag.startBounds.height,
    display
  );

  return {
    ...position,
    rawX,
    rawY,
    clamped: position.x !== rawX || position.y !== rawY,
    displayId: display.id,
    workArea: display.workArea
  };
}

function writePetDebugEntry(entry) {
  if (!enablePetDebug) {
    return;
  }

  const serialized = `${JSON.stringify(entry)}\n`;
  writeFileSync(debugLatestPath, JSON.stringify(entry, null, 2));
  appendFileSync(debugLogPath, serialized);
}

function createPetWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { x: workAreaX, y: workAreaY, width: workAreaWidth, height: workAreaHeight } = primaryDisplay.workArea;
  const desktopBounds = {
    x: workAreaX,
    y: workAreaY,
    width: Math.max(1, workAreaWidth),
    height: Math.max(1, workAreaHeight)
  };

  const window = new BrowserWindow({
    ...desktopBounds,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: true,
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

  window.setAlwaysOnTop(true, "pop-up-menu");
  window.setMenuBarVisibility(false);
  window.setFullScreenable(false);
  window.setIgnoreMouseEvents(true, { forward: true });
  petInputStates.set(window, {
    rects: [],
    dragActive: false,
    ignoringMouse: true
  });
  window.loadURL(petUrl);
  startCursorSampling(window);
  window.on("show", updateTrayMenu);
  window.on("hide", updateTrayMenu);
  window.on("closed", () => {
    if (activeDrag?.window === window) {
      stopActiveDrag();
    }
    if (petWindow === window) {
      petWindow = null;
    }
    updateTrayMenu();
  });

  petWindow = window;
  return window;
}

function showPetWindow() {
  const window = petWindow && !petWindow.isDestroyed() ? petWindow : createPetWindow();
  window.showInactive();
  window.moveTop();
}

function hidePetWindow() {
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }

  if (activeDrag?.window === petWindow) {
    stopActiveDrag();
  }
  petWindow.hide();
}

function togglePetWindow() {
  if (petWindow?.isVisible()) {
    hidePetWindow();
  } else {
    showPetWindow();
  }
}

function updateTrayMenu() {
  if (!tray || tray.isDestroyed()) {
    return;
  }

  const isPetVisible = Boolean(petWindow && !petWindow.isDestroyed() && petWindow.isVisible());
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: isPetVisible ? "隐藏桌宠" : "显示桌宠",
      click: togglePetWindow
    },
    { type: "separator" },
    {
      label: "退出 Cyrene",
      click() {
        app.quit();
      }
    }
  ]));
}

function createTray(icon) {
  tray = new Tray(icon);
  tray.setToolTip("Cyrene 桌宠");
  tray.on("click", togglePetWindow);
  updateTrayMenu();
}

function setTrayIcon(imageBytes) {
  if (!imageBytes) {
    return;
  }

  const sourceImage = nativeImage.createFromBuffer(Buffer.from(imageBytes));
  if (sourceImage.isEmpty()) {
    console.warn("[Cyrene] Ignored an invalid model tray icon.");
    return;
  }

  const { width, height } = sourceImage.getSize();
  const side = Math.min(width, height);
  const icon = sourceImage
    .crop({
      x: Math.floor((width - side) / 2),
      y: Math.floor((height - side) / 2),
      width: side,
      height: side
    })
    .resize({ width: 256, height: 256, quality: "best" });

  if (!tray || tray.isDestroyed()) {
    createTray(icon);
  } else {
    tray.setImage(icon);
  }
  console.log("[Cyrene] Updated tray icon from the active model pack.");
}

function startCursorSampling(petWindow) {
  const timer = setInterval(() => {
    if (petWindow.isDestroyed()) {
      clearInterval(timer);
      return;
    }

    if (activeDrag?.window === petWindow) {
      return;
    }

    const cursor = screen.getCursorScreenPoint();
    updatePetMousePassthrough(petWindow, cursor);
    petWindow.webContents.send("cyrene:cursor-sample", {
      cursor,
      bounds: petWindow.getBounds()
    });
  }, cursorSampleMs);
}

ipcMain.on("cyrene:set-mouse-passthrough", (event, shouldPassThrough) => {
  const sourceWindow = BrowserWindow.fromWebContents(event.sender);
  if (!sourceWindow) {
    return;
  }

  if (shouldPassThrough) {
    setPetMousePassthrough(sourceWindow, true);
  } else {
    updatePetMousePassthrough(sourceWindow);
  }
});

ipcMain.on("cyrene:set-drag-active", (event, dragActive) => {
  const sourceWindow = BrowserWindow.fromWebContents(event.sender);
  const inputState = sourceWindow ? petInputStates.get(sourceWindow) : null;
  if (!sourceWindow || !inputState) {
    return;
  }

  inputState.dragActive = Boolean(dragActive);
  updatePetMousePassthrough(sourceWindow);
});

ipcMain.on("cyrene:set-tray-icon", (_event, imageBytes) => {
  setTrayIcon(imageBytes);
});

ipcMain.handle("cyrene:set-window-shape", (event, rects) => {
  const sourceWindow = BrowserWindow.fromWebContents(event.sender);
  if (!sourceWindow) {
    return;
  }

  const safeRects = Array.isArray(rects)
    ? rects
      .map((rect) => ({
        x: Math.max(0, Math.round(Number(rect?.x) || 0)),
        y: Math.max(0, Math.round(Number(rect?.y) || 0)),
        width: Math.max(1, Math.round(Number(rect?.width) || 0)),
        height: Math.max(1, Math.round(Number(rect?.height) || 0))
      }))
      .filter((rect) => rect.width > 0 && rect.height > 0)
    : [];

  sourceWindow.setShape(safeRects);
  const inputState = petInputStates.get(sourceWindow);
  if (inputState) {
    inputState.rects = safeRects;
    updatePetMousePassthrough(sourceWindow);
  }
  sourceWindow.moveTop();
});

function updatePetMousePassthrough(petWindow, cursor = screen.getCursorScreenPoint()) {
  const inputState = petInputStates.get(petWindow);
  if (!inputState || petWindow.isDestroyed()) {
    return;
  }

  if (inputState.dragActive) {
    setPetMousePassthrough(petWindow, false);
    return;
  }

  const bounds = petWindow.getBounds();
  const localX = cursor.x - bounds.x;
  const localY = cursor.y - bounds.y;
  const isOverInputRegion = inputState.rects.some((rect) => (
    localX >= rect.x &&
    localX < rect.x + rect.width &&
    localY >= rect.y &&
    localY < rect.y + rect.height
  ));
  setPetMousePassthrough(petWindow, !isOverInputRegion);
}

function setPetMousePassthrough(petWindow, shouldPassThrough) {
  const inputState = petInputStates.get(petWindow);
  if (!inputState || inputState.ignoringMouse === shouldPassThrough) {
    return;
  }

  inputState.ignoringMouse = shouldPassThrough;
  petWindow.setIgnoreMouseEvents(shouldPassThrough, { forward: true });
}

ipcMain.on("cyrene:begin-window-drag", (event) => {
  const sourceWindow = BrowserWindow.fromWebContents(event.sender);
  if (!sourceWindow) {
    return;
  }

  stopActiveDrag();
  sourceWindow.setIgnoreMouseEvents(false);

  const startCursor = screen.getCursorScreenPoint();
  const startBounds = sourceWindow.getBounds();

  activeDrag = {
    window: sourceWindow,
    startCursor,
    startBounds,
    lastX: startBounds.x,
    lastY: startBounds.y,
    lastTickAt: performance.now(),
    tickCount: 0,
    timer: setInterval(() => {
      if (!activeDrag || activeDrag.window.isDestroyed()) {
        stopActiveDrag();
        return;
      }

      const tickAt = performance.now();
      const tickDt = tickAt - activeDrag.lastTickAt;
      activeDrag.lastTickAt = tickAt;
      activeDrag.tickCount += 1;
      const cursor = screen.getCursorScreenPoint();
      const next = getDragPosition(activeDrag, cursor);
      const beforeBounds = activeDrag.window.getBounds();
      if (
        next.x === activeDrag.lastX &&
        next.y === activeDrag.lastY &&
        beforeBounds.width === activeDrag.startBounds.width &&
        beforeBounds.height === activeDrag.startBounds.height
      ) {
        writePetDebugEntry({
          source: "main-drag-tick",
          receivedAt: Date.now(),
          tickAt,
          tickDt,
          skipped: true,
          cursor,
          target: next,
          beforeBounds,
          activeDrag: {
            startCursor: activeDrag.startCursor,
            startBounds: activeDrag.startBounds,
            tickCount: activeDrag.tickCount
          }
        });
        return;
      }

      activeDrag.lastX = next.x;
      activeDrag.lastY = next.y;
      activeDrag.window.setBounds({
        x: next.x,
        y: next.y,
        width: activeDrag.startBounds.width,
        height: activeDrag.startBounds.height
      }, false);

      writePetDebugEntry({
        source: "main-drag-tick",
        receivedAt: Date.now(),
        tickAt,
        tickDt,
        skipped: false,
        cursor,
        target: next,
        beforeBounds,
        afterBounds: activeDrag.window.getBounds(),
        activeDrag: {
          startCursor: activeDrag.startCursor,
          startBounds: activeDrag.startBounds,
          tickCount: activeDrag.tickCount
        }
      });
    }, dragSampleMs)
  };
});

ipcMain.on("cyrene:end-window-drag", () => {
  stopActiveDrag();
});

ipcMain.on("cyrene:pet-debug-snapshot", (event, payload) => {
  if (!enablePetDebug) {
    return;
  }

  const sourceWindow = BrowserWindow.fromWebContents(event.sender);
  const activeDragForWindow = activeDrag?.window === sourceWindow ? activeDrag : null;
  const inputState = sourceWindow ? petInputStates.get(sourceWindow) : null;
  const snapshot = {
    receivedAt: Date.now(),
    cursor: screen.getCursorScreenPoint(),
    windowBounds: sourceWindow?.getBounds() ?? null,
    activeDrag: activeDragForWindow ? {
      startCursor: activeDragForWindow.startCursor,
      startBounds: activeDragForWindow.startBounds
    } : null,
    inputState: inputState ? {
      rects: inputState.rects,
      dragActive: inputState.dragActive,
      ignoringMouse: inputState.ignoringMouse
    } : null,
    renderer: payload
  };

  writePetDebugEntry(snapshot);
});

function stopActiveDrag() {
  if (!activeDrag) {
    return;
  }

  if (!activeDrag.window.isDestroyed()) {
    const currentBounds = activeDrag.window.getBounds();
    activeDrag.window.setBounds({
      x: currentBounds.x,
      y: currentBounds.y,
      width: activeDrag.startBounds.width,
      height: activeDrag.startBounds.height
    }, false);
  }

  clearInterval(activeDrag.timer);
  activeDrag = null;
}

if (hasSingleInstanceLock) {
  app.whenReady().then(() => {
    createPetWindow();

    app.on("activate", () => {
      showPetWindow();
    });
  });

  app.on("before-quit", () => {
    stopActiveDrag();
  });

  app.on("second-instance", () => {
    showPetWindow();
  });
} else {
  app.quit();
}
