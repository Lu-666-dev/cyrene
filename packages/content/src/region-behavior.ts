import type { PetBehaviorState, PetRegionBehavior } from "@cyrene/shared-types";
import { ContractValidationError, requireObject, requireString } from "./validation.js";
import type { Live2DModelSettingsCatalog } from "./live2d-model-settings.js";

export interface RegionBehaviorGroup {
  readonly areaId: string;
  readonly areaName: string;
  readonly behaviors: readonly PetRegionBehavior[];
}

export interface RegionBehaviorExtraction {
  readonly groups: readonly RegionBehaviorGroup[];
  readonly states: readonly PetBehaviorState[];
}

export interface ExpressionAreaHint {
  readonly areaId: string;
  readonly areaName: string;
  readonly parameterCount?: number;
}

export function createRegionBehaviorExtraction(
  catalog: Live2DModelSettingsCatalog,
  expressionAreas: Readonly<Record<string, ExpressionAreaHint>> = {}
): RegionBehaviorExtraction {
  const groups = new Map<string, { areaName: string; behaviors: PetRegionBehavior[] }>();
  const states: PetBehaviorState[] = [];
  const motionFiles = new Set<string>();

  for (const motion of catalog.motions) {
    if (!motion.file) {
      continue;
    }

    const label = motion.name ?? motion.file;
    if (isResetLabel(label)) {
      continue;
    }

    if (motionFiles.has(motion.file)) {
      continue;
    }
    motionFiles.add(motion.file);

    pushBehavior(groups, {
      id: `motion-file:${motion.group}:${motion.name ?? motion.file}`,
      areaId: "motion:body",
      areaName: "动作",
      label: normalizeMotionLabel(label),
      motionGroup: motion.group,
      ...(motion.name ? { motionName: motion.name } : {})
    });
  }

  for (const expression of catalog.expressions) {
    if (isResetLabel(expression.name)) {
      continue;
    }

    const area = expressionAreas[expression.name] ?? {
      areaId: `expression:${expression.name}`,
      areaName: expression.name,
      parameterCount: 1
    };
    const behavior: PetRegionBehavior = {
      id: `expression:${expression.name}`,
      areaId: area.areaId,
      areaName: area.areaName,
      label: expression.name,
      expression: expression.name
    };

    if ((area.parameterCount ?? 1) > 1) {
      states.push(createBehaviorState({
        id: `state:${expression.name}`,
        name: expression.name,
        behaviors: [behavior]
      }));
      continue;
    }

    pushBehavior(groups, {
      ...behavior
    });
  }

  return {
    groups: [...groups.entries()].map(([areaId, group]) => ({
      areaId,
      areaName: group.areaName,
      behaviors: dedupeBehaviors(group.behaviors)
    })),
    states
  };
}

export function createRegionBehaviorGroups(
  catalog: Live2DModelSettingsCatalog,
  expressionAreas: Readonly<Record<string, ExpressionAreaHint>> = {}
): readonly RegionBehaviorGroup[] {
  return createRegionBehaviorExtraction(catalog, expressionAreas).groups;
}

function isResetLabel(label: string): boolean {
  return label.includes("回正") || label === "开";
}

function normalizeMotionLabel(label: string): string {
  return label.replace(/（待机）/g, "").trim();
}

export function createBehaviorState(input: {
  readonly id: string;
  readonly name: string;
  readonly behaviors: readonly PetRegionBehavior[];
}): PetBehaviorState {
  const name = input.name.trim();
  if (!name) {
    throw new ContractValidationError("state name cannot be empty", "state.name");
  }

  if (input.behaviors.length === 0) {
    throw new ContractValidationError("state must include at least one region behavior", "state.behaviors");
  }

  const seenAreas = new Set<string>();
  for (const behavior of input.behaviors) {
    if (seenAreas.has(behavior.areaId)) {
      throw new ContractValidationError(
        `state includes more than one behavior for area "${behavior.areaName}"`,
        "state.behaviors"
      );
    }
    seenAreas.add(behavior.areaId);
  }

  return {
    id: requireString(input.id, "state.id"),
    name,
    behaviors: input.behaviors
  };
}

export function parseBehaviorStateCollection(value: unknown): {
  readonly modelId: string;
  readonly states: readonly PetBehaviorState[];
} {
  const object = requireObject(value, "behavior-states.json");
  const rawStates = object.states;

  if (!Array.isArray(rawStates)) {
    throw new ContractValidationError("expected state array", "behavior-states.json.states");
  }

  return {
    modelId: requireString(object.modelId, "behavior-states.json.modelId"),
    states: rawStates.map((rawState, index) => {
      const state = requireObject(rawState, `behavior-states.json.states[${index}]`);
      const behaviors = state.behaviors;
      if (!Array.isArray(behaviors)) {
        throw new ContractValidationError(
          "expected behavior array",
          `behavior-states.json.states[${index}].behaviors`
        );
      }

      return createBehaviorState({
        id: requireString(state.id, `behavior-states.json.states[${index}].id`),
        name: requireString(state.name, `behavior-states.json.states[${index}].name`),
        behaviors: behaviors.map((rawBehavior, behaviorIndex) => {
          const behavior = requireObject(
            rawBehavior,
            `behavior-states.json.states[${index}].behaviors[${behaviorIndex}]`
          );
          return removeUndefined({
            id: requireString(behavior.id, "behavior.id"),
            areaId: requireString(behavior.areaId, "behavior.areaId"),
            areaName: requireString(behavior.areaName, "behavior.areaName"),
            label: requireString(behavior.label, "behavior.label"),
            motionGroup: behavior.motionGroup === undefined
              ? undefined
              : requireString(behavior.motionGroup, "behavior.motionGroup"),
            motionName: behavior.motionName === undefined
              ? undefined
              : requireString(behavior.motionName, "behavior.motionName"),
            expression: behavior.expression === undefined
              ? undefined
              : requireString(behavior.expression, "behavior.expression")
          }) as PetRegionBehavior;
        })
      });
    })
  };
}

function pushBehavior(
  groups: Map<string, { areaName: string; behaviors: PetRegionBehavior[] }>,
  behavior: PetRegionBehavior
): void {
  const group = groups.get(behavior.areaId) ?? {
    areaName: behavior.areaName,
    behaviors: []
  };
  group.behaviors.push(behavior);
  groups.set(behavior.areaId, group);
}

function dedupeBehaviors(behaviors: readonly PetRegionBehavior[]): readonly PetRegionBehavior[] {
  const seen = new Set<string>();
  return behaviors.filter((behavior) => {
    const key = [
      behavior.areaId,
      behavior.label,
      behavior.motionGroup ?? "",
      behavior.motionName ?? "",
      behavior.expression ?? ""
    ].join("|");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  ) as T;
}
