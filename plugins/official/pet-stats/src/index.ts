import { definePlugin } from "@cyrene/sdk";

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

    ctx.capabilities.call("pet.stats.modify", {
      actorId: "bootstrap",
      moodDelta: 0
    }).catch(() => {
      // The real implementation is registered by the host once persistent storage lands.
    });

    ctx.events.emit("plugin.capability.desired", {
      pluginId: ctx.manifest.id,
      capability: "pet.stats.modify"
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
