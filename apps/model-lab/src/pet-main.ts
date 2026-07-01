import { Application } from "pixi.js";
import * as PIXI from "pixi.js";
import { Live2DModel, MotionPriority } from "pixi-live2d-display/cubism4";
import type {
  Live2DActionContract,
  Live2DInteractionRegionContract,
  Live2DMotionEntry
} from "@cyrene/content";
import { constrainModelOffsetToViewport, constrainUserScaleToViewport } from "./model-viewport.js";
import { loadLive2DContentBundle } from "./runtime/content-loader.js";
import { getActiveCharacterBaseUrl } from "./runtime/active-character.js";
import {
  createDefaultInteractionActionBindings,
  loadInteractionActionBindings,
  normalizeInteractionActionBindings
} from "./runtime/interaction-bindings.js";
import type { InteractionActionBindings } from "./runtime/interaction-bindings.js";
import "./tauri-desktop.js";
import "./pet-window.css";

const packBaseUrl = getActiveCharacterBaseUrl();
const hitBoundaryColor = "#ff4fd8";
const regionBoundaryColor = "#00d5ff";
const searchParams = new URLSearchParams(window.location.search);
const showHitDebug = searchParams.get("debugHit") === "1";
const recordPetDebug = searchParams.get("debugPet") === "1";

