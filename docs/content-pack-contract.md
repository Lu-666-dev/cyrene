# Character Content Pack Contract

Cyrene characters are non-executable content packs. A character pack groups its Live2D resources, chat defaults, and model-specific runtime adaptation while application-wide behavior stays outside the pack.

## Directory layout

```text
pets/
├─ live2d-defaults.json
└─ official/
   └─ cyrene-live2d/
      ├─ content-pack.json
      ├─ chat.json
      ├─ runtime.json
      ├─ assets/
      │  ├─ icon.png
      │  └─ tray-icon.png
      └─ live2d/
         ├─ cyrene.model3.json
         ├─ *.moc3
         ├─ textures, motions, expressions, physics
         └─ generated/actions/
```

The four files at the character root have distinct ownership:

- `content-pack.json` is the stable identity and file index.
- `chat.json` contains the character's immutable chat defaults.
- `runtime.json` contains only model-specific Live2D adaptation.
- `live2d-defaults.json` is global and must not be copied into each character.

API credentials, chat history, long-term memory, and user overrides are application data, not package content.

## Manifest

```json
{
  "id": "official.cyrene-live2d",
  "type": "pet-model",
  "name": "Cyrene Live2D",
  "version": "0.1.0",
  "authors": ["Cyrene Team"],
  "renderer": "live2d",
  "entry": "live2d/cyrene.model3.json",
  "icon": "assets/icon.png",
  "trayIcon": "assets/tray-icon.png",
  "character": {
    "chat": "chat.json",
    "runtime": "runtime.json"
  },
  "files": [
    "chat.json",
    "runtime.json",
    "assets/icon.png",
    "live2d/cyrene.model3.json"
  ],
  "license": { "name": "Local User Asset" },
  "compatibility": {
    "cyrene": ">=0.1.0",
    "renderers": ["live2d"]
  }
}
```

Every path named by `entry`, `icon`, `trayIcon`, and `character` must also appear in `files`. Nested paths use `/` separators.

## Chat profile

`chat.json` follows this versioned shape:

```json
{
  "version": 1,
  "displayName": "Cyrene",
  "systemPrompt": "You are Cyrene...",
  "firstMessage": "Hello.",
  "alternateGreetings": [],
  "exampleMessages": [],
  "generation": {
    "temperature": 0.7,
    "topP": 1,
    "maxTokens": null
  },
  "memory": {
    "mode": "recent",
    "contextTurns": 12
  }
}
```

These are package defaults. User edits are stored as an override keyed by the manifest `id`, so updating a character package never overwrites user choices.

## Model runtime

`runtime.json` contains only values that depend on this Live2D model:

```json
{
  "version": 1,
  "layout": {
    "fitScale": 0.92,
    "offsetX": 0,
    "offsetY": 0
  },
  "actions": {
    "idle.normal": { "motionGroup": "Tick3", "priority": 0 },
    "happy.react": { "motionGroup": "Action", "priority": 1 }
  },
  "hitAreas": {
    "head": {
      "semanticEvent": "pet.hit.head",
      "live2dId": "ArtMesh15"
    }
  },
  "interactions": {
    "version": 1,
    "name": "Default interactions",
    "interactionRegions": {}
  }
}
```

Use normalized model coordinates for interaction shapes. Semantic actions may map to motions, expressions, parameter values, priorities, and an optional `after` action. Runtime configuration is declarative and may not contain executable code.

## Global Live2D defaults

`pets/live2d-defaults.json` owns behavior shared by all characters:

- alpha hit-test threshold;
- drag threshold and click suppression;
- user scale range and wheel sensitivity;
- generic feedback timing;
- desktop model box and shape padding;
- diagnostic sampling intervals.

A character runtime must not repeat these fields. Add a character field only when the model needs a genuine compatibility override.

## User data and precedence

Effective configuration is resolved in this order:

```text
application defaults
  < global user preferences
  < character package defaults
  < user override for the character ID
```

Model-specific long-term memory and interaction bindings are also keyed by character ID. API endpoint, LLM selection, and encrypted API key remain global.

## Validation pipeline

```text
content-pack.json -> parseContentPackManifest -> validateContentPackFiles
chat.json         -> parseCharacterChatProfile
runtime.json      -> parseCharacterLive2DRuntime
model3.json       -> parseLive2DModelSettingsCatalog
runtime actions   -> validateLive2DActionMapAgainstModel
interactions      -> validateLive2DInteractionPresetAgainstActions
```

The renderer only receives the validated internal bundle.

## Store listing

The store keeps a separate `store-listing.json` with download URL, checksum, size, and preview paths. Its `packId` must equal `content-pack.json.id`; it is marketplace metadata, not runtime truth.

## Adding a character

1. Create a package folder below `pets/<publisher>/`.
2. Put raw Live2D files under `live2d/` without changing their internal relative paths.
3. Add `chat.json` and `runtime.json`.
4. Add assets such as icons under `assets/`.
5. List every required file in `content-pack.json`.
6. Run `npm run smoke` and `npm run verify:action-flow`.
7. Package and publish the immutable version, then update its store listing.
