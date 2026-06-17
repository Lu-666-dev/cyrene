import { definePlugin } from "@cyrene/sdk";

interface ItemUsedPayload {
  readonly actorId: string;
  readonly itemId: string;
  readonly tags?: readonly string[];
  readonly nutrition?: number;
}

export default definePlugin({
  start(ctx) {
    ctx.log.info("Feeding plugin started");

    ctx.events.on("inventory.item.used", async (event) => {
      const payload = event.payload as unknown as ItemUsedPayload;
      if (!payload.tags?.includes("food")) {
        return;
      }

      const nutrition = payload.nutrition ?? 8;
      await ctx.capabilities.call("pet.stats.modify", {
        actorId: payload.actorId,
        hungerDelta: nutrition,
        moodDelta: 3,
        affinityDelta: 1
      });

      await ctx.capabilities.call("pet.animation.play", {
        actorId: payload.actorId,
        action: "eat.accept",
        intensity: Math.min(1, nutrition / 20),
        reason: "feeding.completed"
      });

      ctx.events.emit("feeding.completed", {
        actorId: payload.actorId,
        itemId: payload.itemId,
        nutrition
      });
    });
  }
});
