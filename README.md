# Cyrene

Cyrene is a Live2D desktop pet built with Tauri 2, WebView2, PixiJS, and TypeScript.

The current milestone is to complete the migration from Electron to Tauri, fill the remaining desktop-pet functionality, and keep the development build stable. The Rust host owns native window behavior, the pet page owns Live2D playback and interaction, and shared TypeScript packages validate model content.

Feeding, pet-stat systems, executable plugins, and a plugin SDK are intentionally outside the project scope. They should not be reintroduced while the Tauri desktop application is being completed.

## Workspace Layout

```text
apps/desktop/          Tauri 2 desktop host and Rust native code
apps/model-lab/        Live2D model lab and desktop pet page
packages/content/      model-pack parsing, validation, and action compilation
packages/shared-types/ shared content and action types
pets/                  canonical model assets
store/                 store-listing metadata
scripts/               content verification and generated-asset sync
docs/                  current architecture and model contracts
```

`pets/` is the only source of truth for model assets. Development and builds copy it into the Model Lab public directory through `npm run sync:pets`; the generated copy is ignored by Git.

## Prerequisites

- Node.js 20.19+ on the Node 20 release line, or Node.js 22.12+.
- Rust stable with the `x86_64-pc-windows-msvc` toolchain.
- Visual C++ build tools and a Windows SDK.
- Microsoft Edge WebView2 Runtime.

## Development

Start the Tauri desktop pet:

```bash
npm run dev
```

Start only the model lab:

```bash
npm run model-lab
```

## Verification

```bash
npm run check:all
npm run smoke
npm run verify:action-flow
npm run build -w @cyrene/model-lab
npm run build -w @cyrene/desktop
```

The smoke check validates the content-pack manifest, model catalog, semantic actions, interaction regions, and store-listing relationship against the real Cyrene model assets. The desktop build uses `--no-bundle` only to verify that the Tauri application compiles; installer and publishing work are outside the current milestone.

See [docs/architecture.md](docs/architecture.md) for module boundaries and [docs/content-pack-contract.md](docs/content-pack-contract.md) for the model package format.
