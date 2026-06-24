import { Application } from "pixi.js";
import * as PIXI from "pixi.js";
import { Live2DModel } from "pixi-live2d-display/cubism4";
import "./pet-window.css";

const packBaseUrl = "/pets/official/cyrene-live2d";
const alphaHitThreshold = 24;
const hitBoundarySampleStep = 4;
const hitBoundaryColor = "#ff4fd8";
const hitBoundaryRefreshMs = 300;

declare global {
  interface Window {
    cyreneDesktop?: {
      setMousePassthrough(value: boolean): void;
      onCursorSample(callback: (payload: CursorSamplePayload) => void): () => void;
    };
  }
}

interface CursorSamplePayload {
  readonly cursor: {
    readonly x: number;
    readonly y: number;
  };
  readonly bounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

Object.assign(window, { PIXI });

const root = document.getElementById("pet-root");
if (!root) {
  throw new Error("pet root is missing");
}

let lastPassthroughState: boolean | null = null;
let hitAlphaCache: Uint8Array | null = null;
let hitAlphaCacheWidth = 0;
let hitAlphaCacheHeight = 0;
let framePixels: Uint8Array | null = null;

const app = new Application({
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundAlpha: 0,
  antialias: true,
  autoDensity: true,
  resolution: Math.max(window.devicePixelRatio || 1, 2),
  preserveDrawingBuffer: true
});

root.appendChild(app.view as HTMLCanvasElement);
const canvas = app.view as HTMLCanvasElement;
const hitOverlay = document.createElement("canvas");
hitOverlay.className = "hit-boundary-overlay";
root.appendChild(hitOverlay);
const hitOverlayContext = hitOverlay.getContext("2d");

const model = await Live2DModel.from(`${packBaseUrl}/cyrene.model3.json`);
app.stage.addChild(model as unknown as PIXI.DisplayObject);
fitModel();
setMousePassthrough(false);
resizeHitOverlay();
refreshHitBoundary();
window.setInterval(() => refreshHitBoundary(), hitBoundaryRefreshMs);

window.addEventListener("resize", () => {
  app.renderer.resolution = Math.max(window.devicePixelRatio || 1, 2);
  app.renderer.resize(window.innerWidth, window.innerHeight);
  fitModel();
  resizeHitOverlay();
  resetHitAlphaCache();
  refreshHitBoundary();
});

window.cyreneDesktop?.onCursorSample((payload) => {
  const clientX = payload.cursor.x - payload.bounds.x;
  const clientY = payload.cursor.y - payload.bounds.y;
  setMousePassthrough(!isOpaqueCanvasPixel(clientX, clientY));
});

function fitModel(): void {
  const safeWidth = Math.max(model.width, 1);
  const safeHeight = Math.max(model.height, 1);
  const scale = Math.min(window.innerWidth / safeWidth, window.innerHeight / safeHeight) * 0.92;
  model.scale.set(scale);
  model.x = (window.innerWidth - model.width) / 2;
  model.y = window.innerHeight - model.height;
}

function setMousePassthrough(value: boolean): void {
  if (lastPassthroughState === value) {
    return;
  }

  lastPassthroughState = value;
  window.cyreneDesktop?.setMousePassthrough(value);
}

function isOpaqueCanvasPixel(clientX: number, clientY: number): boolean {
  const rect = canvas.getBoundingClientRect();
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
    return false;
  }

  const x = Math.floor((clientX - rect.left) * app.renderer.resolution);
  const y = Math.floor((clientY - rect.top) * app.renderer.resolution);

  if (!hitAlphaCache) {
    return true;
  }

  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      const sampleX = Math.min(Math.max(x + offsetX, 0), hitAlphaCacheWidth - 1);
      const sampleY = Math.min(Math.max(y + offsetY, 0), hitAlphaCacheHeight - 1);
      if (getCachedAlphaAtTop(sampleX, sampleY) > alphaHitThreshold) {
        return true;
      }
    }
  }

  return false;
}

