# Open Source Lessons

This document records ideas we should borrow from mature desktop-pet projects without copying their implementation.

## Reference Projects

| Project | What To Borrow | What To Avoid |
| --- | --- | --- |
| BongoCat | Lightweight cross-platform shell, Tauri-style native boundary, input-driven reactions, simple model import. | Tying all interactions to one mascot format too early. |
| VPet | Clear split between desktop app, core runtime, tooling, MOD ecosystem, and animation graph concepts. | Hard-coding game features into the desktop shell. |
| OpenPets | Plugin SDK, permissions, schedules, storage, events, local agent integration, test harness mindset. | Making AI or coding-agent integration part of the required core path. |
| DyberPet | JSON-driven content, roles/items/audio/mini-pets as editable resources, playable non-AI experience. | Letting content config become untyped or impossible to validate. |
| Mate-Engine | VRM/3D direction, animation transitions, touch regions, model customization, SDK mindset. | Starting with Unity/3D before the lightweight 2D/Live2D runtime is stable. |
| Shijima-Qt | Existing Shimeji behavior model, mascot runner concepts, cross-platform window lessons. | Qt-heavy desktop hacks that become hard to maintain. |

## Architecture Takeaways

### 1. Keep the Shell Thin

The desktop shell should own native concerns:

- transparent and always-on-top windows
- taskbar or tray behavior
- multi-screen bounds
- file dialogs and resource import
- secure downloads and updates
- native input capture where needed

It must not own feeding, affinity, shop, AI, dialogue, achievements, or animation decisions.

### 2. Treat Pet Actor As The Product Core

The model is the visible center of the experience, but the code center is the Pet Actor runtime:

```text
Pet Actor
  state
  behavior
  semantic actions
  event reactions
  renderer adapter
```

Live2D is the first renderer adapter. It should not leak into all gameplay code.

### 3. Use Semantic Actions Instead Of Renderer Calls

Feature plugins should request:

```text
eat.accept
happy.react
idle.normal
drag.start
sleep.enter
```

The renderer adapter maps those actions to Live2D motions, expressions, parameters, and hit areas.

This keeps PNG, Spine, Live2D, and future VRM support possible without changing feature plugins.

### 4. Plugins Communicate Through Contracts

Feature plugins must not import each other. They should communicate through:

- events for facts
- capabilities for requested work
- extension points for UI and content

Example:

```text
inventory.item.used
  -> feeding plugin calls pet.stats.modify
  -> feeding plugin emits feeding.completed
  -> animation, dialogue, affinity, achievement plugins react independently
```

### 5. Plugin Data Must Be Private By Default

Each plugin owns its migrations and tables. Cross-plugin data writes must go through capabilities.

This prevents every new feature from requiring broad database rewiring.

### 6. Content Is Downloadable And Validated

Large resources should be optional:

- character packs
- Live2D models
- voice packs
- dialogue packs
- mini-games
- AI integrations

Every content pack needs a manifest and schema validation before installation.

### 7. Build The Non-AI Experience First

AI should enhance the pet, not be required for the pet to feel alive.

The baseline should already support idle behavior, interaction, state, animation, dialogue, reminders, and simple progression.

## License Rule

Borrow ideas, not code, unless a file is intentionally imported with license review.

Before using any external code or asset:

1. Record source repository and exact file.
2. Check license compatibility.
3. Keep attribution requirements.
4. Prefer rewriting the idea in our own architecture.
5. Never import model assets casually; character/model licenses are often stricter than code licenses.

## Practical Decisions For Cyrene

- Use Tauri for the future desktop shell unless a specific feature forces a different route.
- Use TypeScript for plugin SDK and runtime contracts.
- Use Rust only for native shell, secure IO, downloads, and performance-sensitive desktop integration.
- Start with Live2D adapter plus mock renderer tests.
- Keep VRM/3D as a later renderer plugin, not the first milestone.
- Build official plugins using the same SDK as third-party plugins.
