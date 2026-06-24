# Cyrene

Cyrene is a lightweight desktop pet platform. The first product target is a Live2D-first desktop pet, but the system core is centered on a renderer-agnostic **Pet Actor** runtime.

## Design Commitments

- Small kernel, replaceable feature modules.
- Code-level plugin boundaries, not only feature toggles.
- Event-driven collaboration between modules.
- Capability calls for controlled cross-plugin requests.
- Plugin-owned data and migrations.
- Live2D as the first renderer adapter, not a hard dependency in business logic.

## Workspace Layout

```text
apps/                  desktop shell and future control panels
core/                  kernel, runtime, renderer adapters, storage
packages/              shared types, SDK, schemas, UI kit
plugins/official/      first-party plugins built on the same SDK as third-party plugins
docs/                  architecture decisions and contracts
```

## Current Stage

This repository currently contains the foundation: event bus, capability registry, plugin runtime contracts, Pet Actor runtime, Live2D adapter contract, and two example official plugins.

Run the architecture smoke test:

```bash
npm run smoke
```

The smoke test starts the kernel, parses the example Live2D content pack and store listing, loads official plugins, creates a Pet Actor, emits `inventory.item.used`, and verifies the path:

```text
content parser -> Live2D adapter -> feeding plugin -> pet.stats.modify -> pet.actor.patch -> pet.animation.play
```

## References

Open-source lessons we are borrowing at the architecture level are tracked in [docs/open-source-lessons.md](docs/open-source-lessons.md).

Content-pack and model-store rules are tracked in [docs/content-pack-contract.md](docs/content-pack-contract.md).

The model action composer/control-panel direction is tracked in [docs/model-control-panel.md](docs/model-control-panel.md).
