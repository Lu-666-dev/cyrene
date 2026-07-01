import type { Live2DInteractionPresetContract } from "@cyrene/content";

export const interactionBindingsEvent = "cyrene:interaction-bindings-updated";
const interactionBindingsStoragePrefix = "cyrene.settings.interaction-bindings.v2";
const legacyInteractionBindingsStorageKey = "cyrene.settings.interaction-bindings.v1";

export type InteractionActionBindings = Readonly<Record<string, string>>;

export function createDefaultInteractionActionBindings(
  preset: Live2DInteractionPresetContract
): InteractionActionBindings {
  return Object.fromEntries(Object.entries(preset.interactionRegions).map(([regionId, region]) => {
    if (!region.feedback.action) {
      throw new Error(`Click interaction region "${regionId}" has no initial action`);
    }
    return [regionId, region.feedback.action];
  }));
}

export function normalizeInteractionActionBindings(
  value: unknown,
  defaults: InteractionActionBindings,
  availableActions: Iterable<string>
): InteractionActionBindings {
  const actionIds = new Set(availableActions);
  const candidate = isRecord(value) ? value : {};

  return Object.fromEntries(Object.entries(defaults).map(([regionId, defaultAction]) => {
    const selectedAction = candidate[regionId];
    return [
      regionId,
      typeof selectedAction === "string" && actionIds.has(selectedAction)
        ? selectedAction
        : defaultAction
    ];
  }));
}

export function loadInteractionActionBindings(
  packId: string,
  defaults: InteractionActionBindings,
  availableActions: Iterable<string>
): InteractionActionBindings {
  try {
    const scoped = localStorage.getItem(getInteractionBindingsStorageKey(packId));
    const stored = scoped ?? (packId === "official.cyrene-live2d"
      ? localStorage.getItem(legacyInteractionBindingsStorageKey)
      : null);
    return normalizeInteractionActionBindings(
      stored ? JSON.parse(stored) as unknown : null,
      defaults,
      availableActions
    );
  } catch (error) {
    console.warn("Failed to load interaction bindings; using content defaults.", error);
    return defaults;
  }
}

export function saveInteractionActionBindings(packId: string, bindings: InteractionActionBindings): void {
  localStorage.setItem(getInteractionBindingsStorageKey(packId), JSON.stringify(bindings));
}

function getInteractionBindingsStorageKey(packId: string): string {
  return `${interactionBindingsStoragePrefix}:${packId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
