import type { PluginStoragePort } from "@cyrene/sdk";
import type { JsonValue, PluginId } from "@cyrene/shared-types";

export class MemoryPluginStorage implements PluginStoragePort {
  constructor(
    private readonly pluginId: PluginId,
    private readonly data = new Map<string, JsonValue>()
  ) {}

  async get<TValue extends JsonValue>(key: string): Promise<TValue | undefined> {
    return this.data.get(this.key(key)) as TValue | undefined;
  }

  async set<TValue extends JsonValue>(key: string, value: TValue): Promise<void> {
    this.data.set(this.key(key), value);
  }

  async delete(key: string): Promise<void> {
    this.data.delete(this.key(key));
  }

  private key(key: string): string {
    return `${this.pluginId}:${key}`;
  }
}
