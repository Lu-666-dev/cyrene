import type {
  CompiledModelActionState,
  ModelAction,
  ModelActionPlaySpec,
  ModelActionQueue
} from "@cyrene/shared-types";
import type { Live2DExpressionEntry, Live2DModelSettingsCatalog, Live2DMotionEntry } from "./live2d-model-settings.js";

export interface ExpressionParameterHint {
  readonly id: string;
  readonly value: number;
  readonly blend?: string;
}

export type ExpressionParameterHints = Record<string, readonly ExpressionParameterHint[]>;

export interface ModelActionExtraction {
  readonly actions: readonly ModelAction[];
  readonly resetActions: readonly ModelAction[];
}

export function createModelActionExtraction(
  catalog: Live2DModelSettingsCatalog,
  expressionParameters: ExpressionParameterHints = {}
): ModelActionExtraction {
  const resetActions: ModelAction[] = [];
  const bySourceKey = new Map<string, ModelAction>();

  for (const motion of catalog.motions) {
    const action = motion.file
      ? createFileMotionAction(motion)
      : createExpressionMotionAction(motion, expressionParameters);

    if (!action) {
      continue;
    }

    if (action.tags.includes("reset")) {
      resetActions.push(action);
      if (!action.tags.includes("switch")) {
        continue;
      }
    }

    const existing = bySourceKey.get(action.sourceKey);
    if (!existing || actionScore(action) > actionScore(existing)) {
      bySourceKey.set(action.sourceKey, action);
    }
  }

  for (const expression of catalog.expressions) {
    if (bySourceKey.has(`expression:${expression.name}`)) {
      continue;
    }

    const action = createStandaloneExpressionAction(expression, expressionParameters);
    if (action.tags.includes("reset")) {
      resetActions.push(action);
      if (!action.tags.includes("switch")) {
        continue;
      }
    }

    bySourceKey.set(action.sourceKey, action);
  }

  const actions = [...bySourceKey.values()].sort((left, right) => left.label.localeCompare(right.label, "zh-Hans-CN"));
  return {
    actions: markLifecycleActions(actions),
    resetActions: dedupeActions(resetActions)
  };
}

export function compileModelActionQueues(actions: readonly ModelAction[]): readonly ModelActionQueue[] {
  const queueMap = new Map<string, ModelAction[]>();

  for (const action of actions) {
    const channelIds = action.channelIds.length ? action.channelIds : ["channel:default"];
    for (const channelId of channelIds) {
      const queue = queueMap.get(channelId) ?? [];
      queue.push(action);
      queueMap.set(channelId, queue);
    }
  }

  return [...queueMap.entries()]
    .map(([channelId, queueActions]) => ({ channelId, actions: queueActions }))
    .sort((left, right) => left.channelId.localeCompare(right.channelId));
}

export function createCompiledModelActionState(input: {
  readonly id: string;
  readonly name: string;
  readonly actions: readonly ModelAction[];
}): CompiledModelActionState {
  const name = input.name.trim();
  if (!name) {
    throw new Error("state name cannot be empty");
  }

  return {
    id: input.id,
    name,
    actions: input.actions,
    queues: compileModelActionQueues(input.actions)
  };
}

function createFileMotionAction(motion: Live2DMotionEntry): ModelAction {
  const label = normalizeMotionLabel(motion.name ?? motion.file ?? motion.group);
  const tags = [
    "motion",
    ...motionTags(motion, label)
  ];

  return {
    id: stableId("motion", motion.file ?? `${motion.group}:${motion.name ?? "unnamed"}`),
    kind: "atomic",
    scope: "self",
    label,
    source: "motion",
    sourceKey: `motion-file:${motion.file}`,
    channelIds: ["body:motion"],
    play: createMotionPlaySpec(motion),
    tags
  };
}

function createExpressionMotionAction(
  motion: Live2DMotionEntry,
  expressionParameters: ExpressionParameterHints
): ModelAction | null {
  if (!motion.expression) {
    return null;
  }

  const parameters = expressionParameters[motion.expression] ?? [];
  const label = normalizeMotionLabel(motion.name ?? motion.expression);
  const tags = [
    "expression",
    ...motionTags(motion, label),
    ...expressionTags(parameters)
  ];

  if (isResetName(motion.expression, parameters)) {
    tags.push("reset");
  }

  return {
    id: stableId("expression-motion", `${motion.group}:${motion.name ?? motion.expression}:${motion.expression}`),
    kind: inferActionKind(motion, parameters),
    scope: inferActionScope(motion, parameters),
    label,
    source: "expression",
    sourceKey: `expression:${motion.expression}`,
    channelIds: inferExpressionChannels(parameters, motion.expression),
    play: createMotionPlaySpec(motion, motion.expression),
    tags
  };
}

function createStandaloneExpressionAction(
  expression: Live2DExpressionEntry,
  expressionParameters: ExpressionParameterHints
): ModelAction {
  const parameters = expressionParameters[expression.name] ?? [];
  const tags = [
    "expression",
    ...expressionTags(parameters)
  ];

  if (isResetName(expression.name, parameters)) {
    tags.push("reset");
  }

  return {
    id: stableId("expression", expression.name),
    kind: parameters.length > 1 ? "composite" : inferStatefulExpressionKind(expression.name, parameters),
    scope: inferExpressionScope(parameters),
    label: expression.name,
    source: "expression",
    sourceKey: `expression:${expression.name}`,
    channelIds: inferExpressionChannels(parameters, expression.name),
    play: {
      expression: expression.name
    },
    tags
  };
}

