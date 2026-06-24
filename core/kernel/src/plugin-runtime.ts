import type { CyrenePlugin, PluginContext } from "@cyrene/sdk";
import type { JsonValue, PluginManifest } from "@cyrene/shared-types";
import { CapabilityRegistry } from "./capability-registry.js";
import { EventBus } from "./event-bus.js";
import { MemoryPluginStorage } from "./memory-storage.js";

export class PluginRuntime {
  private readonly plugins = new Map<string, CyrenePlugin>();
  private readonly sharedStorage = new Map<string, JsonValue>();

  constructor(
    private readonly events: EventBus,
    private readonly capabilities: CapabilityRegistry
  ) {}

  async start(manifest: PluginManifest, plugin: CyrenePlugin): Promise<void> {
    if (this.plugins.has(manifest.id)) {
      throw new Error(`Plugin already started: ${manifest.id}`);
    }

    const ctx: PluginContext = {
      manifest,
      events: this.events.scoped(manifest.id),
      capabilities: this.capabilities.scoped(manifest.id),
      storage: new MemoryPluginStorage(manifest.id, this.sharedStorage),
      log: {
        info: (message, meta) => this.log("info", manifest.id, message, meta),
        warn: (message, meta) => this.log("warn", manifest.id, message, meta),
        error: (message, meta) => this.log("error", manifest.id, message, meta)
      }
    };

    await plugin.start(ctx);
    this.plugins.set(manifest.id, plugin);
    this.events.emit("plugin.started", { pluginId: manifest.id });
  }

  async stop(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      return;
    }

    await plugin.stop?.();
    this.plugins.delete(pluginId);
    this.events.emit("plugin.stopped", { pluginId });
  }

  private log(
    level: "info" | "warn" | "error",
    pluginId: string,
    message: string,
    meta?: JsonValue
  ): void {
    this.events.emit("plugin.log", { level, pluginId, message, meta: meta ?? null });
  }
}
