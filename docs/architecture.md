# Architecture

Cyrene is organized around one central concept: **Pet Actor**.

A Pet Actor is the stable runtime identity of a character. It owns state, receives events, asks for capabilities, and delegates visual output to a renderer adapter.

```text
Input
  user gesture, time tick, item usage, chat, system events

Event Bus
  typed events shared across kernel and plugins

Pet Actor Runtime
  state, behavior decisions, action requests

Renderer Adapter
  Live2D first, later Sprite, Spine, VRM

Output
  motion, expression, parameters, speech, audio, new events
```

## Kernel Boundary

The kernel provides only stable primitives:

- Event bus
- Capability registry
- Plugin lifecycle
- Permission declarations
- Storage contracts
- Resource contracts

Feature code lives in plugins. Plugins do not import each other. They communicate through events, capabilities, and extension points.

## Data Boundary

Plugins own their data. Cross-plugin writes must go through capabilities.

Allowed:

```ts
await ctx.capabilities.call("pet.stats.modify", { actorId, hungerDelta: 10 });
ctx.events.emit("feeding.completed", { actorId, itemId });
```

Avoid:

```ts
import { addAffinity } from "../affinity";
```

## Renderer Boundary

Business logic asks for semantic actions:

```ts
await ctx.capabilities.call("pet.animation.play", {
  actorId,
  action: "happy.react",
  intensity: 0.8
});
```

The Live2D adapter maps semantic actions to model-specific motions, expressions, hit areas, and parameters.
