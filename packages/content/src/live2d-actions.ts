import type { JsonObject } from "@cyrene/shared-types";
import {
  ContractValidationError,
  isObject,
  requireNumber,
  requireObject,
  requireString,
  requireStringArray
} from "./validation.js";

export interface Live2DActionContract {
  readonly motionGroup?: string;
  readonly motionName?: string;
  readonly motionIndex?: number;
  readonly expression?: string;
  readonly priority?: number;
  readonly parameters?: Record<string, number>;
  readonly after?: string;
}

export interface Live2DHitAreaContract {
  readonly semanticEvent: string;
  readonly live2dId: string;
}

export interface Live2DInteractionRegionRectContract {
  readonly type: "rect";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Live2DInteractionRegionPolygonPointContract {
  readonly x: number;
  readonly y: number;
}

export interface Live2DInteractionRegionPolygonContract {
  readonly type: "polygon";
  readonly points: readonly Live2DInteractionRegionPolygonPointContract[];
}

export type Live2DInteractionRegionShapeContract =
  | Live2DInteractionRegionRectContract
  | Live2DInteractionRegionPolygonContract;

export interface Live2DInteractionRegionFeedbackContract {
  readonly action: string | null;
  readonly suggestedActions: readonly string[];
}

export interface Live2DInteractionRegionContract {
  readonly label: string;
  readonly semanticEvent: string;
  readonly shape: Live2DInteractionRegionShapeContract;
  readonly feedback: Live2DInteractionRegionFeedbackContract;
  readonly priority?: number;
}

export interface Live2DActionMapContract {
  readonly actions: Record<string, Live2DActionContract>;
  readonly hitAreas: Record<string, Live2DHitAreaContract>;
  readonly interactionRegions: Record<string, Live2DInteractionRegionContract>;
}

export interface Live2DInteractionPresetContract {
  readonly version: number;
  readonly name: string;
  readonly description?: string;
  readonly interactionRegions: Record<string, Live2DInteractionRegionContract>;
}

export function parseLive2DActionMap(value: unknown): Live2DActionMapContract {
  const object = requireObject(value, "cyrene-actions.json");
  const actionsObject = requireObject(object.actions, "cyrene-actions.json.actions");
  const hitAreasObject = object.hitAreas === undefined
    ? {}
    : requireObject(object.hitAreas, "cyrene-actions.json.hitAreas");
  const interactionRegionsObject = object.interactionRegions === undefined
    ? {}
    : requireObject(object.interactionRegions, "cyrene-actions.json.interactionRegions");

  const actions: Record<string, Live2DActionContract> = {};
  for (const [action, rawMapping] of Object.entries(actionsObject)) {
    if (!action.includes(".")) {
      throw new ContractValidationError(
        "semantic action names must use namespace.name format",
        `cyrene-actions.json.actions.${action}`
      );
    }

    const mapping = requireObject(rawMapping, `cyrene-actions.json.actions.${action}`);
    actions[action] = parseActionMapping(mapping, `cyrene-actions.json.actions.${action}`);
  }

  for (const [action, mapping] of Object.entries(actions)) {
    if (mapping.after !== undefined) {
      requireAction(actions, mapping.after, `cyrene-actions.json.actions.${action}.after`);
    }
  }

  const hitAreas: Record<string, Live2DHitAreaContract> = {};
  for (const [name, rawHitArea] of Object.entries(hitAreasObject)) {
    const hitArea = requireObject(rawHitArea, `cyrene-actions.json.hitAreas.${name}`);
    hitAreas[name] = {
      semanticEvent: requireString(hitArea.semanticEvent, `cyrene-actions.json.hitAreas.${name}.semanticEvent`),
      live2dId: requireString(hitArea.live2dId, `cyrene-actions.json.hitAreas.${name}.live2dId`)
    };
  }

  requireAction(actions, "idle.normal");
  requireAction(actions, "happy.react");

  const interactionRegions: Record<string, Live2DInteractionRegionContract> = {};
  for (const [name, rawRegion] of Object.entries(interactionRegionsObject)) {
    const region = requireObject(rawRegion, `cyrene-actions.json.interactionRegions.${name}`);
    const feedback = parseInteractionRegionFeedback(
      region.feedback,
      `cyrene-actions.json.interactionRegions.${name}.feedback`
    );
    if (feedback.action !== null) {
      requireAction(actions, feedback.action, `cyrene-actions.json.interactionRegions.${name}.feedback.action`);
    }

    interactionRegions[name] = {
      label: requireString(region.label, `cyrene-actions.json.interactionRegions.${name}.label`),
      semanticEvent: requireString(region.semanticEvent, `cyrene-actions.json.interactionRegions.${name}.semanticEvent`),
      shape: parseInteractionRegionShape(region.shape, `cyrene-actions.json.interactionRegions.${name}.shape`),
      feedback,
      ...(region.priority === undefined
        ? {}
        : { priority: requireNumber(region.priority, `cyrene-actions.json.interactionRegions.${name}.priority`) })
    };
  }

  return { actions, hitAreas, interactionRegions };
}

export function parseLive2DInteractionPreset(value: unknown): Live2DInteractionPresetContract {
  const object = requireObject(value, "cyrene-interactions.json");
  const interactionRegionsObject = requireObject(
    object.interactionRegions,
    "cyrene-interactions.json.interactionRegions"
  );

  const interactionRegions: Record<string, Live2DInteractionRegionContract> = {};
  for (const [name, rawRegion] of Object.entries(interactionRegionsObject)) {
    const region = requireObject(rawRegion, `cyrene-interactions.json.interactionRegions.${name}`);
    interactionRegions[name] = {
      label: requireString(region.label, `cyrene-interactions.json.interactionRegions.${name}.label`),
      semanticEvent: requireString(region.semanticEvent, `cyrene-interactions.json.interactionRegions.${name}.semanticEvent`),
      shape: parseInteractionRegionShape(region.shape, `cyrene-interactions.json.interactionRegions.${name}.shape`),
      feedback: parseInteractionRegionFeedback(
        region.feedback,
        `cyrene-interactions.json.interactionRegions.${name}.feedback`
      ),
      ...(region.priority === undefined
        ? {}
        : { priority: requireNumber(region.priority, `cyrene-interactions.json.interactionRegions.${name}.priority`) })
    };
  }

  return removeUndefined({
    version: requireNumber(object.version, "cyrene-interactions.json.version"),
    name: requireString(object.name, "cyrene-interactions.json.name"),
    description: object.description === undefined
      ? undefined
      : requireString(object.description, "cyrene-interactions.json.description"),
    interactionRegions
  }) as Live2DInteractionPresetContract;
}

export function validateLive2DInteractionPresetAgainstActions(
  preset: Live2DInteractionPresetContract,
  actionMap: Live2DActionMapContract
): void {
  for (const [name, region] of Object.entries(preset.interactionRegions)) {
    if (region.feedback.action !== null) {
      requireAction(
        actionMap.actions,
        region.feedback.action,
        `cyrene-interactions.json.interactionRegions.${name}.feedback.action`
      );
    }

    for (const [index, action] of region.feedback.suggestedActions.entries()) {
      requireAction(
        actionMap.actions,
        action,
        `cyrene-interactions.json.interactionRegions.${name}.feedback.suggestedActions[${index}]`
      );
    }
  }
}

function parseActionMapping(object: JsonObject, path: string): Live2DActionContract {
  const mapping: Live2DActionContract = {};

  if (object.motionGroup !== undefined) {
    Object.assign(mapping, { motionGroup: requireString(object.motionGroup, `${path}.motionGroup`) });
  }

  if (object.motionName !== undefined) {
    Object.assign(mapping, { motionName: requireString(object.motionName, `${path}.motionName`) });
  }

  if (object.motionIndex !== undefined) {
    Object.assign(mapping, { motionIndex: requireInteger(object.motionIndex, `${path}.motionIndex`) });
  }

  if (object.expression !== undefined) {
    Object.assign(mapping, { expression: requireString(object.expression, `${path}.expression`) });
  }

  if (object.priority !== undefined) {
    Object.assign(mapping, { priority: requireNumber(object.priority, `${path}.priority`) });
  }

  if (object.parameters !== undefined) {
    Object.assign(mapping, { parameters: parseParameters(object.parameters, `${path}.parameters`) });
  }

  if (object.after !== undefined) {
    Object.assign(mapping, { after: requireString(object.after, `${path}.after`) });
  }

  return mapping;
}

function parseInteractionRegionFeedback(value: unknown, path: string): Live2DInteractionRegionFeedbackContract {
  const feedback = requireObject(value, path);
  const action = feedback.action === null
    ? null
    : requireString(feedback.action, `${path}.action`);

  return {
    action,
    suggestedActions: feedback.suggestedActions === undefined
      ? []
      : requireStringArray(feedback.suggestedActions, `${path}.suggestedActions`)
  };
}

function parseParameters(value: unknown, path: string): Record<string, number> {
  if (!isObject(value)) {
    throw new ContractValidationError("expected parameter object", path);
  }

  const parameters: Record<string, number> = {};
  for (const [name, rawValue] of Object.entries(value)) {
    parameters[name] = requireNumber(rawValue, `${path}.${name}`);
  }

  return parameters;
}

function parseInteractionRegionShape(value: unknown, path: string): Live2DInteractionRegionShapeContract {
  const shape = requireObject(value, path);
  const type = requireString(shape.type, `${path}.type`);
  if (type === "rect") {
    return parseInteractionRegionRect(shape, path);
  }

  if (type === "polygon") {
    return parseInteractionRegionPolygon(shape, path);
  }

  throw new ContractValidationError("interaction region shape type must be rect or polygon", `${path}.type`);
}

function parseInteractionRegionRect(shape: JsonObject, path: string): Live2DInteractionRegionRectContract {
  const rect = {
    type: "rect",
    x: requireNumber(shape.x, `${path}.x`),
    y: requireNumber(shape.y, `${path}.y`),
    width: requireNumber(shape.width, `${path}.width`),
    height: requireNumber(shape.height, `${path}.height`)
  } as const;

  for (const key of ["x", "y", "width", "height"] as const) {
    if (rect[key] < 0 || rect[key] > 1) {
      throw new ContractValidationError("interaction region rect values must be normalized from 0 to 1", `${path}.${key}`);
    }
  }

  if (rect.width === 0 || rect.height === 0 || rect.x + rect.width > 1 || rect.y + rect.height > 1) {
    throw new ContractValidationError("interaction region rect must fit inside normalized model bounds", path);
  }

  return rect;
}

function parseInteractionRegionPolygon(shape: JsonObject, path: string): Live2DInteractionRegionPolygonContract {
  if (!Array.isArray(shape.points) || shape.points.length < 3) {
    throw new ContractValidationError("polygon interaction regions need at least 3 points", `${path}.points`);
  }

  return {
    type: "polygon",
    points: shape.points.map((rawPoint, index) => {
      const point = requireObject(rawPoint, `${path}.points.${index}`);
      return {
        x: requireNormalizedNumber(point.x, `${path}.points.${index}.x`),
        y: requireNormalizedNumber(point.y, `${path}.points.${index}.y`)
      };
    })
  };
}

function requireNormalizedNumber(value: unknown, path: string): number {
  const parsed = requireNumber(value, path);
  if (parsed < 0 || parsed > 1) {
    throw new ContractValidationError("interaction region values must be normalized from 0 to 1", path);
  }

  return parsed;
}

function requireInteger(value: unknown, path: string): number {
  const parsed = requireNumber(value, path);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new ContractValidationError("expected non-negative integer", path);
  }

  return parsed;
}

function requireAction(actions: Record<string, Live2DActionContract>, action: string, path = "cyrene-actions.json.actions"): void {
  if (!actions[action]) {
    throw new ContractValidationError(`required semantic action "${action}" is missing`, path);
  }
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  ) as T;
}