declare global {
  interface Window {
    cyreneDesktop?: {
      setMousePassthrough(value: boolean): Promise<void>;
      setWindowShape(rects: readonly WindowShapeRect[]): Promise<void>;
      setTrayIcon(imageBytes: Uint8Array): Promise<void>;
      setDragActive(value: boolean): Promise<void>;
      beginWindowDrag(): void;
      endWindowDrag(): void;
      recordPetDebugSnapshot(payload: unknown): void;
      onCursorSample(callback: (payload: CursorSamplePayload) => void): () => void;
      onInteractionBindingsUpdated(
        callback: (bindings: InteractionActionBindings) => void
      ): () => void;
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

interface WindowShapeRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

type Live2DActionMapping = Live2DActionContract;
type InteractionRegionShape = Live2DInteractionRegionContract["shape"];
type InteractionRegionRect = Extract<InteractionRegionShape, { readonly type: "rect" }>;
type InteractionRegionPolygon = Extract<InteractionRegionShape, { readonly type: "polygon" }>;

interface InteractionRegion extends Live2DInteractionRegionContract {
  readonly id: string;
  readonly priority: number;
}

type Live2DModelMotionEntry = Pick<Live2DMotionEntry, "name" | "file" | "expression">;

interface MotionManagerWithEvents {
  readonly once?: (event: "motionFinish", listener: () => void) => void;
  readonly off?: (event: "motionFinish", listener: () => void) => void;
}

interface ModelNaturalBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

Object.assign(window, { PIXI });

const root = document.getElementById("pet-root");
if (!root) {
  throw new Error("pet root is missing");
}
const petRoot = root;
const content = await loadLive2DContentBundle(packBaseUrl);
const contentPack = content.manifest;
const globalRuntime = content.runtimeDefaults;
const characterRuntime = content.runtime;
const alphaHitThreshold = globalRuntime.input.alphaHitThreshold;
const hitBoundarySampleStep = globalRuntime.diagnostics.hitBoundarySampleStep;
const hitBoundaryRefreshMs = globalRuntime.diagnostics.hitBoundaryRefreshMs;
const feedbackHoldMs = globalRuntime.feedback.holdMs;
const dragStartThresholdPx = globalRuntime.input.dragStartThresholdPx;
const longPressClickSuppressMs = globalRuntime.input.longPressClickSuppressMs;
const minUserScale = globalRuntime.scale.min;
const maxUserScale = globalRuntime.scale.max;
const wheelZoomSensitivity = globalRuntime.scale.wheelSensitivity;
const scaleFeedbackVisibleMs = globalRuntime.scale.feedbackVisibleMs;
const desktopModelBoxWidth = globalRuntime.desktop.modelBoxWidth;
const desktopModelBoxHeight = globalRuntime.desktop.modelBoxHeight;
const desktopModelMargin = globalRuntime.desktop.margin;
const desktopShapePadding = globalRuntime.desktop.shapePadding;

let lastPassthroughState: boolean | null = null;
let hitAlphaCache: Uint8Array | null = null;
let hitAlphaCacheWidth = 0;
let hitAlphaCacheHeight = 0;
let framePixels: Uint8Array | null = null;
let feedbackSerial = 0;
let baseModelScale = 1;
let userScale = 1;
let layoutWidth = window.innerWidth;
let layoutHeight = window.innerHeight;
let modelOffsetX = 0;
let modelOffsetY = 0;
let hitAlphaRefreshFrame: number | null = null;
let windowShapeFrame: number | null = null;
let windowShapeUpdateInFlight = false;
let windowShapeUpdateQueued = false;
let lastWindowShapeSignature = "";
let scaleFeedbackTimer: number | null = null;
let isDragPerformanceMode = false;
const usesDesktopWindowShape = Boolean(window.cyreneDesktop);

interface DragSession {
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly startScreenX: number;
  readonly startScreenY: number;
  readonly startModelOffsetX: number;
  readonly startModelOffsetY: number;
  readonly startedAt: number;
  lastScreenX: number;
  lastScreenY: number;
  hasDragged: boolean;
}

let dragSession: DragSession | null = null;

const app = new Application({
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundAlpha: 0,
  antialias: true,
  autoDensity: true,
  resolution: window.devicePixelRatio || 1,
  preserveDrawingBuffer: !usesDesktopWindowShape || showHitDebug
});

root.appendChild(app.view as HTMLCanvasElement);
const canvas = app.view as HTMLCanvasElement;
const hitOverlay = document.createElement("canvas");
hitOverlay.className = "hit-boundary-overlay";
hitOverlay.hidden = !showHitDebug;
root.appendChild(hitOverlay);
const hitOverlayContext = hitOverlay.getContext("2d");
const scaleFeedback = document.createElement("div");
scaleFeedback.className = "scale-feedback";
root.appendChild(scaleFeedback);

void loadDesktopTrayIcon(contentPack.trayIcon ?? contentPack.icon);
const actionMap = content.actionMap;
const interactionPreset = {
  interactionRegions: Object.entries(content.interactionPreset.interactionRegions)
    .map(([id, region]): InteractionRegion => ({
      ...region,
      id,
      priority: region.priority ?? 0
    }))
    .sort((left, right) => right.priority - left.priority)
};
const defaultInteractionActionBindings = createDefaultInteractionActionBindings(content.interactionPreset);
const availableInteractionActions = Object.keys(actionMap.actions);
let interactionActionBindings = loadInteractionActionBindings(
  contentPack.id,
  defaultInteractionActionBindings,
  availableInteractionActions
);
window.cyreneDesktop?.onInteractionBindingsUpdated((bindings) => {
  interactionActionBindings = normalizeInteractionActionBindings(
    bindings,
    defaultInteractionActionBindings,
    availableInteractionActions
  );
});
const modelMotionCatalog = createModelMotionCatalog(content.modelCatalog.motions);
const model = await Live2DModel.from(content.entryUrl, {
  autoInteract: false
});
app.stage.addChild(model as unknown as PIXI.DisplayObject);
const modelNaturalBounds = getModelNaturalBounds();
initializeDesktopModelLayout();
fitModel();
if (usesDesktopWindowShape) {
  scheduleWindowShapeUpdate();
} else {
  setMousePassthrough(false);
}
if (recordPetDebug) {
  window.setInterval(() => {
    recordPetDebugSnapshot("interval");
  }, 100);
}
if (!usesDesktopWindowShape || showHitDebug) {
  scheduleHitAlphaRefresh();
}
window.setInterval(() => {
  if (!isDragPerformanceMode && (!usesDesktopWindowShape || showHitDebug)) {
    refreshInteractionHitCache();
  }
}, hitBoundaryRefreshMs);
if (showHitDebug) {
  resizeHitOverlay();
  refreshInteractionHitCache();
}

window.addEventListener("resize", () => {
  app.renderer.resolution = window.devicePixelRatio || 1;
  app.renderer.resize(window.innerWidth, window.innerHeight);
  if (!usesDesktopWindowShape) {
    layoutWidth = window.innerWidth;
    layoutHeight = window.innerHeight;
    fitModel();
  } else {
    applyModelTransform();
  }
  resetHitAlphaCache();
  updateScaleFeedbackPosition();
  scheduleWindowShapeUpdate();
  if (!usesDesktopWindowShape || showHitDebug) {
    scheduleHitAlphaRefresh();
  }
  if (showHitDebug) {
    resizeHitOverlay();
  }
});

window.cyreneDesktop?.onCursorSample((payload) => {
  if (dragSession || isDragPerformanceMode) {
    return;
  }

  const clientX = payload.cursor.x - payload.bounds.x;
  const clientY = payload.cursor.y - payload.bounds.y;
  updateModelFocus(clientX, clientY);
  if (!usesDesktopWindowShape) {
    setMousePassthrough(!isOpaqueCanvasPixel(clientX, clientY));
  }
});

window.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || !event.isPrimary || !isOpaqueCanvasPixel(event.clientX, event.clientY)) {
    return;
  }

  event.preventDefault();
  setMousePassthrough(false);
  if (usesDesktopWindowShape) {
    runDesktopCommand("start desktop drag", window.cyreneDesktop?.setDragActive(true));
  }
  freezeModelFocus();
  dragSession = {
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startScreenX: event.screenX,
    startScreenY: event.screenY,
    startModelOffsetX: modelOffsetX,
    startModelOffsetY: modelOffsetY,
    startedAt: performance.now(),
    lastScreenX: event.screenX,
    lastScreenY: event.screenY,
    hasDragged: false
  };
  canvas.setPointerCapture(event.pointerId);
});

