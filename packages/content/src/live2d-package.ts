import type { ContentPackManifest } from "@cyrene/shared-types";
import type { Live2DActionContract } from "./live2d-actions.js";
import type { Live2DActionMapContract } from "./live2d-actions.js";
import { ContractValidationError } from "./validation.js";

export interface ParsedLive2DModelPackage {
  readonly modelId: string;
  readonly modelJsonPath: string;
  readonly actionMap: Record<string, Live2DActionContract>;
}

export function createLive2DModelPackage(
  manifest: ContentPackManifest,
  actionMap: Live2DActionMapContract
): ParsedLive2DModelPackage {
  if (manifest.type !== "pet-model") {
    throw new ContractValidationError("expected pet-model content pack", "content-pack.json.type");
  }

  if (manifest.renderer !== "live2d") {
    throw new ContractValidationError("expected live2d renderer", "content-pack.json.renderer");
  }

  return {
    modelId: manifest.id,
    modelJsonPath: manifest.entry,
    actionMap: actionMap.actions
  };
}
