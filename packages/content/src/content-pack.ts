import type { ContentPackManifest, ContentPackType, RendererKind } from "@cyrene/shared-types";
import {
  ContractValidationError,
  optionalStringArray,
  requireObject,
  requireString,
  requireStringArray
} from "./validation.js";

const contentPackTypes = new Set<ContentPackType>([
  "pet-model",
  "voice-pack",
  "dialogue-pack",
  "theme",
  "mini-game-assets"
]);

const rendererKinds = new Set<RendererKind>(["live2d", "sprite", "spine", "vrm"]);

export function parseContentPackManifest(value: unknown): ContentPackManifest {
  const object = requireObject(value, "content-pack.json");
  const type = requireString(object.type, "content-pack.json.type") as ContentPackType;
  const renderer = object.renderer === undefined
    ? undefined
    : requireString(object.renderer, "content-pack.json.renderer") as RendererKind;
  const license = requireObject(object.license, "content-pack.json.license");
  const compatibility = requireObject(object.compatibility, "content-pack.json.compatibility");
  const character = object.character === undefined
    ? undefined
    : requireObject(object.character, "content-pack.json.character");
  const renderers = optionalStringArray(
    compatibility.renderers,
    "content-pack.json.compatibility.renderers"
  ) as readonly RendererKind[] | undefined;

  if (!contentPackTypes.has(type)) {
    throw new ContractValidationError(`unsupported content pack type "${type}"`, "content-pack.json.type");
  }

  if (renderer !== undefined && !rendererKinds.has(renderer)) {
    throw new ContractValidationError(`unsupported renderer "${renderer}"`, "content-pack.json.renderer");
  }

  if (renderers) {
    for (const candidate of renderers) {
      if (!rendererKinds.has(candidate)) {
        throw new ContractValidationError(
          `unsupported renderer "${candidate}"`,
          "content-pack.json.compatibility.renderers"
        );
      }
    }
  }

  const manifest: ContentPackManifest = {
    id: requireString(object.id, "content-pack.json.id"),
    type,
    name: requireString(object.name, "content-pack.json.name"),
    version: requireString(object.version, "content-pack.json.version"),
    authors: requireStringArray(object.authors, "content-pack.json.authors"),
    entry: requireString(object.entry, "content-pack.json.entry"),
    ...(object.icon === undefined
      ? {}
      : { icon: requireString(object.icon, "content-pack.json.icon") }),
    ...(object.trayIcon === undefined
      ? {}
      : { trayIcon: requireString(object.trayIcon, "content-pack.json.trayIcon") }),
    ...(character === undefined
      ? {}
      : {
          character: {
            chat: requireString(character.chat, "content-pack.json.character.chat"),
            runtime: requireString(character.runtime, "content-pack.json.character.runtime")
          }
        }),
    files: requireStringArray(object.files, "content-pack.json.files"),
    license: {
      name: requireString(license.name, "content-pack.json.license.name")
    },
    compatibility: {
      cyrene: requireString(compatibility.cyrene, "content-pack.json.compatibility.cyrene")
    }
  };

  if (renderer !== undefined) {
    return {
      ...manifest,
      renderer,
      license: license.url === undefined
        ? manifest.license
        : { ...manifest.license, url: requireString(license.url, "content-pack.json.license.url") },
      compatibility: renderers === undefined
        ? manifest.compatibility
        : { ...manifest.compatibility, renderers }
    };
  }

  return {
    ...manifest,
    license: license.url === undefined
      ? manifest.license
      : { ...manifest.license, url: requireString(license.url, "content-pack.json.license.url") },
    compatibility: renderers === undefined
      ? manifest.compatibility
      : { ...manifest.compatibility, renderers }
  };
}

export function validateContentPackFiles(
  manifest: ContentPackManifest,
  availableFiles?: Iterable<string>
): void {
  const files = new Set(manifest.files);
  if (!files.has(manifest.entry)) {
    throw new ContractValidationError(
      `entry "${manifest.entry}" must be listed in files`,
      "content-pack.json.files"
    );
  }

  if (manifest.icon && !files.has(manifest.icon)) {
    throw new ContractValidationError(
      `icon "${manifest.icon}" must be listed in files`,
      "content-pack.json.files"
    );
  }

  if (manifest.trayIcon && !files.has(manifest.trayIcon)) {
    throw new ContractValidationError(
      `trayIcon "${manifest.trayIcon}" must be listed in files`,
      "content-pack.json.files"
    );
  }

  if (manifest.character) {
    for (const [field, file] of Object.entries(manifest.character)) {
      if (!files.has(file)) {
        throw new ContractValidationError(
          `character ${field} file "${file}" must be listed`,
          "content-pack.json.files"
        );
      }
    }
  }

  if (availableFiles) {
    const available = new Set(availableFiles);
    for (const file of manifest.files) {
      if (!available.has(file)) {
        throw new ContractValidationError(
          `listed file "${file}" was not found in the content pack`,
          "content-pack.json.files"
        );
      }
    }
  }
}
