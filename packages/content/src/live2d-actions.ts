import type { JsonObject } from "@cyrene/shared-types";
import {
  ContractValidationError,
  isObject,
  requireNumber,
  requireObject,
  requireString
} from "./validation.js";

export interface Live2DActionContract {
  readonly motionGroup?: string;
  readonly expression?: string;
  readonly priority?: number;
  readonly parameters?: Record<string, number>;
}

export interface Live2DHitAreaContract {
  readonly semanticEvent: string;
  readonly live2dId: string;
}

export interface Live2DActionMapContract {
  readonly actions: Record<string, Live2DActionContract>;
  readonly hitAreas: Record<string, Live2DHitAreaContract>;
}

export function parseLive2DActionMap(value: unknown): Live2DActionMapContract {
  const object = requireObject(value, "cyrene-actions.json");
  const actionsObject = requireObject(object.actions, "cyrene-actions.json.actions");
  const hitAreasObject = object.hitAreas === undefined
    ? {}
    : requireObject(object.hitAreas, "cyrene-actions.json.hitAreas");

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

  return { actions, hitAreas };
}

function parseActionMapping(object: JsonObject, path: string): Live2DActionContract {
  const mapping: Live2DActionContract = {};

  if (object.motionGroup !== undefined) {
    Object.assign(mapping, { motionGroup: requireString(object.motionGroup, `${path}.motionGroup`) });
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

  return mapping;
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

function requireAction(actions: Record<string, Live2DActionContract>, action: string): void {
  if (!actions[action]) {
    throw new ContractValidationError(`required semantic action "${action}" is missing`, "cyrene-actions.json.actions");
  }
}