window.addEventListener("pointermove", (event) => {
  const session = dragSession;
  if (!session || session.pointerId !== event.pointerId) {
    return;
  }

  const totalDeltaX = event.screenX - session.startScreenX;
  const totalDeltaY = event.screenY - session.startScreenY;
  if (!session.hasDragged && Math.hypot(totalDeltaX, totalDeltaY) < dragStartThresholdPx) {
    return;
  }

  event.preventDefault();
  if (!session.hasDragged) {
    session.hasDragged = true;
    enterDragPerformanceMode();
    feedbackSerial += 1;
    if (!usesDesktopWindowShape) {
      window.cyreneDesktop?.beginWindowDrag();
    }
  }
  if (usesDesktopWindowShape) {
    modelOffsetX = session.startModelOffsetX + event.clientX - session.startClientX;
    modelOffsetY = session.startModelOffsetY + event.clientY - session.startClientY;
    clampModelOffsetToViewport();
    applyModelTransform();
    scheduleWindowShapeUpdate();
  }
  session.lastScreenX = event.screenX;
  session.lastScreenY = event.screenY;
});

window.addEventListener("pointerup", (event) => {
  finishDragSession(event);
});

window.addEventListener("pointercancel", (event) => {
  cancelDragSession(event.pointerId);
});

window.addEventListener("blur", () => {
  cancelDragSession();
});

window.addEventListener("wheel", (event) => {
  if (dragSession) {
    event.preventDefault();
    return;
  }

  if (!isOpaqueCanvasPixel(event.clientX, event.clientY)) {
    return;
  }

  event.preventDefault();
  const requestedScale = userScale * Math.exp(-event.deltaY * wheelZoomSensitivity);
  const nextScale = clampUserScaleToViewport(requestedScale);
  if (Math.abs(nextScale - userScale) < 0.001) {
    return;
  }

  userScale = nextScale;
  applyModelTransform();
  showScaleFeedback();
  scheduleHitAlphaRefresh();
}, { passive: false });

