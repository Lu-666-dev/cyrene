import type { PetActionRequest, PetActorState } from "@cyrene/shared-types";
import type { CapabilityRegistry, EventBus } from "@cyrene/kernel";

export class PetActor {
  private state: PetActorState;

  constructor(
    initialState: PetActorState,
    private readonly events: EventBus,
    private readonly capabilities: CapabilityRegistry
  ) {
    this.state = initialState;
  }

  snapshot(): PetActorState {
    return this.state;
  }

  async react(request: PetActionRequest): Promise<void> {
    await this.capabilities.call("pet.animation.play", request);
    this.events.emit("pet.reacted", {
      actorId: request.actorId,
      action: request.action,
      reason: request.reason ?? null
    });
  }

  updateState(patch: Partial<Omit<PetActorState, "actorId" | "modelId">>): PetActorState {
    this.state = {
      ...this.state,
      ...patch
    };

    this.events.emit("pet.state.changed", this.state);
    return this.state;
  }
}
