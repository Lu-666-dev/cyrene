export interface ModelOffsetConstraintInput {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly layoutWidth: number;
  readonly layoutHeight: number;
  readonly modelWidth: number;
  readonly modelHeight: number;
}

export interface ModelOffset {
  readonly x: number;
  readonly y: number;
}

export interface UserScaleConstraintInput {
  readonly requestedScale: number;
  readonly minScale: number;
  readonly maxScale: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly naturalModelWidth: number;
  readonly naturalModelHeight: number;
  readonly baseModelScale: number;
}

export function constrainModelOffsetToViewport(input: ModelOffsetConstraintInput): ModelOffset {
  const modelInsetX = (input.layoutWidth - input.modelWidth) / 2;

  // The offset belongs to the fixed layout box, so derive its allowed range
  // from the scaled model edges. A small model can then touch every viewport
  // edge, while a large model remains fully visible.
  const minOffsetX = -modelInsetX;
  const maxOffsetX = input.viewportWidth - input.modelWidth - modelInsetX;
  const minOffsetY = input.modelHeight - input.layoutHeight;
  const maxOffsetY = input.viewportHeight - input.layoutHeight;

  return {
    x: clamp(input.offsetX, minOffsetX, maxOffsetX),
    y: clamp(input.offsetY, minOffsetY, maxOffsetY)
  };
}

export function constrainUserScaleToViewport(input: UserScaleConstraintInput): number {
  const maxScaleForViewport = Math.min(
    input.viewportWidth / input.naturalModelWidth,
    input.viewportHeight / input.naturalModelHeight
  ) / input.baseModelScale;
  const effectiveMaxScale = Math.min(input.maxScale, maxScaleForViewport);
  const effectiveMinScale = Math.min(input.minScale, effectiveMaxScale);
  return clamp(input.requestedScale, effectiveMinScale, effectiveMaxScale);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
