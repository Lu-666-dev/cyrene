import type { JsonObject, JsonValue } from "@cyrene/shared-types";

export class ContractValidationError extends Error {
  constructor(
    message: string,
    readonly path: string
  ) {
    super(`${path}: ${message}`);
    this.name = "ContractValidationError";
  }
}

export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireObject(value: unknown, path: string): JsonObject {
  if (!isObject(value)) {
    throw new ContractValidationError("expected object", path);
  }

  return value;
}

export function requireString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ContractValidationError("expected non-empty string", path);
  }

  return value;
}

export function requireNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ContractValidationError("expected finite number", path);
  }

  return value;
}

export function requireStringArray(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) {
    throw new ContractValidationError("expected string array", path);
  }

  return value.map((item, index) => requireString(item, `${path}[${index}]`));
}

export function optionalStringArray(value: unknown, path: string): readonly string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requireStringArray(value, path);
}

export function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }

  if (isObject(value)) {
    return Object.values(value).every(isJsonValue);
  }

  return false;
}
