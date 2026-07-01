import { ContractValidationError, requireNumber, requireObject, requireString } from "./validation.js";

export type CharacterMemoryMode = "off" | "recent" | "automatic";

export interface CharacterChatMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface CharacterChatProfile {
  readonly version: number;
  readonly displayName: string;
  readonly systemPrompt: string;
  readonly firstMessage: string;
  readonly alternateGreetings: readonly string[];
  readonly exampleMessages: readonly CharacterChatMessage[];
  readonly generation: {
    readonly temperature: number;
    readonly topP: number;
    readonly maxTokens: number | null;
  };
  readonly memory: {
    readonly mode: CharacterMemoryMode;
    readonly contextTurns: number;
  };
}

export function parseCharacterChatProfile(value: unknown): CharacterChatProfile {
  const object = requireObject(value, "chat.json");
  const generation = requireObject(object.generation, "chat.json.generation");
  const memory = requireObject(object.memory, "chat.json.memory");
  const mode = requireString(memory.mode, "chat.json.memory.mode") as CharacterMemoryMode;
  if (!(["off", "recent", "automatic"] as const).includes(mode)) {
    throw new ContractValidationError("unsupported memory mode", "chat.json.memory.mode");
  }

  const temperature = requireRange(generation.temperature, 0, 1.5, "chat.json.generation.temperature");
  const topP = requireRange(generation.topP, 0.05, 1, "chat.json.generation.topP");
  const contextTurns = requireInteger(memory.contextTurns, mode === "off" ? 0 : 1, 50, "chat.json.memory.contextTurns");
  const maxTokens = generation.maxTokens === null
    ? null
    : requireInteger(generation.maxTokens, 16, 8192, "chat.json.generation.maxTokens");

  return {
    version: requireInteger(object.version, 1, 1, "chat.json.version"),
    displayName: requireString(object.displayName, "chat.json.displayName"),
    systemPrompt: requireString(object.systemPrompt, "chat.json.systemPrompt"),
    firstMessage: typeof object.firstMessage === "string" ? object.firstMessage : "",
    alternateGreetings: parseStringArray(object.alternateGreetings, "chat.json.alternateGreetings"),
    exampleMessages: parseExampleMessages(object.exampleMessages),
    generation: { temperature, topP, maxTokens },
    memory: { mode, contextTurns }
  };
}

function parseStringArray(value: unknown, path: string): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ContractValidationError("expected string array", path);
  return value.map((item, index) => requireString(item, `${path}[${index}]`));
}

function parseExampleMessages(value: unknown): readonly CharacterChatMessage[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ContractValidationError("expected message array", "chat.json.exampleMessages");
  return value.map((item, index) => {
    const message = requireObject(item, `chat.json.exampleMessages[${index}]`);
    const role = requireString(message.role, `chat.json.exampleMessages[${index}].role`);
    if (role !== "user" && role !== "assistant") {
      throw new ContractValidationError("role must be user or assistant", `chat.json.exampleMessages[${index}].role`);
    }
    return { role, content: requireString(message.content, `chat.json.exampleMessages[${index}].content`) };
  });
}

function requireRange(value: unknown, min: number, max: number, path: string): number {
  const parsed = requireNumber(value, path);
  if (parsed < min || parsed > max) throw new ContractValidationError(`expected ${min}–${max}`, path);
  return parsed;
}

function requireInteger(value: unknown, min: number, max: number, path: string): number {
  const parsed = requireRange(value, min, max, path);
  if (!Number.isInteger(parsed)) throw new ContractValidationError("expected integer", path);
  return parsed;
}
