import {
  parseContentPackManifest,
  parseCharacterChatProfile,
  parseCharacterLive2DRuntime,
  parseLive2DGlobalDefaults,
  parseLive2DModelSettingsCatalog,
  validateContentPackFiles,
  validateLive2DActionMapAgainstModel,
  validateLive2DInteractionPresetAgainstActions
} from "@cyrene/content";
import type {
  Live2DActionMapContract,
  CharacterChatProfile,
  CharacterLive2DRuntime,
  Live2DInteractionPresetContract,
  Live2DGlobalDefaults,
  Live2DModelSettingsCatalog
} from "@cyrene/content";
import type { ContentPackManifest } from "@cyrene/shared-types";

export interface Live2DContentBundle {
  readonly baseUrl: string;
  readonly modelBaseUrl: string;
  readonly entryUrl: string;
  readonly manifest: ContentPackManifest;
  readonly chatProfile: CharacterChatProfile;
  readonly runtime: CharacterLive2DRuntime;
  readonly runtimeDefaults: Live2DGlobalDefaults;
  readonly modelCatalog: Live2DModelSettingsCatalog;
  readonly actionMap: Live2DActionMapContract;
  readonly interactionPreset: Live2DInteractionPresetContract;
}

export async function loadLive2DContentBundle(baseUrl: string): Promise<Live2DContentBundle> {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  const manifestRaw = await fetchJson(`${normalizedBaseUrl}/content-pack.json`);
  const manifest = parseContentPackManifest(manifestRaw);
  validateContentPackFiles(manifest, manifest.files);
  if (manifest.type !== "pet-model" || manifest.renderer !== "live2d" || !manifest.character) {
    throw new Error(
      `Content pack "${manifest.id}" must be a Live2D character pack with chat and runtime configuration`
    );
  }

  const [chatRaw, runtimeRaw, defaultsRaw] = await Promise.all([
    fetchJson(`${normalizedBaseUrl}/${manifest.character.chat}`),
    fetchJson(`${normalizedBaseUrl}/${manifest.character.runtime}`),
    fetchJson("/pets/live2d-defaults.json")
  ]);
  const chatProfile = parseCharacterChatProfile(chatRaw);
  const runtime = parseCharacterLive2DRuntime(runtimeRaw);
  const runtimeDefaults = parseLive2DGlobalDefaults(defaultsRaw);
  const modelBaseUrl = `${normalizedBaseUrl}/${manifest.entry.split("/").slice(0, -1).join("/")}`.replace(/\/$/, "");
  const modelCatalog = parseLive2DModelSettingsCatalog(
    await fetchJson(`${normalizedBaseUrl}/${manifest.entry}`)
  );

  validateLive2DActionMapAgainstModel(runtime.actionMap, modelCatalog);
  validateLive2DInteractionPresetAgainstActions(runtime.interactionPreset, runtime.actionMap);

  return {
    baseUrl: normalizedBaseUrl,
    modelBaseUrl,
    entryUrl: `${normalizedBaseUrl}/${manifest.entry}`,
    manifest,
    chatProfile,
    runtime,
    runtimeDefaults,
    modelCatalog,
    actionMap: runtime.actionMap,
    interactionPreset: runtime.interactionPreset
  };
}

export async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  return response.json() as Promise<unknown>;
}
