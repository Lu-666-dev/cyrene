import type { PetBehaviorFeedback } from "@cyrene/shared-types";
import { ContractValidationError, requireObject, requireString } from "./validation.js";
import type { Live2DModelSettingsCatalog } from "./live2d-model-settings.js";

export interface BehaviorFeedbackCollection {
  readonly modelId: string;
  readonly behaviors: readonly PetBehaviorFeedback[];
}

export function createBehaviorFeedback(input: {
  readonly id: string;
  readonly name: string;
  readonly motionGroup?: string;
  readonly expression?: string;
}): PetBehaviorFeedback {
  const name = input.name.trim();
  if (name.length === 0) {
    throw new ContractValidationError("behavior name cannot be empty", "behavior.name");
  }

  if (!input.motionGroup && !input.expression) {
    throw new ContractValidationError(
      "behavior must include a motion group, an expression, or both",
      "behavior"
    );
  }

  return removeUndefined({
    id: requireString(input.id, "behavior.id"),
    name,
    motionGroup: input.motionGroup,
    expression: input.expression
  }) as PetBehaviorFeedback;
}

export function parseBehaviorFeedbackCollection(value: unknown): BehaviorFeedbackCollection {
  const object = requireObject(value, "behavior-feedback.json");
  const rawBehaviors = object.behaviors;

  if (!Array.isArray(rawBehaviors)) {
    throw new ContractValidationError("expected behavior array", "behavior-feedback.json.behaviors");
  }

  return {
    modelId: requireString(object.modelId, "behavior-feedback.json.modelId"),
    behaviors: rawBehaviors.map((rawBehavior, index) => {
      const behavior = requireObject(rawBehavior, `behavior-feedback.json.behaviors[${index}]`);
      const input = {
        id: requireString(behavior.id, `behavior-feedback.json.behaviors[${index}].id`),
        name: requireString(behavior.name, `behavior-feedback.json.behaviors[${index}].name`)
      };

      return createBehaviorFeedback({
        ...input,
        ...(behavior.motionGroup === undefined
          ? {}
          : { motionGroup: requireString(behavior.motionGroup, `behavior-feedback.json.behaviors[${index}].motionGroup`) }),
        ...(behavior.expression === undefined
          ? {}
          : { expression: requireString(behavior.expression, `behavior-feedback.json.behaviors[${index}].expression`) })
      });
    })
  };
}

export function validateBehaviorFeedbackAgainstModel(
  behavior: PetBehaviorFeedback,
  catalog: Live2DModelSettingsCatalog
): void {
  const motionGroups = new Set(catalog.motions.map((motion) => motion.group));
  const expressions = new Set(catalog.expressions.map((expression) => expression.name));

  if (behavior.motionGroup && !motionGroups.has(behavior.motionGroup)) {
    throw new ContractValidationError(
      `behavior "${behavior.name}" references unknown motion group "${behavior.motionGroup}"`,
      "behavior.motionGroup"
    );
  }

  if (behavior.expression && !expressions.has(behavior.expression)) {
    throw new ContractValidationError(
      `behavior "${behavior.name}" references unknown expression "${behavior.expression}"`,
      "behavior.expression"
    );
  }
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  ) as T;
}
