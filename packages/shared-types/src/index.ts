export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type PluginId = string;
export type ActorId = string;
export type CapabilityName = string;
export type EventName = string;

export interface EventEnvelope<TPayload = unknown> {
  readonly name: EventName;
  readonly source: PluginId | "kernel";
  readonly timestamp: number;
  readonly payload: TPayload;
}

export interface PluginManifest {
  readonly id: PluginId;
  readonly name: string;
  readonly version: string;
  readonly entry: string;
  readonly permissions: readonly string[];
  readonly migrations?: readonly string[];
}

export interface PetActorState {
  readonly actorId: ActorId;
  readonly modelId: string;
  readonly mood: number;
  readonly hunger: number;
  readonly energy: number;
  readonly affinity: number;
  readonly behavior: string;
}

export interface PetActionRequest {
  readonly actorId: ActorId;
  readonly action: string;
  readonly intensity?: number;
  readonly reason?: string;
}
