import { ContractValidationError, requireNumber, requireObject, requireString } from "./validation.js";

export interface Live2DVarFloatEntry {
  readonly name: string;
  readonly type: number;
  readonly code: string;
}

export interface Live2DMotionEntry {
  readonly group: string;
  readonly index: number;
  readonly name?: string;
  readonly file?: string;
  readonly expression?: string;
  readonly nextMotion?: string;
  readonly wrapMode?: number;
  readonly varFloats: readonly Live2DVarFloatEntry[];
}

export interface Live2DExpressionEntry {
  readonly name: string;
  readonly file: string;
}

export interface Live2DHitAreaEntry {
  readonly name: string;
  readonly id: string;
  readonly motion?: string;
}

export interface Live2DModelSettingsCatalog {
  readonly moc: string;
  readonly textures: readonly string[];
  readonly physics?: string;
  readonly motions: readonly Live2DMotionEntry[];
  readonly expressions: readonly Live2DExpressionEntry[];
  readonly hitAreas: readonly Live2DHitAreaEntry[];
}

export function parseLive2DModelSettingsCatalog(value: unknown): Live2DModelSettingsCatalog {
  const object = requireObject(value, "model3.json");
  const fileReferences = requireObject(object.FileReferences, "model3.json.FileReferences");
  const motionsObject = fileReferences.Motions === undefined
    ? {}
    : requireObject(fileReferences.Motions, "model3.json.FileReferences.Motions");

  return removeUndefined({
    moc: requireString(fileReferences.Moc, "model3.json.FileReferences.Moc"),
    textures: parseTextures(fileReferences.Textures),
    physics: fileReferences.Physics === undefined
      ? undefined
      : requireString(fileReferences.Physics, "model3.json.FileReferences.Physics"),
    motions: parseMotions(motionsObject),
    expressions: parseExpressions(fileReferences.Expressions),
    hitAreas: parseHitAreas(object.HitAreas)
  }) as Live2DModelSettingsCatalog;
}

function parseTextures(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    throw new ContractValidationError("expected texture array", "model3.json.FileReferences.Textures");
  }

  return value.map((texture, index) => requireString(texture, `model3.json.FileReferences.Textures[${index}]`));
}

function parseMotions(value: Record<string, unknown>): readonly Live2DMotionEntry[] {
  const motions: Live2DMotionEntry[] = [];

  for (const [group, rawEntries] of Object.entries(value)) {
    if (!Array.isArray(rawEntries)) {
      throw new ContractValidationError("expected motion array", `model3.json.FileReferences.Motions.${group}`);
    }

    rawEntries.forEach((rawEntry, index) => {
      const entry = requireObject(rawEntry, `model3.json.FileReferences.Motions.${group}[${index}]`);
      motions.push(removeUndefined({
        group,
        index,
        name: entry.Name === undefined
          ? undefined
          : requireString(entry.Name, `model3.json.FileReferences.Motions.${group}[${index}].Name`),
        file: entry.File === undefined
          ? undefined
          : requireString(entry.File, `model3.json.FileReferences.Motions.${group}[${index}].File`),
        expression: entry.Expression === undefined
          ? undefined
          : requireString(entry.Expression, `model3.json.FileReferences.Motions.${group}[${index}].Expression`),
        nextMotion: entry.NextMtn === undefined
          ? undefined
          : requireString(entry.NextMtn, `model3.json.FileReferences.Motions.${group}[${index}].NextMtn`),
        wrapMode: entry.WrapMode === undefined
          ? undefined
          : requireNumber(entry.WrapMode, `model3.json.FileReferences.Motions.${group}[${index}].WrapMode`),
        varFloats: parseVarFloats(entry.VarFloats, `model3.json.FileReferences.Motions.${group}[${index}].VarFloats`)
      }) as Live2DMotionEntry);
    });
  }

  return motions;
}

function parseVarFloats(value: unknown, path: string): readonly Live2DVarFloatEntry[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new ContractValidationError("expected VarFloats array", path);
  }

  return value.map((rawVarFloat, index) => {
    const varFloat = requireObject(rawVarFloat, `${path}[${index}]`);
    return {
      name: requireString(varFloat.Name, `${path}[${index}].Name`),
      type: requireNumber(varFloat.Type, `${path}[${index}].Type`),
      code: requireString(varFloat.Code, `${path}[${index}].Code`)
    };
  });
}

function parseExpressions(value: unknown): readonly Live2DExpressionEntry[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new ContractValidationError("expected expression array", "model3.json.FileReferences.Expressions");
  }

  return value.map((rawExpression, index) => {
    const expression = requireObject(rawExpression, `model3.json.FileReferences.Expressions[${index}]`);
    return {
      name: requireString(expression.Name, `model3.json.FileReferences.Expressions[${index}].Name`),
      file: requireString(expression.File, `model3.json.FileReferences.Expressions[${index}].File`)
    };
  });
}

function parseHitAreas(value: unknown): readonly Live2DHitAreaEntry[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new ContractValidationError("expected hit area array", "model3.json.HitAreas");
  }

  return value.map((rawHitArea, index) => {
    const hitArea = requireObject(rawHitArea, `model3.json.HitAreas[${index}]`);
    return removeUndefined({
      name: requireString(hitArea.Name, `model3.json.HitAreas[${index}].Name`),
      id: requireString(hitArea.Id, `model3.json.HitAreas[${index}].Id`),
      motion: hitArea.Motion === undefined
        ? undefined
        : requireString(hitArea.Motion, `model3.json.HitAreas[${index}].Motion`)
    }) as Live2DHitAreaEntry;
  });
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  ) as T;
}
