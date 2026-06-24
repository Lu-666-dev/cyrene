# Model Action System

Cyrene treats the Live2D model as the source of truth for playable model actions.
The conversion pipeline reads `model3.json`, expression files, and motion metadata,
then generates small action files under `generated/actions`.

## Action Classes

- `atomic`: one indivisible model action. Examples: `Wink~`, `星星眼`, `问号`.
- `stateful`: an action that changes a persistent switch or gate. Examples: rope `开` and `关`.
- `composite`: one user-facing action that affects multiple channels or has lifecycle phases. Examples: `circle_question`, `荡秋千`.
- `reset`: internal recovery actions used before previewing another action. These are generated but hidden from normal composition unless they are also useful stateful switches.

## Channels

Each action has `channelIds`.
The composer does not group the action list visually, but it uses channels to compile queues:

- Same channel: actions play in the order the user arranged them.
- Different channels: actions belong to independent queues and can be played in parallel.
- Multi-channel action: appears once in the buffer, but is inserted into each affected queue.

Examples:

- `body:motion`: full body motion file.
- `parameter:Param16`: rope switch.
- `parameter:Param32`: swing pull direction.
- `parameter:Param2` and `parameter:Param6`: `circle_question` multi-channel expression.

## Lifecycle Composite

Some actions need a setup/main/cleanup sequence.
Cyrene calls this a lifecycle composite action:

```json
{
  "kind": "composite",
  "label": "荡秋千",
  "steps": [
    { "phase": "before", "actionId": "开" },
    { "phase": "main", "actionId": "荡秋千" },
    { "phase": "after", "actionId": "关" }
  ]
}
```

The current UI exposes the lifecycle metadata.
The next runtime step is to make the player execute `before -> main -> after`
with real motion-completion callbacks.

## Generated Files

Run:

```bash
node scripts/generate-model-actions.mjs pets/official/cyrene-live2d
```

This creates:

- `generated/actions/index.json`
- one JSON file per action id

For the Cyrene model, the current extraction produces:

- 15 user-composable actions
- 4 reset/internal actions

The generator is intentionally separate from the renderer so model pack conversion can later run during store ingestion, local import, or developer tooling.
