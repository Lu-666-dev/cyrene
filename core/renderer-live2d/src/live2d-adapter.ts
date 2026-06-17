import type { CapabilityRegistry, EventBus } from "@cyrene/kernel";
import type { PetActionRequest } from "@cyrene/shared-types";

export interface Live2DActionMapping {
  readonly motionGroup?: string;
  readonly expression?: string;
  readonly priority?: number;
  readonly parameters?: Record<string, number>;
}

export interface Live2DModelPackage {
  readonly modelId: string;
  readonly modelJsonPath: string;
  readonly actionMap: Record<string, Live2DActionMapping>;
}

export class Live2DAdapter {
  private modelPackage: Live2DModelPackage | undefined;

  constructor(
    private readonly events: EventBus,
    capabilities: CapabilityRegistry
  ) {
    capabilities.register("kernel", "pet.animation.play", async (request) => {
      return this.play(request as unknown as PetActionRequest);
    });
  }

  load(modelPackage: Live2DModelPackage): void {
    this.modelPackage = modelPackage;
    this.events.emit("renderer.live2d.loaded", {
      modelId: modelPackage.modelId,
      modelJsonPath: modelPackage.modelJsonPath
    });
  }

  async play(request: PetActionRequest): Promise<{ ok: true }> {
    if (!this.modelPackage) {
      throw new Error("Live2D model package is not loaded");
    }

    const mapping = this.modelPackage.actionMap[request.action];
    if (!mapping) {
      throw new Error(`No Live2D mapping for action: ${request.action}`);
    }

    this.events.emit("renderer.live2d.action.requested", {
      actorId: request.actorId,
      action: request.action,
      intensity: request.intensity ?? 1,
      mapping
    });

    return { ok: true };
  }
}
