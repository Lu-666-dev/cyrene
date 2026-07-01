import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseContentPackManifest,
  parseCharacterChatProfile,
  parseCharacterLive2DRuntime,
  parseLive2DGlobalDefaults,
  parseLive2DModelSettingsCatalog,
  parseStoreListingManifest,
  validateContentPackFiles,
  validateLive2DActionMapAgainstModel,
  validateLive2DInteractionPresetAgainstActions
} from "../packages/content/dist/index.js";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modelPackRoot = path.join(workspaceRoot, "pets", "official", "cyrene-live2d");
const storeListingRoot = path.join(workspaceRoot, "store", "official", "cyrene-live2d");

const contentPack = parseContentPackManifest(await readJson(path.join(modelPackRoot, "content-pack.json")));
if (!contentPack.character) throw new Error("Cyrene content pack is missing character configuration paths");
const chatProfile = parseCharacterChatProfile(await readJson(path.join(modelPackRoot, contentPack.character.chat)));
const runtime = parseCharacterLive2DRuntime(await readJson(path.join(modelPackRoot, contentPack.character.runtime)));
const runtimeDefaults = parseLive2DGlobalDefaults(await readJson(path.join(workspaceRoot, "pets", "live2d-defaults.json")));
const actionMap = runtime.actionMap;
const interactionPreset = runtime.interactionPreset;
const modelCatalog = parseLive2DModelSettingsCatalog(
  await readJson(path.join(modelPackRoot, contentPack.entry))
);
const storeListing = parseStoreListingManifest(
  await readJson(path.join(storeListingRoot, "store-listing.json"))
);

validateContentPackFiles(contentPack, await listFiles(modelPackRoot));
validateLive2DActionMapAgainstModel(actionMap, modelCatalog);
validateLive2DInteractionPresetAgainstActions(interactionPreset, actionMap);

if (storeListing.packId !== contentPack.id) {
  throw new Error(`Store listing packId "${storeListing.packId}" does not match content pack "${contentPack.id}"`);
}

console.log(JSON.stringify({
  ok: true,
  packId: contentPack.id,
  character: chatProfile.displayName,
  modelEntry: contentPack.entry,
  globalRuntimeVersion: runtimeDefaults.version,
  motions: modelCatalog.motions.length,
  expressions: modelCatalog.expressions.length,
  hitAreas: modelCatalog.hitAreas.length,
  actions: Object.keys(actionMap.actions).length,
  interactionRegions: Object.keys(interactionPreset.interactionRegions).length
}, null, 2));

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function listFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(root, fullPath));
    else if (entry.isFile()) files.push(path.relative(root, fullPath).split(path.sep).join("/"));
  }
  return files;
}
