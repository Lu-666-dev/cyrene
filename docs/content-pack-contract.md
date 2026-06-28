# Content Pack Contract

Cyrene separates executable plugins from downloadable content.

| Kind | Manifest | Can Execute Code | Examples |
| --- | --- | --- | --- |
| Code plugin | `plugin.json` | Yes, sandboxed by permissions | feeding, inventory, shop, AI chat |
| Content pack | `content-pack.json` | No | Live2D model, voice pack, dialogue pack, theme |
| Store listing | `store-listing.json` | No | Public marketplace metadata and download URL |

This separation keeps model downloads safe. A new Live2D character should not need to ship executable code.

## Content Pack Manifest

Every downloadable content pack must include `content-pack.json` at its root.

```json
{
  "id": "official.default-live2d",
  "type": "pet-model",
  "name": "Default Live2D Pet",
  "version": "0.1.0",
  "authors": ["Cyrene Team"],
  "renderer": "live2d",
  "entry": "model.model3.json",
  "icon": "icon.png",
  "trayIcon": "tray-icon.png",
  "files": [
    "model.model3.json",
    "icon.png",
    "tray-icon.png",
    "motions/idle.motion3.json",
    "expressions/happy.exp3.json",
    "cyrene-actions.json"
  ],
  "license": {
    "name": "Internal Example",
    "url": "https://example.invalid/license"
  },
  "compatibility": {
    "cyrene": ">=0.1.0",
    "renderers": ["live2d"]
  }
}
```

`icon` is the model's original display image. `trayIcon` is an optional tray-optimized variant; both files must be listed in `files`. The desktop tray prefers `trayIcon` and falls back to `icon`, so changing the active model pack also changes its tray image.

## Live2D Action Mapping

Every Live2D pet model pack must include `cyrene-actions.json`.

Feature plugins request semantic actions such as `eat.accept`; the model pack maps those actions to Live2D-specific motions, expressions, and parameters.

```json
{
  "actions": {
    "idle.normal": {
      "motionGroup": "Idle",
      "expression": "neutral",
      "priority": 0
    },
    "eat.accept": {
      "motionGroup": "Eat",
      "motionIndex": 0,
      "motionName": "Accept",
      "expression": "happy",
      "priority": 2,
      "after": "idle.normal",
      "parameters": {
        "ParamMouthOpenY": 0.45
      }
    }
  },
  "hitAreas": {
    "head": {
      "semanticEvent": "pet.hit.head",
      "live2dId": "HitAreaHead"
    },
    "body": {
      "semanticEvent": "pet.hit.body",
      "live2dId": "HitAreaBody"
    }
  }
}
```

`after` is optional. When present, it names another semantic action that should be played after the current feedback finishes. Use it for recovery actions such as returning to `idle.normal` or resetting a temporary expression.

## Live2D Interaction Preset

Live2D model packs can include `cyrene-interactions.json` for editable click regions and their default feedback bindings. This file is separate from `cyrene-actions.json` so a future control page can rewrite region bindings without changing the original semantic action library.

```json
{
  "version": 1,
  "name": "Default click interaction preset",
  "interactionRegions": {
    "head": {
      "label": "Head",
      "semanticEvent": "pet.hit.head",
      "priority": 40,
      "shape": {
        "type": "polygon",
        "points": [
          { "x": 0.34, "y": 0.1 },
          { "x": 0.66, "y": 0.1 },
          { "x": 0.66, "y": 0.58 },
          { "x": 0.34, "y": 0.58 }
        ]
      },
      "feedback": {
        "action": "happy.react",
        "suggestedActions": ["happy.react", "curious.question"]
      }
    }
  }
}
```

`interactionRegions` is the editable click-feedback layer. The renderer first checks the model's real visible alpha outline, then checks which region shape contains the pointer. Region coordinates are normalized against the fitted model bounds. Shapes can be `rect` or `polygon`; use polygons for character parts that need a clean non-overlapping split. The MVP region set is:

```text
head
body
swing.left
swing.right
```

Each bound region must point to an existing semantic action through `feedback.action`. `feedback.action` may be `null` while the user has not chosen a behavior yet. The model control page should edit region labels, shapes, priority, and feedback action mappings in this file.

## Store Listing Manifest

The store uses a separate `store-listing.json`. It should not be trusted as the source of runtime truth; the installed content pack still validates its own `content-pack.json`.

```json
{
  "id": "store.official.default-live2d",
  "packId": "official.default-live2d",
  "title": "Default Live2D Pet",
  "summary": "A starter Live2D model package for Cyrene.",
  "version": "0.1.0",
  "category": "pet-model",
  "download": {
    "url": "https://example.invalid/packs/default-live2d-0.1.0.zip",
    "sha256": "replace-with-package-sha256",
    "sizeBytes": 0
  },
  "preview": {
    "thumbnail": "preview/thumbnail.png",
    "images": ["preview/idle.png", "preview/eat.png"]
  }
}
```

## Add A New Live2D Model To The Download Store

1. Create a new folder under the content source, for example `pets/official/my-pet-live2d`.
2. Place the Live2D files in that folder: `model.model3.json`, `.moc3`, textures, motions, expressions, physics, pose files.
3. Add `content-pack.json` and list all required files.
4. Add `cyrene-actions.json` and map required semantic actions.
5. Add preview images under `preview/`.
6. Validate that the pack has no executable code.
7. Zip the folder as an immutable versioned package, for example `my-pet-live2d-0.1.0.zip`.
8. Compute the zip SHA-256 and size.
9. Create or update `store-listing.json`.
10. Publish the zip and listing to the store index.
11. The app downloads the zip, verifies SHA-256, validates `content-pack.json`, installs it into the resource cache, then exposes it in the character library.

## Runtime Parsing Pipeline

Content manifests are not documentation-only. They must be parsed by `@cyrene/content` before any renderer or feature module can use them.

```text
store-listing.json
  -> parseStoreListingManifest
  -> verify download sha256 and size

content-pack.json
  -> parseContentPackManifest
  -> validateContentPackFiles

cyrene-actions.json
  -> parseLive2DActionMap
  -> createLive2DModelPackage
  -> Live2DAdapter.load
```

The renderer should never read arbitrary model JSON directly from the store. It receives a validated internal model package:

```ts
{
  modelId: "official.default-live2d",
  modelJsonPath: "model.model3.json",
  actionMap: {
    "eat.accept": {
      motionGroup: "Eat",
      expression: "happy"
    }
  }
}
```

The same rule applies to future content types. Voice packs, dialogue packs, themes, and mini-game assets need parsers before they are accepted as installable content.

Model action composition and the future control panel flow are described in [model-control-panel.md](model-control-panel.md).

## Required Semantic Actions For MVP

A pet model pack should support these actions before it is accepted into the official store:

```text
idle.normal
happy.react
eat.accept
drag.start
drag.end
sleep.enter
sleep.exit
```

Optional actions can be added freely. Missing optional actions should gracefully fall back to `idle.normal` or `happy.react`.
