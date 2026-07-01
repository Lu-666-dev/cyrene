import { parseLive2DActionMap, parseLive2DInteractionPreset } from "./live2d-actions.js";
import type { Live2DActionMapContract, Live2DInteractionPresetContract } from "./live2d-actions.js";
import { ContractValidationError, requireNumber, requireObject } from "./validation.js";

export interface Live2DGlobalDefaults {
  readonly version: number;
  readonly input: {
    readonly alphaHitThreshold: number;
    readonly dragStartThresholdPx: number;
    readonly longPressClickSuppressMs: number;
  };
  readonly scale: {
    readonly min: number;
    readonly max: number;
    readonly wheelSensitivity: number;
    readonly feedbackVisibleMs: number;
  };
  readonly feedback: { readonly holdMs: number };
  readonly desktop: {
    readonly modelBoxWidth: number;
    readonly modelBoxHeight: number;
    readonly margin: number;
    readonly shapePadding: number;
  };
  readonly diagnostics: {
    readonly hitBoundarySampleStep: number;
    readonly hitBoundaryRefreshMs: number;
  };
}

export interface CharacterLive2DRuntime {
  readonly version: number;
  readonly layout: {
    readonly fitScale: number;
    readonly offsetX: number;
    readonly offsetY: number;
  };
  readonly actionMap: Live2DActionMapContract;
  readonly interactionPreset: Live2DInteractionPresetContract;
}

export function parseLive2DGlobalDefaults(value: unknown): Live2DGlobalDefaults {
  const object = requireObject(value, "live2d-defaults.json");
  const input = requireObject(object.input, "live2d-defaults.json.input");
  const scale = requireObject(object.scale, "live2d-defaults.json.scale");
  const feedback = requireObject(object.feedback, "live2d-defaults.json.feedback");
  const desktop = requireObject(object.desktop, "live2d-defaults.json.desktop");
  const diagnostics = requireObject(object.diagnostics, "live2d-defaults.json.diagnostics");
  const minScale = positive(scale.min, "live2d-defaults.json.scale.min");
  const maxScale = positive(scale.max, "live2d-defaults.json.scale.max");
  if (minScale > maxScale) throw new ContractValidationError("min must not exceed max", "live2d-defaults.json.scale");
  return {
    version: version(object.version, "live2d-defaults.json.version"),
    input: {
      alphaHitThreshold: range(input.alphaHitThreshold, 0, 255, "live2d-defaults.json.input.alphaHitThreshold"),
      dragStartThresholdPx: nonNegative(input.dragStartThresholdPx, "live2d-defaults.json.input.dragStartThresholdPx"),
      longPressClickSuppressMs: nonNegative(input.longPressClickSuppressMs, "live2d-defaults.json.input.longPressClickSuppressMs")
    },
    scale: {
      min: minScale,
      max: maxScale,
      wheelSensitivity: positive(scale.wheelSensitivity, "live2d-defaults.json.scale.wheelSensitivity"),
      feedbackVisibleMs: nonNegative(scale.feedbackVisibleMs, "live2d-defaults.json.scale.feedbackVisibleMs")
    },
    feedback: { holdMs: nonNegative(feedback.holdMs, "live2d-defaults.json.feedback.holdMs") },
    desktop: {
      modelBoxWidth: positive(desktop.modelBoxWidth, "live2d-defaults.json.desktop.modelBoxWidth"),
      modelBoxHeight: positive(desktop.modelBoxHeight, "live2d-defaults.json.desktop.modelBoxHeight"),
      margin: nonNegative(desktop.margin, "live2d-defaults.json.desktop.margin"),
      shapePadding: nonNegative(desktop.shapePadding, "live2d-defaults.json.desktop.shapePadding")
    },
    diagnostics: {
      hitBoundarySampleStep: positive(diagnostics.hitBoundarySampleStep, "live2d-defaults.json.diagnostics.hitBoundarySampleStep"),
      hitBoundaryRefreshMs: positive(diagnostics.hitBoundaryRefreshMs, "live2d-defaults.json.diagnostics.hitBoundaryRefreshMs")
    }
  };
}

export function parseCharacterLive2DRuntime(value: unknown): CharacterLive2DRuntime {
  const object = requireObject(value, "runtime.json");
  const layout = requireObject(object.layout, "runtime.json.layout");
  return {
    version: version(object.version, "runtime.json.version"),
    layout: {
      fitScale: positive(layout.fitScale, "runtime.json.layout.fitScale"),
      offsetX: requireNumber(layout.offsetX, "runtime.json.layout.offsetX"),
      offsetY: requireNumber(layout.offsetY, "runtime.json.layout.offsetY")
    },
    actionMap: parseLive2DActionMap({ actions: object.actions, hitAreas: object.hitAreas }),
    interactionPreset: parseLive2DInteractionPreset(object.interactions)
  };
}

function version(value: unknown, path: string): number {
  const parsed = requireNumber(value, path);
  if (parsed !== 1) throw new ContractValidationError("unsupported version", path);
  return parsed;
}

function positive(value: unknown, path: string): number {
  const parsed = requireNumber(value, path);
  if (parsed <= 0) throw new ContractValidationError("expected positive number", path);
  return parsed;
}

function nonNegative(value: unknown, path: string): number {
  const parsed = requireNumber(value, path);
  if (parsed < 0) throw new ContractValidationError("expected non-negative number", path);
  return parsed;
}

function range(value: unknown, min: number, max: number, path: string): number {
  const parsed = requireNumber(value, path);
  if (parsed < min || parsed > max) throw new ContractValidationError(`expected ${min}–${max}`, path);
  return parsed;
}
