const activeCharacterStorageKey = "cyrene:active-character-url:v1";
const defaultCharacterBaseUrl = "/pets/official/cyrene-live2d";

export function getActiveCharacterBaseUrl(): string {
  const saved = localStorage.getItem(activeCharacterStorageKey)?.trim();
  return saved && isSafeCharacterBaseUrl(saved) ? saved.replace(/\/$/, "") : defaultCharacterBaseUrl;
}

export function setActiveCharacterBaseUrl(baseUrl: string): void {
  const normalized = baseUrl.trim().replace(/\/$/, "");
  if (!isSafeCharacterBaseUrl(normalized)) throw new Error("Character URL must point inside /pets/");
  localStorage.setItem(activeCharacterStorageKey, normalized);
}

function isSafeCharacterBaseUrl(value: string): boolean {
  return value.startsWith("/pets/") && !value.includes("..") && /^\/pets\/[A-Za-z0-9._/-]+\/?$/.test(value);
}