function resizeHitOverlay(): void {
  const resolution = Math.max(window.devicePixelRatio || 1, 2);
  hitOverlay.width = Math.max(1, Math.floor(window.innerWidth * resolution));
  hitOverlay.height = Math.max(1, Math.floor(window.innerHeight * resolution));
  hitOverlay.style.width = `${window.innerWidth}px`;
  hitOverlay.style.height = `${window.innerHeight}px`;
}

function resetHitAlphaCache(): void {
  hitAlphaCache = null;
  hitAlphaCacheWidth = 0;
  hitAlphaCacheHeight = 0;
  framePixels = null;
}

function refreshHitBoundary(): void {
  if (refreshHitAlphaCache()) {
    drawHitBoundary();
  }
}

function refreshHitAlphaCache(): boolean {
  const renderer = app.renderer as PIXI.Renderer;
  const gl = renderer.gl;
  const width = renderer.width;
  const height = renderer.height;
  const pixelCount = width * height;
  const frameSize = pixelCount * 4;

  if (!framePixels || framePixels.length !== frameSize) {
    framePixels = new Uint8Array(frameSize);
    hitAlphaCache = new Uint8Array(pixelCount);
    hitAlphaCacheWidth = width;
    hitAlphaCacheHeight = height;
  }

  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, framePixels);

  if (!hitAlphaCache) {
    return false;
  }

  for (let index = 0; index < pixelCount; index += 1) {
    hitAlphaCache[index] = framePixels[index * 4 + 3] ?? 0;
  }

  return true;
}

function getCachedAlphaAtTop(x: number, yFromTop: number): number {
  if (!hitAlphaCache) {
    return 0;
  }

  const flippedY = hitAlphaCacheHeight - 1 - yFromTop;
  return hitAlphaCache[flippedY * hitAlphaCacheWidth + x] ?? 0;
}

function drawHitBoundary(): void {
  if (!hitOverlayContext || !hitAlphaCache) {
    return;
  }

  const renderer = app.renderer as PIXI.Renderer;
  const width = hitAlphaCacheWidth;
  const height = hitAlphaCacheHeight;
  const step = Math.max(2, Math.floor(hitBoundarySampleStep * renderer.resolution));
  const columns = Math.ceil(width / step);
  const rows = Math.ceil(height / step);
  const opaqueMap: boolean[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = Math.min(column * step + Math.floor(step / 2), width - 1);
      const y = Math.min(row * step + Math.floor(step / 2), height - 1);
      opaqueMap[row * columns + column] = getCachedAlphaAtTop(x, y) > alphaHitThreshold;
    }
  }

  hitOverlayContext.clearRect(0, 0, hitOverlay.width, hitOverlay.height);
  hitOverlayContext.save();
  hitOverlayContext.scale(hitOverlay.width / width, hitOverlay.height / height);
  hitOverlayContext.strokeStyle = hitBoundaryColor;
  hitOverlayContext.lineWidth = Math.max(1, renderer.resolution);
  hitOverlayContext.globalAlpha = 0.96;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (!opaqueMap[row * columns + column] || !isBoundaryCell(opaqueMap, columns, rows, column, row)) {
        continue;
      }

      hitOverlayContext.strokeRect(column * step, row * step, step, step);
    }
  }

  hitOverlayContext.restore();
}

function isBoundaryCell(
  opaqueMap: readonly boolean[],
  columns: number,
  rows: number,
  column: number,
  row: number
): boolean {
  const neighbors = [
    { column: column - 1, row },
    { column: column + 1, row },
    { column, row: row - 1 },
    { column, row: row + 1 }
  ];

  return neighbors.some((neighbor) => (
    neighbor.column < 0 ||
    neighbor.column >= columns ||
    neighbor.row < 0 ||
    neighbor.row >= rows ||
    !opaqueMap[neighbor.row * columns + neighbor.column]
  ));
}
