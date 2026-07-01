export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type ContentPackType = "pet-model" | "voice-pack" | "dialogue-pack" | "theme" | "mini-game-assets";
export type RendererKind = "live2d" | "sprite" | "spine" | "vrm";

export interface ContentPackManifest {
  readonly id: string;
  readonly type: ContentPackType;
  readonly name: string;
  readonly version: string;
  readonly authors: readonly string[];
  readonly renderer?: RendererKind;
  readonly entry: string;
  readonly icon?: string;
  readonly trayIcon?: string;
  readonly character?: {
    readonly chat: string;
    readonly runtime: string;
  };
  readonly files: readonly string[];
  readonly license: {
    readonly name: string;
    readonly url?: string;
  };
  readonly compatibility: {
    readonly cyrene: string;
    readonly renderers?: readonly RendererKind[];
  };
}

export interface StoreListingManifest {
  readonly id: string;
  readonly packId: string;
  readonly title: string;
  readonly summary: string;
  readonly version: string;
  readonly category: string;
  readonly download: {
    readonly url: string;
    readonly sha256: string;
    readonly sizeBytes: number;
  };
  readonly preview: {
    readonly thumbnail: string;
    readonly images: readonly string[];
  };
}

export interface PetBehaviorFeedback {
  readonly id: string;
  readonly name: string;
  readonly motionGroup?: string;
  readonly expression?: string;
}

export interface PetRegionBehavior {
  readonly id: string;
  readonly areaId: string;
  readonly areaName: string;
  readonly label: string;
  readonly motionGroup?: string;
  readonly motionName?: string;
  readonly expression?: string;
}

export interface PetBehaviorState {
  readonly id: string;
  readonly name: string;
  readonly behaviors: readonly PetRegionBehavior[];
}

export type ModelActionKind = "atomic" | "stateful" | "composite";
export type ModelActionSourceKind = "motion" | "expression";
export type ModelActionLifecyclePhase = "before" | "main" | "after";
export type ModelActionScope = "self" | "next" | "persistent";

export interface ModelActionPlaySpec {
  readonly motionGroup?: string;
  readonly motionName?: string;
  readonly motionIndex?: number;
  readonly expression?: string;
}

export interface ModelActionStep {
  readonly id: string;
  readonly phase: ModelActionLifecyclePhase;
  readonly actionId: string;
}

export interface ModelAction {
  readonly id: string;
  readonly kind: ModelActionKind;
  readonly scope: ModelActionScope;
  readonly label: string;
  readonly source: ModelActionSourceKind;
  readonly sourceKey: string;
  readonly channelIds: readonly string[];
  readonly play: ModelActionPlaySpec;
  readonly tags: readonly string[];
  readonly steps?: readonly ModelActionStep[];
}

export interface ModelActionQueue {
  readonly channelId: string;
  readonly actions: readonly ModelAction[];
}

export interface CompiledModelActionState {
  readonly id: string;
  readonly name: string;
  readonly actions: readonly ModelAction[];
  readonly queues: readonly ModelActionQueue[];
}
