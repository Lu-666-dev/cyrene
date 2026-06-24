import type { PetActorState } from "@cyrene/shared-types";
import type { CapabilityRegistry, EventBus } from "@cyrene/kernel";
import { PetActor } from "./pet-actor.js";

export class PetActorManager {
  private readonly actors = new Map<string, PetActor>();

  constructor(
    private readonly events: EventBus,
    private readonly capabilities: CapabilityRegistry
  ) {
    const kernelCapabilities = this.capabilities.scoped("kernel");

    kernelCapabilities.register<{ actorId: string }, PetActorState>("pet.actor.get", async ({ actorId }) => {
      if (typeof actorId !== "string") {
        throw new Error("actorId must be a string");
      }

      const actor = this.get(actorId);
      return actor.snapshot();
    });

    kernelCapabilities.register<
      { actorId: string; patch: Partial<Omit<PetActorState, "actorId" | "modelId">> },
      PetActorState
    >("pet.actor.patch", async ({ actorId, patch }) => {
      return this.get(actorId).updateState(patch);
    });
  }

  create(state: PetActorState): PetActor {
    if (this.actors.has(state.actorId)) {
      throw new Error(`Actor already exists: ${state.actorId}`);
    }

    const actor = new PetActor(state, this.events, this.capabilities);
    this.actors.set(state.actorId, actor);
    this.events.emit("pet.actor.created", state);
    return actor;
  }

  get(actorId: string): PetActor {
    const actor = this.actors.get(actorId);
    if (!actor) {
      throw new Error(`Actor not found: ${actorId}`);
    }

    return actor;
  }
}
