import type { ModelAction } from "@cyrene/shared-types";

export interface ActionFlowStage {
  readonly actions: readonly ModelAction[];
  readonly durationMs: number;
}

export interface FlowParameterValue {
  readonly id: string;
  readonly value: number;
}

export function buildActionFlowStages(
  actions: readonly ModelAction[],
  actionDurations: Readonly<Record<string, number>>
): readonly ActionFlowStage[] {
  if (!actions.length) {
    return [];
  }

  const stages: ActionFlowStage[] = [];
  let currentStageActions: ModelAction[] = [];
  let currentStageChannels = new Set<string>();
  let pendingOverlayActions: ModelAction[] = [];

  const pushStage = (stageActions: readonly ModelAction[]) => {
    if (!stageActions.length) {
      return;
    }

    stages.push({
      actions: stageActions,
      durationMs: Math.max(...stageActions.map((action) => actionDurations[action.id] ?? getFallbackActionDuration(action)))
    });
  };

  const startStage = (stageActions: readonly ModelAction[]) => {
    currentStageActions = [...stageActions];
    currentStageChannels = new Set(stageActions.flatMap((action) => getFlowChannelIds(action)));
  };

  for (const action of actions) {
    const actionChannels = getFlowChannelIds(action);
    if (isNextScopedFlowAction(action)) {
      pendingOverlayActions.push(action);
      continue;
    }

    if (!currentStageActions.length) {
      startStage([...pendingOverlayActions, action]);
      pendingOverlayActions = [];
      continue;
    }

    const conflictsWithCurrentStage = actionChannels.some((channelId) => currentStageChannels.has(channelId));
    if (conflictsWithCurrentStage) {
      pushStage(currentStageActions);
      startStage([...pendingOverlayActions, action]);
      pendingOverlayActions = [];
      continue;
    }

    currentStageActions = [...currentStageActions, ...pendingOverlayActions, action];
    pendingOverlayActions = [];
    for (const channelId of actionChannels) {
      currentStageChannels.add(channelId);
    }
  }

  pushStage(currentStageActions);

  for (const action of pendingOverlayActions) {
    pushStage([action]);
  }

  return stages;
}

export function calculateFlowDuration(stages: readonly ActionFlowStage[]): number {
  return stages.reduce((total, stage) => total + stage.durationMs, 0);
}

export function getFallbackActionDuration(action: ModelAction): number {
  return action.source === "motion" ? 1600 : 1100;
}

export function mapParameterToChannel(parameterId: string): string {
  const semanticChannels: Record<string, string> = {
    Param: "region:eyes",
    Param2: "region:eyes",
    Param3: "region:eyes",
    ParamEyeLOpen: "region:eyes",
    ParamEyeLSmile: "region:eyes",
    ParamEyeROpen: "region:eyes",
    ParamEyeRSmile: "region:eyes",
    ParamEyeBallX: "region:eyes",
    ParamEyeBallY: "region:eyes",
    ParamBrowLX: "region:brows",
    ParamBrowLY: "region:brows",
    ParamBrowRX: "region:brows",
    ParamBrowRY: "region:brows",
    ParamBrowLAngle: "region:brows",
    ParamBrowRAngle: "region:brows",
    ParamBrowLForm: "region:brows",
    ParamBrowRForm: "region:brows",
    Param4: "region:accessory",
    Param5: "region:face-effect",
    Param6: "region:question-effect",
    Param7: "region:sparkle-effect",
    Param9: "region:face-effect",
    Param10: "region:face-effect",
    Param11: "region:face-effect",
    Param12: "region:face-effect",
    Param13: "region:face-effect",
    Param14: "region:face-effect",
    Param15: "region:face-effect",
    Param17: "region:face-effect",
    Param18: "region:face-effect",
    Param16: "region:rope-switch",
    Param32: "region:swing",
    ParamMouthForm: "region:mouth",
    ParamMouthOpenY: "region:mouth",
    ParamAngleX: "region:head",
    ParamAngleY: "region:head",
    ParamAngleZ: "region:head",
    ParamBodyAngleZ: "region:body"
  };

  return semanticChannels[parameterId] ?? `parameter:${parameterId}`;
}

export function getResetParametersForAction<TParameter extends FlowParameterValue>(
  action: ModelAction,
  resetParameters: readonly TParameter[]
): readonly TParameter[] {
  const actionChannels = new Set(getFlowChannelIds(action));
  return resetParameters.filter((parameter) => actionChannels.has(mapParameterToChannel(parameter.id)));
}

export function getParameterTargetsForAction<TParameter extends FlowParameterValue>(
  action: ModelAction,
  resetParameters: readonly TParameter[],
  actionParameters: Readonly<Record<string, readonly TParameter[]>>
): readonly TParameter[] {
  return mergeParameterTargets(getResetParametersForAction(action, resetParameters), actionParameters[action.id] ?? []);
}

function mergeParameterTargets<TParameter extends FlowParameterValue>(
  resetParameters: readonly TParameter[],
  targetParameters: readonly TParameter[]
): readonly TParameter[] {
  const merged = new Map(resetParameters.map((parameter) => [parameter.id, parameter.value]));
  for (const parameter of targetParameters) {
    merged.set(parameter.id, parameter.value);
  }

  return [...merged.entries()].map(([id, value]) => ({ id, value } as TParameter));
}

export function getFlowChannelIds(action: ModelAction): readonly string[] {
  return [...new Set(action.channelIds.map((channelId) => {
    if (channelId.startsWith("parameter:")) {
      return mapParameterToChannel(channelId.slice("parameter:".length));
    }

    return channelId;
  }))];
}

function isNextScopedFlowAction(action: ModelAction): boolean {
  if (action.scope === "next") {
    return true;
  }

  const channelIds = getFlowChannelIds(action);
  return Boolean(channelIds.length) && channelIds.every(isLegacyNextScopedFlowChannel);
}

function isLegacyNextScopedFlowChannel(channelId: string): boolean {
  return channelId === "region:question-effect" || channelId === "region:sparkle-effect";
}
