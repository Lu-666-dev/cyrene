# Model Control Panel

The control panel should be built on parsed model capabilities, not hand-written assumptions.

## Current Backend Capability

`@cyrene/content` can now parse a Live2D `model3.json` into a model catalog:

```text
motions
expressions
hitAreas
textures
physics
```

It also validates that `cyrene-actions.json` only references motion groups, expressions, and hit areas that exist in the actual model.

## User Flow

```text
Install model pack
  -> parse content-pack.json
  -> parse model3.json
  -> extract motions / expressions / hit areas
  -> parse cyrene-actions.json if present
  -> validate existing mappings
  -> open action composer UI
```

The user should not edit JSON directly.

## MVP Behavior Composer

The first version should be intentionally strict:

```text
one behavior feedback = at most one motion group + at most one expression
```

UI layout:

```text
Motion column          Expression column         Behavior column
[ ] Tick3             [ ] 表情回正              开心挥手
[ ] 动作#6            [ ] 开心眼                吃到草莓牛奶
[ ] Start             [ ] circle_question
```

Rules:

- Motions are listed in one column.
- Expressions are listed in one column.
- Each row has a checkbox.
- At most one motion can be selected.
- At most one expression can be selected.
- The user may select only a motion, only an expression, or both.
- The user clicks `Add behavior feedback`.
- A dialog asks for the behavior name.
- The behavior name cannot be empty.
- The dialog has confirm and cancel.
- Confirm saves the behavior into the behavior column.
- Clicking a behavior selects it.
- Clicking `Play` sends the selected behavior to the Live2D preview.

For MVP, the saved behavior shape is:

```json
{
  "id": "behavior_001",
  "name": "吃到草莓牛奶",
  "motionGroup": "动作#6",
  "expression": "开心眼"
}
```

The UI should show:

- semantic action on the left, such as `eat.accept`
- available motion groups from the model
- available motion entries within the selected group
- available expressions
- optional parameter tweaks
- preview button
- save as model-specific action mapping

## Suggested Composer Model

Later, each behavior can support a small sequence, not only one motion:

```json
{
  "action": "eat.accept",
  "steps": [
    {
      "motionGroup": "动作#6",
      "expression": "开心眼",
      "durationMs": 1200
    },
    {
      "expression": "表情回正",
      "durationMs": 300
    }
  ],
  "fallback": "happy.react"
}
```

For MVP, a single motion group plus optional expression is enough.

## Better Than Pure Manual Mapping

Manual arrangement is flexible, but a better workflow is:

1. Auto-detect model primitives.
2. Auto-suggest mappings by names and file patterns.
3. Let the user preview each semantic action.
4. Let the user override mappings.
5. Save overrides separately from the original downloaded content pack.

This keeps downloaded packages immutable while allowing user customization.

## Storage Rule

Original package:

```text
pets/official/cyrene-live2d/cyrene-actions.json
```

User override:

```text
user-data/model-action-overrides/official.cyrene-live2d.json
```

The runtime should merge them in order:

```text
built-in required defaults
  -> content-pack cyrene-actions.json
  -> user override
```

## Why This Matters

Different Live2D models use different motion group names, expression names, and hit area IDs. A control panel must therefore be generated from the actual parsed model catalog. Otherwise every new model requires manual code changes.
