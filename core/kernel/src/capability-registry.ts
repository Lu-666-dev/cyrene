import type { CapabilityPort } from "@cyrene/sdk";
import type { CapabilityName, PluginId } from "@cyrene/shared-types";

type CapabilityHandler<TInput, TOutput> = (
  input: TInput
) => Promise<TOutput> | TOutput;

interface CapabilityRegistration {
  readonly owner: PluginId | "kernel";
  readonly handler: CapabilityHandler<unknown, unknown>;
}

export class CapabilityRegistry implements CapabilityPort {
  private scopedOwner: PluginId | "kernel" = "kernel";

  constructor(
    private readonly capabilities = new Map<CapabilityName, CapabilityRegistration>()
  ) {}

  register<TInput, TOutput>(
    name: CapabilityName,
    handler: CapabilityHandler<TInput, TOutput>
  ): () => void {
    if (this.capabilities.has(name)) {
      throw new Error(`Capability already registered: ${name}`);
    }

    this.capabilities.set(name, {
      owner: this.scopedOwner,
      handler: handler as unknown as CapabilityHandler<unknown, unknown>
    });

    return () => {
      const current = this.capabilities.get(name);
      if (current?.owner === this.scopedOwner) {
        this.capabilities.delete(name);
      }
    };
  }

  async call<TInput, TOutput>(
    name: CapabilityName,
    input: TInput
  ): Promise<TOutput> {
    const registration = this.capabilities.get(name);
    if (!registration) {
      throw new Error(`Capability not found: ${name}`);
    }

    return Promise.resolve(registration.handler(input)) as Promise<TOutput>;
  }

  scoped(owner: PluginId | "kernel"): CapabilityRegistry {
    const scoped = new CapabilityRegistry(this.capabilities);
    scoped.scopedOwner = owner;
    return scoped;
  }
}
