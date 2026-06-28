import type { Live2DActionMapContract } from "./live2d-actions.js";
import type { Live2DModelSettingsCatalog } from "./live2d-model-settings.js";
import { ContractValidationError } from "./validation.js";

export function validateLive2DActionMapAgainstModel(
  actionMap: Live2DActionMapContract,
  catalog: Live2DModelSettingsCatalog
): void {
  const motionGroups = new Set(catalog.motions.map((motion) => motion.group));
  const expressions = new Set(catalog.expressions.map((expression) => expression.name));
  const hitAreaIds = new Set(catalog.hitAreas.map((hitArea) => hitArea.id));
  const motionsByGroup = new Map<string, typeof catalog.motions>();
  for (const motion of catalog.motions) {
    motionsByGroup.set(motion.group, [...(motionsByGroup.get(motion.group) ?? []), motion]);
  }

  for (const [action, mapping] of Object.entries(actionMap.actions)) {
    if (mapping.motionGroup && !motionGroups.has(mapping.motionGroup)) {
      throw new ContractValidationError(
        `action "${action}" references unknown motion group "${mapping.motionGroup}"`,
        `cyrene-actions.json.actions.${action}.motionGroup`
      );
    }

    if (mapping.motionIndex !== undefined) {
      if (!mapping.motionGroup) {
        throw new ContractValidationError(
          `action "${action}" uses motionIndex without motionGroup`,
          `cyrene-actions.json.actions.${action}.motionIndex`
        );
      }

      const motion = motionsByGroup.get(mapping.motionGroup)?.find((entry) => entry.index === mapping.motionIndex);
      if (!motion) {
        throw new ContractValidationError(
          `action "${action}" references unknown motion index "${mapping.motionIndex}" in group "${mapping.motionGroup}"`,
          `cyrene-actions.json.actions.${action}.motionIndex`
        );
      }

      if (mapping.motionName && motion.name !== mapping.motionName) {
        throw new ContractValidationError(
          `action "${action}" motionName "${mapping.motionName}" does not match motion index "${mapping.motionIndex}"`,
          `cyrene-actions.json.actions.${action}.motionName`
        );
      }
    }

    if (mapping.motionName !== undefined && mapping.motionIndex === undefined) {
      if (!mapping.motionGroup) {
        throw new ContractValidationError(
          `action "${action}" uses motionName without motionGroup`,
          `cyrene-actions.json.actions.${action}.motionName`
        );
      }

      const motion = motionsByGroup.get(mapping.motionGroup)?.find((entry) => entry.name === mapping.motionName);
      if (!motion) {
        throw new ContractValidationError(
          `action "${action}" references unknown motion name "${mapping.motionName}" in group "${mapping.motionGroup}"`,
          `cyrene-actions.json.actions.${action}.motionName`
        );
      }
    }

    if (mapping.expression && !expressions.has(mapping.expression)) {
      throw new ContractValidationError(
        `action "${action}" references unknown expression "${mapping.expression}"`,
        `cyrene-actions.json.actions.${action}.expression`
      );
    }
  }

  for (const [name, hitArea] of Object.entries(actionMap.hitAreas)) {
    if (!hitAreaIds.has(hitArea.live2dId)) {
      throw new ContractValidationError(
        `hit area "${name}" references unknown Live2D hit area "${hitArea.live2dId}"`,
        `cyrene-actions.json.hitAreas.${name}.live2dId`
      );
    }
  }
}