function markLifecycleActions(actions: readonly ModelAction[]): readonly ModelAction[] {
  const ropeOn = actions.find((action) => action.sourceKey === "expression:开");
  const ropeOff = actions.find((action) => action.sourceKey === "expression:关");

  return actions.map((action) => {
    if (!ropeOn || !ropeOff || !isSwingLoop(action)) {
      return action;
    }

    return {
      ...action,
      kind: "composite",
      tags: [...new Set([...action.tags, "lifecycle", "needs-before", "needs-after"])],
      steps: [
        { id: `${action.id}:before`, phase: "before", actionId: ropeOn.id },
        { id: `${action.id}:main`, phase: "main", actionId: action.id },
        { id: `${action.id}:after`, phase: "after", actionId: ropeOff.id }
      ]
    };
  });
}

function inferActionKind(motion: Live2DMotionEntry, parameters: readonly ExpressionParameterHint[]): ModelAction["kind"] {
  if (motion.varFloats.some((entry) => entry.type === 2 || entry.code.startsWith("assign "))) {
    return "stateful";
  }

  if (parameters.length > 1) {
    return "composite";
  }

  return "atomic";
}

function inferActionScope(
  motion: Live2DMotionEntry,
  parameters: readonly ExpressionParameterHint[]
): ModelAction["scope"] {
  if (motion.varFloats.some((entry) => entry.type === 2 || entry.code.startsWith("assign "))) {
    return "persistent";
  }

  return inferExpressionScope(parameters);
}

function inferStatefulExpressionKind(name: string, parameters: readonly ExpressionParameterHint[]): ModelAction["kind"] {
  if (parameters.some((parameter) => parameter.id === "Param16") || name === "开" || name === "关") {
    return "stateful";
  }

  return parameters.length > 1 ? "composite" : "atomic";
}

function inferExpressionScope(parameters: readonly ExpressionParameterHint[]): ModelAction["scope"] {
  if (parameters.some((parameter) => parameter.id === "Param16")) {
    return "persistent";
  }

  if (parameters.length > 0 && parameters.every((parameter) => isNextScopedParameter(parameter.id))) {
    return "next";
  }

  return "self";
}

function inferExpressionChannels(parameters: readonly ExpressionParameterHint[], fallback: string): readonly string[] {
  if (!parameters.length) {
    return [`expression:${fallback}`];
  }

  return [...new Set(parameters.map((parameter) => `parameter:${parameter.id}`))].sort();
}

function isNextScopedParameter(parameterId: string): boolean {
  return parameterId === "Param6" || parameterId === "Param7";
}

function motionTags(motion: Live2DMotionEntry, label: string): readonly string[] {
  const tags: string[] = [];

  if (isResetLabel(label)) {
    tags.push("reset");
  }

  if (motion.nextMotion) {
    tags.push("returns");
  }

  if (motion.varFloats.some((entry) => entry.type === 2 || entry.code.startsWith("assign "))) {
    tags.push("stateful");
  }

  if (motion.varFloats.some((entry) => entry.code.includes("equal "))) {
    tags.push("gated");
  }

  if (motion.group === "Tick3" || label.includes("待机")) {
    tags.push("idle");
  }

  return tags;
}

function expressionTags(parameters: readonly ExpressionParameterHint[]): readonly string[] {
  const tags: string[] = [];

  if (parameters.length > 1) {
    tags.push("multi-channel");
  }

  if (parameters.some((parameter) => parameter.id === "Param16")) {
    tags.push("switch");
  }

  return tags;
}

function isSwingLoop(action: ModelAction): boolean {
  return action.play.motionGroup === "Tick3" && action.label.includes("荡秋千");
}

function isResetName(name: string, parameters: readonly ExpressionParameterHint[]): boolean {
  return isResetLabel(name) || parameters.every((parameter) => parameter.value === 0);
}

function isResetLabel(label: string): boolean {
  return label.includes("回正") || label.includes("初始化") || label === "开/回正";
}

function normalizeMotionLabel(label: string): string {
  return label.replace("（待机）", "").replace("(待机)", "").replace("/回正", "").trim();
}

function actionScore(action: ModelAction): number {
  let score = 0;

  if (!action.tags.includes("idle")) {
    score += 3;
  }

  if (action.play.motionName) {
    score += 2;
  }

  if (action.play.motionGroup !== "Tick3") {
    score += 1;
  }

  return score;
}

function dedupeActions(actions: readonly ModelAction[]): readonly ModelAction[] {
  const bySourceKey = new Map<string, ModelAction>();
  for (const action of actions) {
    bySourceKey.set(action.sourceKey, action);
  }

  return [...bySourceKey.values()];
}

function stableId(prefix: string, value: string): string {
  return `${prefix}.${value}`
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, ".")
    .replace(/^\.+|\.+$/g, "")
    .toLowerCase();
}

function createMotionPlaySpec(motion: Live2DMotionEntry, expression?: string): ModelActionPlaySpec {
  const play: ModelActionPlaySpec = {
    motionGroup: motion.group,
    motionIndex: motion.index
  };

  if (motion.name !== undefined) {
    return expression === undefined
      ? { ...play, motionName: motion.name }
      : { ...play, motionName: motion.name, expression };
  }

  return expression === undefined
    ? play
    : { ...play, expression };
}
