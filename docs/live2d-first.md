# Live2D First

Cyrene currently targets Live2D directly.

The content contract keeps model-specific files outside desktop-window code, but the project does not maintain unused renderer abstractions. A second renderer should introduce a shared interface only after its concrete requirements are known.

The current separation is:

- `apps/desktop`: native window behavior.
- `apps/model-lab`: PixiJS and Live2D rendering.
- `packages/content`: manifests, action mappings, interaction regions, and validation.
- `pets`: canonical model assets.
