# Live2D-First Runtime

Cyrene treats Live2D as the first renderer adapter, while keeping the Pet Actor runtime renderer-agnostic.

## Live2D Adapter Responsibilities

- Read model settings.
- Validate required files.
- Load motions and expressions.
- Map semantic actions to model-specific assets.
- Resolve hit areas.
- Drive parameters and expression intensity.
- Emit animation lifecycle events.

## Semantic Action Mapping

Plugins should request semantic actions:

```text
idle.normal
happy.react
eat.accept
drag.start
drag.end
sleep.enter
```

The model package owns the mapping:

```json
{
  "happy.react": {
    "motionGroup": "TapBody",
    "expression": "happy",
    "priority": 2
  }
}
```
