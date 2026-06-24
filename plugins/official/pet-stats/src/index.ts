import { definePlugin } from "@cyrene/sdk";
import type { PetActorState } from "@cyrene/shared-types";

interface ModifyStatsInput {
  readonly actorId: string;
  readonly moodDelta?: number;
  readonly hungerDelta?: number;
  readonly energyDelta?: number;
  readonly affinityDelta?: number;
}

export default definePlugin({
  start(ctx) {
    ctx.log.info("Pet stats plugin started");

    ctx.capabilities.register<ModifyStatsInput, PetActorState>("pet.stats.modify", async (input) => {
      const normalized = normalizeModifyStatsInput(input);
      const current = await ctx.capabilities.call<{ actorId: string }, PetActorState>(
        "pet.actor.get",
        { actorId: normalized.actorId }
      );

      const next = await ctx.capabilities.call<
        { actorId: string; patch: Partial<Omit<PetActorState, "actorId" | "modelId">> },
        PetActorState
      >("pet.actor.patch", {
        actorId: normalized.actorId,
        patch: {
          mood: clampStat(current.mood + normalized.moodDelta),
          hunger: clampStat(current.hunger + normalized.hungerDelta),
          energy: clampStat(current.energy + normalized.energyDelta),
          affinity: clampStat(current.affinity + normalized.affinityDelta)
        }
      });

      await ctx.storage.set(`stats:${normalized.actorId}`, {
        actorId: next.actorId,
        mood: next.mood,
        hunger: next.hunger,
        energy: next.energy,
        affinity: next.affinity
      });
      ctx.events.emit("pet.stats.modified", {
        actorId: normalized.actorId,
        before: current,
        after: next
      });

      return next;
    });
  }
});

export function clampStat(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function normalizeModifyStatsInput(input: ModifyStatsInput): Required<ModifyStatsInput> {
  return {
    actorId: input.actorId,
    moodDelta: input.moodDelta ?? 0,
    hungerDelta: input.hungerDelta ?? 0,
    energyDelta: input.energyDelta ?? 0,
    affinityDelta: input.affinityDelta ?? 0
  };
}
