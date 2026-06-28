import { CapabilityRegistry, EventBus, PluginRuntime } from "@cyrene/kernel";
import {
  createLive2DModelPackage,
  parseContentPackManifest,
  parseLive2DActionMap,
  parseLive2DInteractionPreset,
  parseLive2DModelSettingsCatalog,
  parseStoreListingManifest,
  validateLive2DActionMapAgainstModel,
  validateLive2DInteractionPresetAgainstActions,
  validateContentPackFiles
} from "@cyrene/content";
import { Live2DAdapter } from "@cyrene/renderer-live2d";
import { PetActorManager } from "@cyrene/runtime";
import feedingPlugin from "@cyrene/plugin-feeding";
import petStatsPlugin from "@cyrene/plugin-pet-stats";
import type { EventEnvelope, PluginManifest } from "@cyrene/shared-types";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const petStatsManifest: PluginManifest = {
  id: "official.pet-stats",
  name: "Pet Stats",
  version: "0.1.0",
  entry: "dist/index.js",
  permissions: [
    "events:emit",
    "capability:pet.actor.get",
    "capability:pet.actor.patch",
    "capability:pet.stats.modify"
  ],
  migrations: ["migrations/001_init.sql"]
};

const feedingManifest: PluginManifest = {
  id: "official.feeding",
  name: "Feeding",
  version: "0.1.0",
  entry: "dist/index.js",
  permissions: [
    "events:emit",
    "events:listen",
    "capability:pet.stats.modify",
    "capability:pet.animation.play"
  ],
  migrations: ["migrations/001_init.sql"]
};

const events = new EventBus();
const capabilities = new CapabilityRegistry();
const pluginRuntime = new PluginRuntime(events, capabilities);
const actorManager = new PetActorManager(events, capabilities);
const live2d = new Live2DAdapter(events, capabilities);

const timeline: Array<Pick<EventEnvelope, "name" | "source" | "payload">> = [];
for (const eventName of [
  "plugin.started",
  "pet.actor.created",
  "pet.state.changed",
  "pet.stats.modified",
  "renderer.live2d.loaded",
  "renderer.live2d.action.requested",
  "feeding.completed"
]) {
  events.on(eventName, (event) => {
    timeline.push({
      name: event.name,
      source: event.source,
      payload: event.payload
    });
  });
}

const modelPackRoot = resolve("pets/official/cyrene-live2d");
const storeListingRoot = resolve("store/official/cyrene-live2d");
const contentPack = parseContentPackManifest(
  await readJson(resolve(modelPackRoot, "content-pack.json"))
);
const actionMap = parseLive2DActionMap(
  await readJson(resolve(modelPackRoot, "cyrene-actions.json"))
);
const interactionPreset = parseLive2DInteractionPreset(
  await readJson(resolve(modelPackRoot, "cyrene-interactions.json"))
);
const modelCatalog = parseLive2DModelSettingsCatalog(
  await readJson(resolve(modelPackRoot, contentPack.entry))
);
const storeListing = parseStoreListingManifest(
  await readJson(resolve(storeListingRoot, "store-listing.json"))
);

validateContentPackFiles(contentPack, await listPackFiles(modelPackRoot));
validateLive2DActionMapAgainstModel(actionMap, modelCatalog);
validateLive2DInteractionPresetAgainstActions(interactionPreset, actionMap);
if (storeListing.packId !== contentPack.id) {
  throw new Error(`Store listing packId "${storeListing.packId}" does not match content pack "${contentPack.id}"`);
}

live2d.load(createLive2DModelPackage(contentPack, actionMap));

actorManager.create({
  actorId: "pet.default",
  modelId: contentPack.id,
  mood: 50,
  hunger: 35,
  energy: 80,
  affinity: 10,
  behavior: "idle.normal"
});

await pluginRuntime.start(petStatsManifest, petStatsPlugin);
await pluginRuntime.start(feedingManifest, feedingPlugin);

await events.emitAndWait("inventory.item.used", {
  actorId: "pet.default",
  itemId: "strawberry_milk",
  tags: ["food", "sweet"],
  nutrition: 12
});

const finalState = actorManager.get("pet.default").snapshot();

console.log(JSON.stringify(
  {
    ok: true,
    modelCatalog: {
      motions: modelCatalog.motions.length,
      expressions: modelCatalog.expressions.length,
      hitAreas: modelCatalog.hitAreas.length
    },
    interactionRegions: Object.keys(interactionPreset.interactionRegions).length,
    finalState,
    timeline
  },
  null,
  2
));

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function listPackFiles(root: string): Promise<readonly string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
}