async function loadDesktopTrayIcon(iconPath: string | undefined): Promise<void> {
  const desktop = window.cyreneDesktop;
  if (!desktop || !iconPath) {
    return;
  }

  try {
    const response = await fetch(`${packBaseUrl}/${iconPath}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    await desktop.setTrayIcon(new Uint8Array(await response.arrayBuffer()));
  } catch (error) {
    console.error(`Failed to load model tray icon "${iconPath}".`, error);
  }
}

function createModelMotionCatalog(
  motions: readonly Live2DMotionEntry[]
): ReadonlyMap<string, Live2DModelMotionEntry> {
  const catalog = new Map<string, Live2DModelMotionEntry>();
  for (const motion of motions) {
    const entry: Live2DModelMotionEntry = removeUndefined({
      name: motion.name,
      file: motion.file,
      expression: motion.expression
    }) as Live2DModelMotionEntry;
    catalog.set(getMotionCatalogKey(motion.group, motion.index), entry);
    if (motion.name) {
      catalog.set(getMotionCatalogKey(motion.group, motion.name), entry);
    }
  }

  return catalog;
}

function initializeDesktopModelLayout(): void {
  if (!usesDesktopWindowShape) {
    return;
  }

  layoutWidth = Math.min(desktopModelBoxWidth, Math.max(320, window.innerWidth - desktopModelMargin * 2));
  layoutHeight = Math.min(desktopModelBoxHeight, Math.max(360, window.innerHeight - desktopModelMargin * 2));
  // The first transform clamps these values to the visible model's right and
  // bottom limits, so the initial placement has no transparent canvas gap.
  modelOffsetX = Number.POSITIVE_INFINITY;
  modelOffsetY = Number.POSITIVE_INFINITY;
}

function fitModel(): void {
  baseModelScale = Math.min(
    layoutWidth / modelNaturalBounds.width,
    layoutHeight / modelNaturalBounds.height
  ) * characterRuntime.layout.fitScale;
  applyModelTransform();
}

function applyModelTransform(): void {
  if (usesDesktopWindowShape) {
    userScale = clampUserScaleToViewport(userScale);
    clampModelOffsetToViewport();
  }

  const scale = baseModelScale * userScale;
  model.scale.set(scale);
  model.x = modelOffsetX + characterRuntime.layout.offsetX + (layoutWidth - modelNaturalBounds.width * scale) / 2 - modelNaturalBounds.x * scale;
  model.y = modelOffsetY + characterRuntime.layout.offsetY + layoutHeight - (modelNaturalBounds.y + modelNaturalBounds.height) * scale;
  updateScaleFeedbackPosition();
  scheduleWindowShapeUpdate();
  if (showHitDebug) {
    drawHitBoundary();
  }
}

function clampModelOffsetToViewport(): void {
  if (!usesDesktopWindowShape) {
    return;
  }

  const scale = baseModelScale * userScale;
  const modelWidth = modelNaturalBounds.width * scale;
  const modelHeight = modelNaturalBounds.height * scale;
  const offset = constrainModelOffsetToViewport({
    offsetX: modelOffsetX,
    offsetY: modelOffsetY,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    layoutWidth,
    layoutHeight,
    modelWidth,
    modelHeight
  });

  modelOffsetX = offset.x;
  modelOffsetY = offset.y;
}

function clampUserScaleToViewport(requestedScale: number): number {
  if (!usesDesktopWindowShape || baseModelScale <= 0) {
    return clamp(requestedScale, minUserScale, maxUserScale);
  }

  return constrainUserScaleToViewport({
    requestedScale,
    minScale: minUserScale,
    maxScale: maxUserScale,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    naturalModelWidth: modelNaturalBounds.width,
    naturalModelHeight: modelNaturalBounds.height,
    baseModelScale
  });
}

function getModelNaturalBounds(): ModelNaturalBounds {
  const displayObject = model as unknown as PIXI.DisplayObject;
  const canvasBounds = displayObject.getLocalBounds();
  const internalModel = model.internalModel;
  const drawableIds = internalModel?.getDrawableIDs?.() ?? [];
  const getDrawableBounds = internalModel?.getDrawableBounds;
  if (!getDrawableBounds || drawableIds.length === 0) {
    return toSafeModelBounds(canvasBounds);
  }

  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < drawableIds.length; index += 1) {
    const bounds = getDrawableBounds.call(internalModel, index);
    if (
      !Number.isFinite(bounds.x) ||
      !Number.isFinite(bounds.y) ||
      !Number.isFinite(bounds.width) ||
      !Number.isFinite(bounds.height) ||
      bounds.width <= 0 ||
      bounds.height <= 0
    ) {
      continue;
    }

    left = Math.min(left, bounds.x);
    top = Math.min(top, bounds.y);
    right = Math.max(right, bounds.x + bounds.width);
    bottom = Math.max(bottom, bounds.y + bounds.height);
  }

  if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(right) || !Number.isFinite(bottom)) {
    return toSafeModelBounds(canvasBounds);
  }

  return {
    x: left,
    y: top,
    width: Math.max(right - left, 1),
    height: Math.max(bottom - top, 1)
  };
}

function toSafeModelBounds(bounds: PIXI.Rectangle): ModelNaturalBounds {
  return {
    x: bounds.x,
    y: bounds.y,
    width: Math.max(bounds.width, 1),
    height: Math.max(bounds.height, 1)
  };
}

function updateModelFocus(clientX: number, clientY: number): void {
  model.focus(clientX, clientY);
}

function recordPetDebugSnapshot(reason: string): void {
  const displayObject = model as unknown as PIXI.DisplayObject;
  const bounds = displayObject.getBounds();
  const focusController = model.internalModel?.focusController;
  window.cyreneDesktop?.recordPetDebugSnapshot({
    reason,
    timestamp: performance.now(),
    window: {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio
    },
    renderer: {
      width: app.renderer.width,
      height: app.renderer.height,
      resolution: app.renderer.resolution
    },
    model: {
      x: model.x,
      y: model.y,
      width: model.width,
      height: model.height,
      scaleX: displayObject.scale.x,
      scaleY: displayObject.scale.y,
      bounds: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height
      },
      naturalBounds: modelNaturalBounds,
      baseModelScale,
      userScale,
      layoutWidth,
      layoutHeight,
      modelOffsetX,
      modelOffsetY
    },
    focus: focusController ? {
      targetX: focusController.targetX,
      targetY: focusController.targetY,
      x: focusController.x,
      y: focusController.y,
      vx: focusController.vx,
      vy: focusController.vy
    } : null,
    dragSession: dragSession ? {
      startClientX: dragSession.startClientX,
      startClientY: dragSession.startClientY,
      startScreenX: dragSession.startScreenX,
      startScreenY: dragSession.startScreenY,
      lastScreenX: dragSession.lastScreenX,
      lastScreenY: dragSession.lastScreenY,
      heldMs: performance.now() - dragSession.startedAt,
      hasDragged: dragSession.hasDragged
    } : null,
    isDragPerformanceMode,
    usesDesktopWindowShape,
    lastPassthroughState
  });
}

function freezeModelFocus(): void {
  const focusController = model.internalModel?.focusController;
  if (!focusController) {
    return;
  }

  focusController.targetX = focusController.x;
  focusController.targetY = focusController.y;
  focusController.vx = 0;
  focusController.vy = 0;
}

function finishDragSession(event: PointerEvent): void {
  const session = dragSession;
  if (!session || session.pointerId !== event.pointerId) {
    return;
  }

  dragSession = null;
  if (usesDesktopWindowShape) {
    runDesktopCommand("finish desktop drag", window.cyreneDesktop?.setDragActive(false));
  }
  if (session.hasDragged && !usesDesktopWindowShape) {
    window.cyreneDesktop?.endWindowDrag();
  }
  exitDragPerformanceMode();
  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }

  const totalDeltaX = event.screenX - session.startScreenX;
  const totalDeltaY = event.screenY - session.startScreenY;
  const heldMs = performance.now() - session.startedAt;
  if (
    session.hasDragged ||
    heldMs >= longPressClickSuppressMs ||
    Math.hypot(totalDeltaX, totalDeltaY) >= dragStartThresholdPx
  ) {
    event.preventDefault();
    syncMousePassthroughAtClientPoint(event.clientX, event.clientY);
    return;
  }

  const region = getInteractionRegionAtClientPoint(session.startClientX, session.startClientY);
  if (region) {
    event.preventDefault();
    void playFeedbackAction(region);
  }
  syncMousePassthroughAtClientPoint(event.clientX, event.clientY);
}

function cancelDragSession(pointerId?: number): void {
  const session = dragSession;
  if (!session || (pointerId !== undefined && session.pointerId !== pointerId)) {
    return;
  }

  dragSession = null;
  if (usesDesktopWindowShape) {
    runDesktopCommand("cancel desktop drag", window.cyreneDesktop?.setDragActive(false));
  }
  if (session.hasDragged && !usesDesktopWindowShape) {
    window.cyreneDesktop?.endWindowDrag();
  }
  exitDragPerformanceMode();
  if (canvas.hasPointerCapture(session.pointerId)) {
    canvas.releasePointerCapture(session.pointerId);
  }
  syncMousePassthroughAtClientPoint(session.startClientX, session.startClientY);
}

function enterDragPerformanceMode(): void {
  if (isDragPerformanceMode) {
    return;
  }

  isDragPerformanceMode = true;
  petRoot.classList.add("is-dragging");
  if (hitAlphaRefreshFrame !== null) {
    window.cancelAnimationFrame(hitAlphaRefreshFrame);
    hitAlphaRefreshFrame = null;
  }
}

function exitDragPerformanceMode(): void {
  if (!isDragPerformanceMode) {
    return;
  }

  isDragPerformanceMode = false;
  petRoot.classList.remove("is-dragging");
  scheduleHitAlphaRefresh();
}

function showScaleFeedback(): void {
  scaleFeedback.textContent = `${Math.round(userScale * 100)}%`;
  updateScaleFeedbackPosition();
  scaleFeedback.classList.add("is-visible");

  if (scaleFeedbackTimer !== null) {
    window.clearTimeout(scaleFeedbackTimer);
  }

  scaleFeedbackTimer = window.setTimeout(() => {
    scaleFeedback.classList.remove("is-visible");
    scaleFeedbackTimer = null;
  }, scaleFeedbackVisibleMs);
}

function updateScaleFeedbackPosition(): void {
  const bounds = getModelBounds();
  scaleFeedback.style.left = `${bounds.x + bounds.width / 2}px`;
  scaleFeedback.style.top = `${Math.min(bounds.y + bounds.height + 8, window.innerHeight - 28)}px`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

async function playFeedbackAction(region: InteractionRegion): Promise<void> {
  const feedbackAction = interactionActionBindings[region.id] ?? region.feedback.action;
  if (!feedbackAction) {
    console.info("Cyrene hit region is not bound", {
      id: region.id,
      label: region.label,
      semanticEvent: region.semanticEvent
    });
    return;
  }

  const mapping = actionMap.actions[feedbackAction];
  if (!mapping) {
    console.warn(`Missing feedback action mapping: ${feedbackAction}`);
    return;
  }

  const serial = ++feedbackSerial;

  console.info("Cyrene hit region", {
    id: region.id,
    label: region.label,
    semanticEvent: region.semanticEvent,
    action: feedbackAction
  });

  scheduleHitAlphaRefresh();
  try {
    await playMappedAction(feedbackAction, mapping, new Set(), serial);
  } finally {
    scheduleHitAlphaRefresh();
  }
}

async function playMappedAction(
  action: string,
  mapping: Live2DActionMapping,
  visitedActions: Set<string>,
  serial: number
): Promise<void> {
  if (feedbackSerial !== serial) {
    return;
  }

  if (visitedActions.has(action)) {
    console.warn(`Skipped cyclic feedback after-action: ${action}`);
    return;
  }
  visitedActions.add(action);

  let waitsForCompletion = false;
  if (mapping.motionGroup) {
    waitsForCompletion = await playMappedMotion(mapping, serial);
  }

  if (mapping.expression) {
    await model.expression(mapping.expression);
  }

  if (!mapping.after) {
    return;
  }

  if (!waitsForCompletion) {
    await delay(feedbackHoldMs);
  }

  if (feedbackSerial !== serial) {
    return;
  }

  const afterMapping = actionMap.actions[mapping.after];
  if (!afterMapping) {
    console.warn(`Missing feedback after-action mapping: ${mapping.after}`);
    return;
  }

  await playMappedAction(mapping.after, afterMapping, visitedActions, serial);
}

async function playMappedMotion(mapping: Live2DActionMapping, serial: number): Promise<boolean> {
  if (!mapping.motionGroup) {
    return false;
  }

  const motionEntry = getMappedMotionEntry(mapping);
  if (motionEntry && !motionEntry.file && motionEntry.expression) {
    await model.expression(motionEntry.expression);
    return false;
  }

  const started = await model.motion(mapping.motionGroup, mapping.motionIndex, mapping.priority ?? MotionPriority.FORCE);
  if (!started) {
    return false;
  }

  await waitForMotionFinish(serial);
  return true;
}

function getMappedMotionEntry(mapping: Live2DActionMapping): Live2DModelMotionEntry | undefined {
  if (!mapping.motionGroup) {
    return undefined;
  }

  if (mapping.motionIndex !== undefined) {
    return modelMotionCatalog.get(getMotionCatalogKey(mapping.motionGroup, mapping.motionIndex));
  }

  if (mapping.motionName) {
    return modelMotionCatalog.get(getMotionCatalogKey(mapping.motionGroup, mapping.motionName));
  }

  return undefined;
}

function getMotionCatalogKey(group: string, key: number | string): string {
  return `${group}:${key}`;
}

function waitForMotionFinish(serial: number): Promise<void> {
  const motionManager = model.internalModel?.motionManager as MotionManagerWithEvents | undefined;
  const once = motionManager?.once;
  if (!once) {
    return delay(feedbackHoldMs);
  }

  return new Promise((resolve) => {
    let settled = false;
    let timeout: number | null = null;
    let cancellationPoll: number | null = null;
    const onMotionFinish = () => finish();

    const finish = () => {
      if (settled) {
        return;
      }

      settled = true;
      if (timeout !== null) {
        window.clearTimeout(timeout);
      }
      if (cancellationPoll !== null) {
        window.clearTimeout(cancellationPoll);
      }
      motionManager.off?.call(motionManager, "motionFinish", onMotionFinish);
      resolve();
    };

    timeout = window.setTimeout(finish, 3000);
    once.call(motionManager, "motionFinish", onMotionFinish);

    const checkCanceled = () => {
      if (feedbackSerial !== serial) {
        finish();
        return;
      }
      cancellationPoll = window.setTimeout(checkCanceled, 50);
    };
    checkCanceled();
  });
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  ) as T;
}

function setMousePassthrough(value: boolean): void {
  if (usesDesktopWindowShape) {
    return;
  }

  if (lastPassthroughState === value) {
    return;
  }

  lastPassthroughState = value;
  runDesktopCommand(
    `set mouse passthrough to ${String(value)}`,
    window.cyreneDesktop?.setMousePassthrough(value)
  );
}

function runDesktopCommand(operation: string, command: Promise<void> | undefined): void {
  void command?.catch((error) => {
    console.error(`Failed to ${operation}.`, error);
  });
}

function syncMousePassthroughAtClientPoint(clientX: number, clientY: number): void {
  setMousePassthrough(!isOpaqueCanvasPixel(clientX, clientY));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function scheduleWindowShapeUpdate(): void {
  if (!usesDesktopWindowShape || windowShapeFrame !== null) {
    return;
  }

  windowShapeFrame = window.requestAnimationFrame(() => {
    windowShapeFrame = null;
    updateWindowShape();
  });
}

function updateWindowShape(): void {
  const desktop = window.cyreneDesktop;
  if (!usesDesktopWindowShape || !desktop) {
    return;
  }

  const bounds = getModelBounds();
  const x = Math.floor(Math.max(0, bounds.x - desktopShapePadding));
  const y = Math.floor(Math.max(0, bounds.y - desktopShapePadding));
  const right = Math.ceil(Math.min(window.innerWidth, bounds.x + bounds.width + desktopShapePadding));
  const bottom = Math.ceil(Math.min(window.innerHeight, bounds.y + bounds.height + desktopShapePadding));
  const rect = {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y)
  };
  const signature = `${rect.x},${rect.y},${rect.width},${rect.height}`;
  if (signature === lastWindowShapeSignature) {
    return;
  }

  if (windowShapeUpdateInFlight) {
    windowShapeUpdateQueued = true;
    return;
  }

  lastWindowShapeSignature = signature;
  windowShapeUpdateInFlight = true;
  void desktop.setWindowShape([rect])
    .catch((error) => {
      lastWindowShapeSignature = "";
      runDesktopCommand("enable mouse passthrough after a window-shape failure", desktop.setMousePassthrough(true));
      console.error("Failed to update desktop pet input shape.", error);
    })
    .finally(() => {
      windowShapeUpdateInFlight = false;
      if (windowShapeUpdateQueued) {
        windowShapeUpdateQueued = false;
        scheduleWindowShapeUpdate();
      }
    });
}

function isOpaqueCanvasPixel(clientX: number, clientY: number): boolean {
  const rect = canvas.getBoundingClientRect();
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
    return false;
  }

  const x = Math.floor((clientX - rect.left) * app.renderer.resolution);
  const y = Math.floor((clientY - rect.top) * app.renderer.resolution);

  if (!hitAlphaCache) {
    return isPointInsideModelBounds(clientX, clientY);
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

function isPointInsideModelBounds(clientX: number, clientY: number): boolean {
  const bounds = getModelBounds();
  return (
    clientX >= bounds.x &&
    clientX <= bounds.x + bounds.width &&
    clientY >= bounds.y &&
    clientY <= bounds.y + bounds.height
  );
}

function getInteractionRegionAtClientPoint(clientX: number, clientY: number): InteractionRegion | null {
  if (!isOpaqueCanvasPixel(clientX, clientY)) {
    return null;
  }

  const modelBounds = getModelBounds();
  for (const region of interactionPreset.interactionRegions) {
    if (isPointInRegionShape(clientX, clientY, region.shape, modelBounds)) {
      return region;
    }
  }

  return null;
}

function getModelBounds(): PIXI.Rectangle {
  const scale = baseModelScale * userScale;
  return new PIXI.Rectangle(
    model.x + modelNaturalBounds.x * scale,
    model.y + modelNaturalBounds.y * scale,
    modelNaturalBounds.width * scale,
    modelNaturalBounds.height * scale
  );
}

function getRegionClientRect(shape: InteractionRegionRect, modelBounds: PIXI.Rectangle): PIXI.Rectangle {
  return new PIXI.Rectangle(
    modelBounds.x + modelBounds.width * shape.x,
    modelBounds.y + modelBounds.height * shape.y,
    modelBounds.width * shape.width,
    modelBounds.height * shape.height
  );
}

function getRegionClientPolygon(shape: InteractionRegionPolygon, modelBounds: PIXI.Rectangle): readonly PIXI.Point[] {
  return shape.points.map((point) => new PIXI.Point(
    modelBounds.x + modelBounds.width * point.x,
    modelBounds.y + modelBounds.height * point.y
  ));
}

function isPointInRegionShape(
  clientX: number,
  clientY: number,
  shape: InteractionRegionShape,
  modelBounds: PIXI.Rectangle
): boolean {
  if (shape.type === "rect") {
    const rect = getRegionClientRect(shape, modelBounds);
    return (
      clientX >= rect.x &&
      clientX <= rect.x + rect.width &&
      clientY >= rect.y &&
      clientY <= rect.y + rect.height
    );
  }

  return isPointInPolygon(clientX, clientY, getRegionClientPolygon(shape, modelBounds));
}

function isPointInPolygon(x: number, y: number, points: readonly PIXI.Point[]): boolean {
  let inside = false;
  for (let index = 0, previousIndex = points.length - 1; index < points.length; previousIndex = index, index += 1) {
    const point = points[index];
    const previousPoint = points[previousIndex];
    if (!point || !previousPoint) {
      continue;
    }

    const intersects = ((point.y > y) !== (previousPoint.y > y)) &&
      (x < ((previousPoint.x - point.x) * (y - point.y)) / (previousPoint.y - point.y) + point.x);
    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
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

function scheduleHitAlphaRefresh(): void {
  if (isDragPerformanceMode || (usesDesktopWindowShape && !showHitDebug)) {
    return;
  }

  if (hitAlphaRefreshFrame !== null) {
    return;
  }

  hitAlphaRefreshFrame = window.requestAnimationFrame(() => {
    hitAlphaRefreshFrame = null;
    refreshInteractionHitCache();
  });
}

function refreshInteractionHitCache(): void {
  if (isDragPerformanceMode || (usesDesktopWindowShape && !showHitDebug)) {
    return;
  }

  if (refreshHitAlphaCache()) {
    if (showHitDebug) {
      drawHitBoundary();
    }
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
  drawInteractionRegions();
}

function drawInteractionRegions(): void {
  if (!hitOverlayContext) {
    return;
  }

  const renderer = app.renderer as PIXI.Renderer;
  const modelBounds = getModelBounds();
  hitOverlayContext.save();
  hitOverlayContext.scale(renderer.resolution, renderer.resolution);
  hitOverlayContext.strokeStyle = regionBoundaryColor;
  hitOverlayContext.fillStyle = regionBoundaryColor;
  hitOverlayContext.lineWidth = 1.5;
  hitOverlayContext.font = "12px sans-serif";
  hitOverlayContext.globalAlpha = 0.92;

  for (const region of interactionPreset.interactionRegions) {
    const labelPoint = drawRegionShape(region.shape, modelBounds);
    hitOverlayContext.fillText(region.label, labelPoint.x + 6, labelPoint.y + 16);
  }

  hitOverlayContext.restore();
}

function drawRegionShape(shape: InteractionRegionShape, modelBounds: PIXI.Rectangle): PIXI.Point {
  if (!hitOverlayContext) {
    return new PIXI.Point(0, 0);
  }

  if (shape.type === "rect") {
    const rect = getRegionClientRect(shape, modelBounds);
    hitOverlayContext.strokeRect(rect.x, rect.y, rect.width, rect.height);
    return new PIXI.Point(rect.x, rect.y);
  }

  const points = getRegionClientPolygon(shape, modelBounds);
  const firstPoint = points[0];
  if (!firstPoint) {
    return new PIXI.Point(0, 0);
  }

  hitOverlayContext.beginPath();
  hitOverlayContext.moveTo(firstPoint.x, firstPoint.y);
  for (const point of points.slice(1)) {
    hitOverlayContext.lineTo(point.x, point.y);
  }
  hitOverlayContext.closePath();
  hitOverlayContext.stroke();

  return new PIXI.Point(
    Math.min(...points.map((point) => point.x)),
    Math.min(...points.map((point) => point.y))
  );
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
