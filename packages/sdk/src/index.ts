import type { CapabilityName, EventEnvelope, EventName, JsonValue, PluginManifest } from "@cyrene/shared-types";

export interface EventBusPort {
  emit<TPayload>(
    name: EventName,
    payload: TPayload
  ): void;

  on<TPayload>(
    name: EventName,
    handler: (event: EventEnvelope<TPayload>) => void | Promise<void>
  ): () => void;
}

export interface CapabilityPort {
  register<TInput, TOutput>(
    name: CapabilityName,
    handler: (input: TInput) => Promise<TOutput> | TOutput
  ): () => void;

  call<TInput, TOutput>(
    name: CapabilityName,
    input: TInput
  ): Promise<TOutput>;
}

export interface PluginStoragePort {
  get<TValue extends JsonValue>(key: string): Promise<TValue | undefined>;
  set<TValue extends JsonValue>(key: string, value: TValue): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface PluginContext {
  readonly manifest: PluginManifest;
  readonly events: EventBusPort;
  readonly capabilities: CapabilityPort;
  readonly storage: PluginStoragePort;
  readonly log: {
    info(message: string, meta?: JsonValue): void;
    warn(message: string, meta?: JsonValue): void;
    error(message: string, meta?: JsonValue): void;
  };
}

export interface CyrenePlugin {
  start(ctx: PluginContext): Promise<void> | void;
  stop?(): Promise<void> | void;
}

export function definePlugin(plugin: CyrenePlugin): CyrenePlugin {
  return plugin;
}
