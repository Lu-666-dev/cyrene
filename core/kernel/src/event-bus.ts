import type { EventBusPort } from "@cyrene/sdk";
import type { EventEnvelope, EventName, PluginId } from "@cyrene/shared-types";

type Handler<TPayload> = (
  event: EventEnvelope<TPayload>
) => void | Promise<void>;

export class EventBus implements EventBusPort {
  private readonly handlers = new Map<EventName, Set<Handler<unknown>>>();

  constructor(private readonly source: PluginId | "kernel" = "kernel") {}

  emit<TPayload>(name: EventName, payload: TPayload): void {
    const event: EventEnvelope<TPayload> = {
      name,
      source: this.source,
      timestamp: Date.now(),
      payload
    };

    const handlers = this.handlers.get(name);
    if (!handlers) {
      return;
    }

    for (const handler of handlers) {
      void handler(event as EventEnvelope<unknown>);
    }
  }

  on<TPayload>(
    name: EventName,
    handler: Handler<TPayload>
  ): () => void {
    const handlers = this.handlers.get(name) ?? new Set<Handler<unknown>>();
    handlers.add(handler as Handler<unknown>);
    this.handlers.set(name, handlers);

    return () => {
      handlers.delete(handler as Handler<unknown>);
    };
  }

  scoped(source: PluginId | "kernel"): EventBus {
    const scoped = new EventBus(source);
    scoped.handlers.clear();
    for (const [name, handlers] of this.handlers) {
      scoped.handlers.set(name, handlers);
    }
    return scoped;
  }
}
