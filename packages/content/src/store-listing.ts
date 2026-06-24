import type { StoreListingManifest } from "@cyrene/shared-types";
import { requireNumber, requireObject, requireString, requireStringArray } from "./validation.js";

export function parseStoreListingManifest(value: unknown): StoreListingManifest {
  const object = requireObject(value, "store-listing.json");
  const download = requireObject(object.download, "store-listing.json.download");
  const preview = requireObject(object.preview, "store-listing.json.preview");

  return {
    id: requireString(object.id, "store-listing.json.id"),
    packId: requireString(object.packId, "store-listing.json.packId"),
    title: requireString(object.title, "store-listing.json.title"),
    summary: requireString(object.summary, "store-listing.json.summary"),
    version: requireString(object.version, "store-listing.json.version"),
    category: requireString(object.category, "store-listing.json.category"),
    download: {
      url: requireString(download.url, "store-listing.json.download.url"),
      sha256: requireString(download.sha256, "store-listing.json.download.sha256"),
      sizeBytes: requireNumber(download.sizeBytes, "store-listing.json.download.sizeBytes")
    },
    preview: {
      thumbnail: requireString(preview.thumbnail, "store-listing.json.preview.thumbnail"),
      images: requireStringArray(preview.images, "store-listing.json.preview.images")
    }
  };
}
