import { useEffect, useMemo, useRef, useState } from "react";
import {
  compileModelActionQueues,
  createCompiledModelActionState,
  createModelActionExtraction
} from "@cyrene/content";
import type { ExpressionParameterHints } from "@cyrene/content";
import type { CompiledModelActionState, ModelAction, ModelActionQueue } from "@cyrene/shared-types";
import { Application } from "pixi.js";
import * as PIXI from "pixi.js";
import { Live2DModel, MotionPriority } from "pixi-live2d-display/cubism4";
import { fetchJson, loadLive2DContentBundle } from "../runtime/content-loader";
import { getActiveCharacterBaseUrl } from "../runtime/active-character";
import {
  buildActionFlowStages,
  calculateFlowDuration,
  getFallbackActionDuration,
  getFlowChannelIds,
  getParameterTargetsForAction,
  getResetParametersForAction
} from "./action-flow";
import type { ActionFlowStage } from "./action-flow";

const packBaseUrl = getActiveCharacterBaseUrl();
const actionNameOverridesStoragePrefix = "cyrene.modelLab.actionNameOverrides";

interface ModelData {
  readonly id: string;
  readonly entryUrl: string;
  readonly actions: readonly ModelAction[];
  readonly resetActions: readonly ModelAction[];
  readonly resetParameters: readonly ModelParameterValue[];
  readonly actionParameters: Readonly<Record<string, readonly ModelParameterValue[]>>;
  readonly actionTransitionMs: Readonly<Record<string, number>>;
  readonly actionDurations: Readonly<Record<string, number>>;
  readonly motionCount: number;
  readonly expressionCount: number;
}

interface ModelParameterValue {
  readonly id: string;
  readonly value: number;
}

interface ModelExpressionMetadata {
  readonly parameters: ExpressionParameterHints;
  readonly fadeInMsByName: Readonly<Record<string, number>>;
}

export function App() {
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const modelRef = useRef<Live2DModel | null>(null);
  const playbackSerialRef = useRef(0);
  const [modelData, setModelData] = useState<ModelData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [buffer, setBuffer] = useState<ModelAction[]>([]);
  const [states, setStates] = useState<CompiledModelActionState[]>([]);
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  const [selectedStateId, setSelectedStateId] = useState<string | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [isDialogOpen, setDialogOpen] = useState(false);
  const [isRenameDialogOpen, setRenameDialogOpen] = useState(false);
  const [stateName, setStateName] = useState("");
  const [actionName, setActionName] = useState("");
  const [flowProgress, setFlowProgress] = useState(0);
  const [flowDurationMs, setFlowDurationMs] = useState(0);
  const [isFlowPlaying, setFlowPlaying] = useState(false);
  const [selectedLibraryChannel, setSelectedLibraryChannel] = useState("all");

  const queues = useMemo(() => compileModelActionQueues(buffer), [buffer]);
  const bufferFlowStages = useMemo(() => buildActionFlowStages(buffer, modelData?.actionDurations ?? {}), [buffer, modelData]);
  const bufferFlowDurationMs = useMemo(() => calculateFlowDuration(bufferFlowStages), [bufferFlowStages]);
  const selectedState = states.find((state) => state.id === selectedStateId) ?? null;
  const selectedAction = modelData?.actions.find((action) => action.id === selectedActionId) ?? null;
  const actionChannels = useMemo(() => createActionChannelOptions(modelData?.actions ?? []), [modelData]);
  const visibleActions = useMemo(() => (modelData?.actions ?? []).filter((action) => (
    selectedLibraryChannel === "all" || getFlowChannelIds(action).includes(selectedLibraryChannel)
  )), [modelData, selectedLibraryChannel]);
  const bufferTracks = useMemo(() => createBufferTracks(buffer), [buffer]);

  useEffect(() => {
    void loadModelData()
      .then((data) => setModelData(data))
      .catch((error: unknown) => setLoadError(error instanceof Error ? error.message : String(error)));
  }, []);

  useEffect(() => {
    if (!isFlowPlaying) {
      setFlowDurationMs(bufferFlowDurationMs);
      setFlowProgress(0);
    }
  }, [bufferFlowDurationMs, isFlowPlaying]);

  useEffect(() => {
    if (!canvasHostRef.current || !modelData) {
      return;
    }

    let cancelled = false;
    const app = new Application({
      width: canvasHostRef.current.clientWidth,
      height: canvasHostRef.current.clientHeight,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1
    });

    appRef.current = app;
    canvasHostRef.current.appendChild(app.view as HTMLCanvasElement);
    Object.assign(globalThis, { PIXI });

    void Live2DModel.from(modelData.entryUrl)
      .then((model) => {
        if (cancelled) {
          model.destroy();
          return;
        }

        modelRef.current = model;
        app.stage.addChild(model as unknown as PIXI.DisplayObject);
        fitModel(app, model);
      })
      .catch((error: unknown) => {
        setLoadError(error instanceof Error ? error.message : String(error));
      });

    const resize = () => {
      if (!canvasHostRef.current || !appRef.current || !modelRef.current) {
        return;
      }

      appRef.current.renderer.resize(canvasHostRef.current.clientWidth, canvasHostRef.current.clientHeight);
      fitModel(appRef.current, modelRef.current);
    };

    window.addEventListener("resize", resize);

    return () => {
      cancelled = true;
      window.removeEventListener("resize", resize);
      modelRef.current = null;
      app.destroy(true, { children: true, texture: false, baseTexture: false });
      appRef.current = null;
    };
  }, [modelData]);

  const resetModelState = async (serial: number) => {
    const model = modelRef.current;
    if (!model || !modelData || playbackSerialRef.current !== serial) {
      return;
    }

    stopActivePlayback(model);
    applyCoreParameterReset(model, modelData.resetParameters);

    for (const expressionName of getPreviewResetExpressions(modelData.resetActions)) {
      if (playbackSerialRef.current !== serial) {
        return;
      }

      void model.expression(expressionName);
    }
  };

  const playAction = async (action: ModelAction, shouldReset = true) => {
    const model = modelRef.current;
    const data = modelData;
    if (!model || !data) {
      return;
    }

    const serial = shouldReset ? ++playbackSerialRef.current : playbackSerialRef.current;
    if (shouldReset) {
      clearFlowProgress(setFlowPlaying, setFlowProgress, setFlowDurationMs);
    }

    const canTransitionInPlace = action.source === "expression" && action.play.expression;
    if (shouldReset && !canTransitionInPlace) {
      await resetModelState(serial);
    }

    if (playbackSerialRef.current !== serial) {
      return;
    }

    await playActionWithLifecycle(
      model,
      data.actions,
      action,
      data.resetParameters,
      data.actionParameters,
      data.actionTransitionMs,
      serial,
      playbackSerialRef
    );
  };

  const playActionFlow = async (actions: readonly ModelAction[]) => {
    const model = modelRef.current;
    const data = modelData;
    if (!model || !data) {
      return;
    }

    const serial = ++playbackSerialRef.current;
    const flowStages = actions === buffer ? bufferFlowStages : buildActionFlowStages(actions, data.actionDurations);
    const totalDurationMs = calculateFlowDuration(flowStages);
    setFlowDurationMs(totalDurationMs);
    setFlowProgress(0);
    setFlowPlaying(actions.length > 0);

    const startedAt = Date.now();
    const progressTimer = window.setInterval(() => {
      const nextProgress = totalDurationMs > 0
        ? Math.min((Date.now() - startedAt) / totalDurationMs, 1)
        : 0;
      setFlowProgress(nextProgress);
    }, 80);

    await resetModelState(serial);

    try {
      await playActionStages(
        model,
        data.actions,
        data.resetParameters,
        data.actionParameters,
        data.actionTransitionMs,
        flowStages,
        serial,
        playbackSerialRef
      );

      if (playbackSerialRef.current === serial) {
        setFlowProgress(1);
        await resetModelState(serial);
      }
    } finally {
      window.clearInterval(progressTimer);
      if (playbackSerialRef.current === serial) {
        setFlowPlaying(false);
      }
    }
  };

  const previewBufferFlow = () => {
    setSelectedActionId(null);
    setSelectedStateId(null);
    void playActionFlow(buffer);
  };

  const releasePreview = async () => {
    const serial = ++playbackSerialRef.current;
    setSelectedActionId(null);
    setSelectedStateId(null);
    clearFlowProgress(setFlowPlaying, setFlowProgress, setFlowDurationMs);
    await resetModelState(serial);
  };

  const previewAction = (action: ModelAction) => {
    setSelectedStateId(null);

    if (selectedActionId === action.id) {
      void releasePreview();
      return;
    }

    setSelectedActionId(action.id);
    void playAction(action);
  };

  const addToBuffer = (action: ModelAction) => {
    setBuffer((current) => [...current, action]);
  };

  const openRenameDialog = () => {
    if (!selectedAction) {
      return;
    }

    setActionName(selectedAction.label);
    setRenameDialogOpen(true);
  };

  const renameSelectedAction = () => {
    if (!selectedAction) {
      return;
    }

  const nextLabel = actionName.trim();
    if (!nextLabel) {
      setLoadError("动作名称不能为空");
      return;
    }

    if (modelData) {
      saveActionNameOverride(modelData.id, selectedAction.id, nextLabel);
    }

    setModelData((current) => current
      ? {
        ...current,
        actions: renameActions(current.actions, selectedAction.id, nextLabel),
        resetActions: renameActions(current.resetActions, selectedAction.id, nextLabel)
      }
      : current);
    setBuffer((current) => renameActions(current, selectedAction.id, nextLabel));
    setStates((current) => current.map((state) => {
      const actions = renameActions(state.actions, selectedAction.id, nextLabel);
      return {
        ...state,
        actions,
        queues: compileModelActionQueues(actions)
      };
    }));
    setLoadError(null);
    setRenameDialogOpen(false);
    setActionName("");
  };

  const removeFromBuffer = (index: number) => {
    setBuffer((current) => current.filter((_, currentIndex) => currentIndex !== index));
  };

  const moveBufferItem = (fromIndex: number, toIndex: number) => {
    setBuffer((current) => {
      if (fromIndex === toIndex || toIndex < 0 || toIndex >= current.length) {
        return current;
      }

      const next = [...current];
      const [item] = next.splice(fromIndex, 1);
      if (!item) {
        return current;
      }

      next.splice(toIndex, 0, item);
      return next;
    });
  };

  const addState = () => {
    try {
      const state = createCompiledModelActionState({
        id: `state_${Date.now()}`,
        name: stateName,
        actions: buffer
      });

      setStates((current) => [...current, state]);
      setSelectedStateId(state.id);
      setStateName("");
      setDialogOpen(false);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  };

  const deleteState = (stateId: string) => {
    setStates((current) => current.filter((state) => state.id !== stateId));
    setSelectedStateId((current) => current === stateId ? null : current);
  };

  return (
    <main className="app-shell">
      <section className="preview-pane">
        <div className="preview-toolbar">
          <div>
            <h1>Cyrene Model Lab</h1>
            <p>
              {modelData
                ? `${modelData.id} · ${modelData.motionCount} motions · ${modelData.expressionCount} expressions · ${modelData.actions.length} actions`
                : "Loading model pack"}
            </p>
          </div>
          <button className="secondary-button" type="button" onClick={() => void releasePreview()} data-testid="reset-preview">
            回正
          </button>
        </div>
        <div className="canvas-host" ref={canvasHostRef}>
          {loadError ? <div className="error-panel">{loadError}</div> : null}
        </div>
      </section>

      <section className="control-pane composer-mode">
        <section className="column action-library">
          <div className="column-header">
            <div>
              <h2>动作库</h2>
              <small>{modelData?.actions.length ?? 0} 个可编排动作</small>
            </div>
            <button className="secondary-button" type="button" disabled={!selectedAction} onClick={openRenameDialog} data-testid="edit-action">
              编辑
            </button>
          </div>
          <div className="library-grid">
            <div className="channel-tabs" aria-label="动作通道">
              <button
                className={selectedLibraryChannel === "all" ? "selected" : ""}
                type="button"
                onClick={() => setSelectedLibraryChannel("all")}
              >
                <span>全部</span>
                <small>{modelData?.actions.length ?? 0}</small>
              </button>
              {actionChannels.map((channel) => (
                <button
                  className={selectedLibraryChannel === channel.id ? "selected" : ""}
                  key={channel.id}
                  type="button"
                  onClick={() => setSelectedLibraryChannel(channel.id)}
                >
                  <span>{channel.label}</span>
                  <small>{channel.count}</small>
                </button>
              ))}
            </div>
            <div className="list">
            {visibleActions.map((action) => (
              <div
                className={`action-card ${selectedActionId === action.id ? "selected" : ""}`}
                key={action.id}
                data-testid="action-card"
              >
                <button className="action-main" type="button" onClick={() => previewAction(action)}>
                  <span>{action.label}</span>
                  <small>{formatActionChannels(action)}</small>
                  <ActionBadges action={action} />
                </button>
                <button
                  className="add-action-button"
                  type="button"
                  aria-label={`添加 ${action.label}`}
                  data-testid="add-action"
                  onClick={() => addToBuffer(action)}
                >
                  +
                </button>
              </div>
            ))}
              {visibleActions.length === 0 ? <div className="empty-state">当前通道没有可用动作</div> : null}
            </div>
          </div>
        </section>

        <section className="column action-buffer">
          <div className="column-header">
            <div>
              <h2>编排缓存</h2>
              <small>拖动改变顺序，同通道按顺序排队</small>
            </div>
            <button className="secondary-button" type="button" onClick={() => setBuffer([])} disabled={buffer.length === 0}>
              清空
            </button>
          </div>
          <div className="buffer-tracks">
            {bufferTracks.map((track) => (
              <section className="buffer-track" key={track.channelId}>
                <div className="track-title">
                  <span>{formatChannelLabel(track.channelId)}</span>
                  <small>{track.items.length} steps</small>
                </div>
                <div className="track-lane">
                  {track.items.map(({ action, index }) => (
              <div
                className="buffer-row"
                key={`${track.channelId}.${action.id}.${index}`}
                draggable
                data-testid="buffer-row"
                onClick={() => playAction(action)}
                onDragStart={() => setDraggedIndex(index)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (draggedIndex !== null) {
                    moveBufferItem(draggedIndex, index);
                  }
                  setDraggedIndex(null);
                }}
                onDragEnd={() => setDraggedIndex(null)}
              >
                <b>{index + 1}</b>
                <button className="buffer-main" type="button">
                  <span>{action.label}</span>
                  <small>{formatActionChannels(action)}</small>
                </button>
                <button className="icon-button" type="button" aria-label={`删除 ${action.label}`} onClick={(event) => {
                  event.stopPropagation();
                  removeFromBuffer(index);
                }}>
                  ×
                </button>
              </div>
                  ))}
                </div>
              </section>
            ))}
            {buffer.length === 0 ? <div className="empty-state">从左侧点击动作加入缓存</div> : null}
          </div>
          <div className="flow-progress">
            <div className="flow-progress-meta">
              <span>{isFlowPlaying ? "流程播放中" : "流程时长"}</span>
              <small>{formatDuration(flowProgress * flowDurationMs)} / {formatDuration(flowDurationMs)}</small>
            </div>
            <div className="progress-track" aria-label="流程预览进度">
              <div className="progress-fill" style={{ width: `${Math.round(flowProgress * 100)}%` }} />
            </div>
          </div>
          <div className="buffer-footer">
            <button
              className="secondary-button"
              type="button"
              disabled={buffer.length === 0}
              data-testid="preview-flow"
              onClick={previewBufferFlow}
            >
              流程预览
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={buffer.length === 0}
              data-testid="save-state"
              onClick={() => setDialogOpen(true)}
            >
              保存为状态
            </button>
          </div>
        </section>

        <section className="column queue-panel">
          <div className="column-header">
            <div>
              <h2>队列预览</h2>
              <small>{queues.length} 条独立通道</small>
            </div>
          </div>
          <QueuePreview queues={queues} onPlayAction={playAction} />
          <div className="saved-section">
            <div className="section-title">
              <h2>已保存状态</h2>
              <small>{selectedState ? selectedState.name : "点击即播放整组"}</small>
            </div>
            <div className="saved-state-list">
              {states.map((state) => (
                <div
                  className={`state-row ${selectedStateId === state.id ? "selected" : ""}`}
                  key={state.id}
                  data-testid="state-row"
                  onClick={() => {
                    setSelectedStateId(state.id);
                    void playActionFlow(state.actions);
                  }}
                >
                  <button className="state-main" type="button">
                    <span>{state.name}</span>
                    <small>{state.queues.map((queue) => `${queue.channelId}×${queue.actions.length}`).join(" · ")}</small>
                  </button>
                  <button className="icon-button danger" type="button" aria-label={`删除 ${state.name}`} onClick={(event) => {
                    event.stopPropagation();
                    deleteState(state.id);
                  }}>
                    ×
                  </button>
                </div>
              ))}
              {states.length === 0 ? <div className="empty-state">还没有保存状态</div> : null}
            </div>
          </div>
        </section>
      </section>

      {isDialogOpen ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="state-dialog-title">
            <h2 id="state-dialog-title">保存状态</h2>
            <input
              autoFocus
              value={stateName}
              onChange={(event) => setStateName(event.target.value)}
              placeholder="状态名称不能为空"
              data-testid="state-name"
            />
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={() => setDialogOpen(false)} data-testid="cancel-state">
                取消
              </button>
              <button className="primary-button" type="button" onClick={addState} data-testid="confirm-state">
                确定
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isRenameDialogOpen ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="rename-dialog-title">
            <h2 id="rename-dialog-title">编辑动作名称</h2>
            <input
              autoFocus
              value={actionName}
              onChange={(event) => setActionName(event.target.value)}
              placeholder="动作名称不能为空"
              data-testid="action-name"
            />
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={() => setRenameDialogOpen(false)} data-testid="cancel-rename">
                取消
              </button>
              <button className="primary-button" type="button" onClick={renameSelectedAction} data-testid="confirm-rename">
                确定
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function renameActions<TAction extends ModelAction>(
  actions: readonly TAction[],
  actionId: string,
  label: string
): TAction[] {
  return actions.map((action) => action.id === actionId
    ? { ...action, label } as TAction
    : action);
}

function applyActionNameOverrides<TAction extends ModelAction>(
  actions: readonly TAction[],
  overrides: Readonly<Record<string, string>>
): readonly TAction[] {
  return actions.map((action) => overrides[action.id]
    ? { ...action, label: overrides[action.id] } as TAction
    : action);
}

function applyActionChannelOverrides<TAction extends ModelAction>(
  actions: readonly TAction[],
  overrides: Readonly<Record<string, readonly string[]>>
): readonly TAction[] {
  return actions.map((action) => overrides[action.id]
    ? { ...action, channelIds: overrides[action.id] } as TAction
    : action);
}

function loadActionNameOverrides(packId: string): Readonly<Record<string, string>> {
  try {
    const raw = window.localStorage.getItem(getActionNameOverridesStorageKey(packId));
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(Object.entries(parsed)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0));
  } catch {
    return {};
  }
}

function saveActionNameOverride(packId: string, actionId: string, label: string): void {
  const overrides = {
    ...loadActionNameOverrides(packId),
    [actionId]: label
  };
  window.localStorage.setItem(getActionNameOverridesStorageKey(packId), JSON.stringify(overrides));
}

function getActionNameOverridesStorageKey(packId: string): string {
  return `${actionNameOverridesStoragePrefix}.${packId}`;
}

interface ActionChannelOption {
  readonly id: string;
  readonly label: string;
  readonly count: number;
}

interface BufferTrack {
  readonly channelId: string;
  readonly items: readonly {
    readonly action: ModelAction;
    readonly index: number;
  }[];
}

function createActionChannelOptions(actions: readonly ModelAction[]): readonly ActionChannelOption[] {
  const counts = new Map<string, number>();
  for (const action of actions) {
    for (const channelId of getFlowChannelIds(action)) {
      counts.set(channelId, (counts.get(channelId) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([id, count]) => ({ id, label: formatChannelLabel(id), count }))
    .sort((left, right) => channelSortScore(left.id) - channelSortScore(right.id) || left.label.localeCompare(right.label));
}

function createBufferTracks(actions: readonly ModelAction[]): readonly BufferTrack[] {
  const tracks = new Map<string, { action: ModelAction; index: number }[]>();
  actions.forEach((action, index) => {
    for (const channelId of getFlowChannelIds(action)) {
      const items = tracks.get(channelId) ?? [];
      items.push({ action, index });
      tracks.set(channelId, items);
    }
  });

  return [...tracks.entries()]
    .map(([channelId, items]) => ({ channelId, items }))
    .sort((left, right) => channelSortScore(left.channelId) - channelSortScore(right.channelId) || left.channelId.localeCompare(right.channelId));
}

function formatActionChannels(action: ModelAction): string {
  return getFlowChannelIds(action).map(formatChannelLabel).join(" / ");
}

function formatChannelLabel(channelId: string): string {
  const labels: Record<string, string> = {
    "region:eyes": "眼睛",
    "region:brows": "眉毛",
    "region:mouth": "嘴巴",
    "region:head": "头部",
    "region:body": "身体",
    "region:swing": "秋千",
    "region:rope-switch": "绳子",
    "region:accessory": "配件",
    "region:question-effect": "问号特效",
    "region:sparkle-effect": "闪耀特效",
    "region:face-effect": "面部特效",
    "body:motion": "身体动作"
  };

  return labels[channelId] ?? channelId.replace(/^region:/, "").replace(/^parameter:/, "");
}

function channelSortScore(channelId: string): number {
  const order = [
    "region:eyes",
    "region:brows",
    "region:mouth",
    "region:head",
    "region:body",
    "body:motion",
    "region:swing",
    "region:rope-switch",
    "region:accessory",
    "region:question-effect",
    "region:sparkle-effect",
    "region:face-effect"
  ];
  const index = order.indexOf(channelId);
  return index === -1 ? 100 : index;
}

function ActionBadges({ action }: { readonly action: ModelAction }) {
  return (
    <span className="badges">
      <i>{action.kind}</i>
      {action.tags.slice(0, 3).map((tag) => <i key={tag}>{tag}</i>)}
    </span>
  );
}

async function playActionWithLifecycle(
  model: Live2DModel,
  actions: readonly ModelAction[],
  action: ModelAction,
  resetParameters: readonly ModelParameterValue[],
  actionParameters: Readonly<Record<string, readonly ModelParameterValue[]>>,
  actionTransitionMs: Readonly<Record<string, number>>,
  serial: number,
  playbackSerialRef: { readonly current: number }
): Promise<void> {
  const actionMap = new Map(actions.map((entry) => [entry.id, entry]));
  const beforeSteps = action.steps?.filter((step) => step.phase === "before") ?? [];

  for (const step of beforeSteps) {
    const stepAction = actionMap.get(step.actionId);
    if (!stepAction || playbackSerialRef.current !== serial) {
      return;
    }

    await playActionWithTransition(model, stepAction, resetParameters, actionParameters, actionTransitionMs, serial, playbackSerialRef);
  }

  if (playbackSerialRef.current !== serial) {
    return;
  }

  await playActionWithTransition(model, action, resetParameters, actionParameters, actionTransitionMs, serial, playbackSerialRef);
}

async function playActionStages(
  model: Live2DModel,
  actions: readonly ModelAction[],
  resetParameters: readonly ModelParameterValue[],
  actionParameters: Readonly<Record<string, readonly ModelParameterValue[]>>,
  actionTransitionMs: Readonly<Record<string, number>>,
  stages: readonly ActionFlowStage[],
  serial: number,
  playbackSerialRef: { readonly current: number }
): Promise<void> {
  for (const stage of stages) {
    if (playbackSerialRef.current !== serial) {
      return;
    }

    const stageStartedAt = Date.now();
    await Promise.all(stage.actions.map((action) => playFlowActionWithLifecycle(
      model,
      actions,
      action,
      resetParameters,
      actionParameters,
      actionTransitionMs,
      serial,
      playbackSerialRef
    )));

    if (playbackSerialRef.current !== serial) {
      return;
    }

    await waitForActionDuration(Math.max(0, stage.durationMs - (Date.now() - stageStartedAt)), serial, playbackSerialRef);
  }
}

async function playFlowActionWithLifecycle(
  model: Live2DModel,
  actions: readonly ModelAction[],
  action: ModelAction,
  resetParameters: readonly ModelParameterValue[],
  actionParameters: Readonly<Record<string, readonly ModelParameterValue[]>>,
  actionTransitionMs: Readonly<Record<string, number>>,
  serial: number,
  playbackSerialRef: { readonly current: number }
): Promise<void> {
  const actionMap = new Map(actions.map((entry) => [entry.id, entry]));
  const beforeSteps = action.steps?.filter((step) => step.phase === "before") ?? [];

  for (const step of beforeSteps) {
    const stepAction = actionMap.get(step.actionId);
    if (!stepAction || playbackSerialRef.current !== serial) {
      return;
    }

    await playActionWithTransition(model, stepAction, resetParameters, actionParameters, actionTransitionMs, serial, playbackSerialRef);
  }

  if (playbackSerialRef.current !== serial) {
    return;
  }

  await playActionWithTransition(model, action, resetParameters, actionParameters, actionTransitionMs, serial, playbackSerialRef);
}

async function playActionWithTransition(
  model: Live2DModel,
  action: ModelAction,
  resetParameters: readonly ModelParameterValue[],
  actionParameters: Readonly<Record<string, readonly ModelParameterValue[]>>,
  actionTransitionMs: Readonly<Record<string, number>>,
  serial: number,
  playbackSerialRef: { readonly current: number }
): Promise<void> {
  if (action.source === "expression") {
    const parameters = actionParameters[action.id] ?? [];
    if (parameters.length) {
      await transitionCoreParameterValues(
        model,
        getParameterTargetsForAction(action, resetParameters, actionParameters),
        actionTransitionMs[action.id] ?? 0,
        serial,
        playbackSerialRef
      );
      return;
    }
  }

  resetChannelsForAction(model, action, resetParameters);
  await playRawAction(model, action);
}

async function playRawAction(model: Live2DModel, action: ModelAction): Promise<void> {
  if (action.source === "motion" && action.play.motionGroup) {
    await model.motion(action.play.motionGroup, action.play.motionIndex, MotionPriority.FORCE);
  }

  if (action.play.expression) {
    await model.expression(action.play.expression);
  }
}

async function waitForActionDuration(
  durationMs: number,
  serial: number,
  playbackSerialRef: { readonly current: number }
): Promise<void> {
  const stepMs = 100;
  let elapsedMs = 0;

  while (elapsedMs < durationMs) {
    if (playbackSerialRef.current !== serial) {
      return;
    }

    const nextStepMs = Math.min(stepMs, durationMs - elapsedMs);
    await delay(nextStepMs);
    elapsedMs += nextStepMs;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function clearFlowProgress(
  setFlowPlaying: (value: boolean) => void,
  setFlowProgress: (value: number) => void,
  setFlowDurationMs: (value: number) => void
): void {
  setFlowPlaying(false);
  setFlowProgress(0);
  setFlowDurationMs(0);
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function stopActivePlayback(model: Live2DModel): void {
  model.internalModel?.motionManager?.stopAllMotions();
  model.internalModel?.motionManager?.expressionManager?.stopAllExpressions?.();
}

function applyCoreParameterReset(model: Live2DModel, parameters: readonly ModelParameterValue[]): void {
  applyCoreParameterValues(model, parameters);
}

function resetChannelsForAction(
  model: Live2DModel,
  action: ModelAction,
  resetParameters: readonly ModelParameterValue[]
): void {
  applyCoreParameterValues(model, getResetParametersForAction(action, resetParameters));
}

async function transitionCoreParameterValues(
  model: Live2DModel,
  parameters: readonly ModelParameterValue[],
  durationMs: number,
  serial: number,
  playbackSerialRef: { readonly current: number }
): Promise<void> {
  const coreModel = model.internalModel?.coreModel;
  if (!coreModel?.setParameterValueById || !coreModel.getParameterValueById || durationMs <= 0) {
    applyCoreParameterValues(model, parameters);
    return;
  }

  const startValues = parameters.map((parameter) => ({
    id: parameter.id,
    from: coreModel.getParameterValueById!(parameter.id),
    to: parameter.value
  }));
  const startedAt = Date.now();

  while (playbackSerialRef.current === serial) {
    const progress = clamp((Date.now() - startedAt) / durationMs, 0, 1);
    const easedProgress = easeOutCubic(progress);
    applyCoreParameterValues(model, startValues.map((parameter) => ({
      id: parameter.id,
      value: parameter.from + (parameter.to - parameter.from) * easedProgress
    })));

    if (progress >= 1) {
      return;
    }

    await delay(16);
  }
}

function easeOutCubic(value: number): number {
  return 1 - ((1 - value) ** 3);
}

function applyCoreParameterValues(model: Live2DModel, parameters: readonly ModelParameterValue[]): void {
  const coreModel = model.internalModel?.coreModel;
  if (!coreModel?.setParameterValueById) {
    return;
  }

  for (const parameter of parameters) {
    coreModel.setParameterValueById(parameter.id, parameter.value, 1);
  }

  model.internalModel?.update?.(0, Date.now());
}

function getPreviewResetExpressions(resetActions: readonly ModelAction[]): readonly string[] {
  const previewResetActions = resetActions.filter((action) => action.source === "expression" && action.play.expression);
  const bySourceKey = new Map(previewResetActions.map((action) => [action.sourceKey, action.play.expression!]));
  const preferredSourceKeys = [
    "expression:表情回正",
    "expression:拽秋千回正",
    "expression:开"
  ];

  const ordered = preferredSourceKeys
    .map((sourceKey) => bySourceKey.get(sourceKey))
    .filter((expressionName): expressionName is string => Boolean(expressionName));
  const extra = previewResetActions
    .map((action) => action.play.expression!)
    .filter((expressionName) => !ordered.includes(expressionName));

  return [...new Set([...ordered, ...extra])];
}

function createResetParameters(
  resetActions: readonly ModelAction[],
  actions: readonly ModelAction[],
  expressionParameters: ExpressionParameterHints,
  motionResetParameters: readonly ModelParameterValue[]
): readonly ModelParameterValue[] {
  const resetValues = new Map<string, number>();

  for (const action of actions) {
    const expressionName = action.play.expression;
    if (!expressionName) {
      continue;
    }

    for (const parameter of expressionParameters[expressionName] ?? []) {
      resetValues.set(parameter.id, 0);
    }
  }

  for (const action of resetActions) {
    const expressionName = action.play.expression;
    if (!expressionName) {
      continue;
    }

    for (const parameter of expressionParameters[expressionName] ?? []) {
      resetValues.set(parameter.id, parameter.value);
    }
  }

  for (const parameter of motionResetParameters) {
    resetValues.set(parameter.id, parameter.value);
  }

  return [...resetValues.entries()].map(([id, value]) => ({ id, value }));
}

function createActionParameters(
  actions: readonly ModelAction[],
  expressionParameters: ExpressionParameterHints
): Readonly<Record<string, readonly ModelParameterValue[]>> {
  return Object.fromEntries(actions.map((action) => [
    action.id,
    action.play.expression
      ? (expressionParameters[action.play.expression] ?? []).map((parameter) => ({
        id: parameter.id,
        value: parameter.value
      }))
      : []
  ]));
}

function createActionTransitionMs(
  actions: readonly ModelAction[],
  fadeInMsByName: Readonly<Record<string, number>>
): Readonly<Record<string, number>> {
  return Object.fromEntries(actions.map((action) => [
    action.id,
    action.play.expression ? (fadeInMsByName[action.play.expression] ?? 0) : 0
  ]));
}

function QueuePreview({
  queues,
  onPlayAction
}: {
  readonly queues: readonly ModelActionQueue[];
  readonly onPlayAction: (action: ModelAction) => void;
}) {
  return (
    <div className="queue-list">
      {queues.map((queue) => (
        <div className="queue-card" key={queue.channelId}>
          <div className="queue-title">
            <span>{queue.channelId}</span>
            <small>{queue.actions.length} 步</small>
          </div>
          <div className="queue-steps">
            {queue.actions.map((action, index) => (
              <button key={`${queue.channelId}.${action.id}.${index}`} type="button" onClick={() => onPlayAction(action)}>
                <b>{index + 1}</b>
                <span>{action.label}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {queues.length === 0 ? <div className="empty-state">缓存区动作会自动编译成队列</div> : null}
    </div>
  );
}

async function loadModelData(): Promise<ModelData> {
  const content = await loadLive2DContentBundle(packBaseUrl);
  const contentPack = content.manifest;
  const catalog = content.modelCatalog;
  const expressionMetadata = await loadExpressionMetadata(catalog.expressions, content.modelBaseUrl);
  const expressionParameters = expressionMetadata.parameters;
  const extraction = createModelActionExtraction(catalog, expressionParameters);
  const actionNameOverrides = loadActionNameOverrides(contentPack.id);
  const motionActionChannelOverrides = await loadMotionActionChannelOverrides(extraction.actions, content.modelBaseUrl);
  const modelActions = applyActionNameOverrides(applyActionChannelOverrides(extraction.actions, motionActionChannelOverrides), actionNameOverrides);
  const resetActions = applyActionNameOverrides(applyActionChannelOverrides(extraction.resetActions, motionActionChannelOverrides), actionNameOverrides);
  const motionResetParameters = await loadMotionResetParameters(resetActions, content.modelBaseUrl);
  const actionDurations = await loadActionDurations(extraction.actions, catalog.motions, content.modelBaseUrl);
  return {
    id: contentPack.id,
    entryUrl: content.entryUrl,
    actions: modelActions,
    resetActions,
    resetParameters: createResetParameters(resetActions, modelActions, expressionParameters, motionResetParameters),
    actionParameters: createActionParameters(modelActions, expressionParameters),
    actionTransitionMs: createActionTransitionMs(modelActions, expressionMetadata.fadeInMsByName),
    actionDurations,
    motionCount: catalog.motions.length,
    expressionCount: catalog.expressions.length
  };
}

async function loadActionDurations(
  actions: readonly ModelAction[],
  motions: readonly { readonly file?: string }[],
  modelBaseUrl: string
): Promise<Readonly<Record<string, number>>> {
  const motionDurations = new Map<string, number>();
  const uniqueMotionFiles = [...new Set(motions.map((motion) => motion.file).filter((file): file is string => Boolean(file)))];

  await Promise.all(uniqueMotionFiles.map(async (file) => {
    const rawMotion = await fetchJson(`${modelBaseUrl}/${file}`);
    motionDurations.set(file, parseMotionPreviewDuration(rawMotion));
  }));

  return Object.fromEntries(actions.map((action) => {
    if (action.source === "motion") {
      const file = action.sourceKey.startsWith("motion-file:")
        ? action.sourceKey.slice("motion-file:".length)
        : "";
      return [action.id, motionDurations.get(file) ?? getFallbackActionDuration(action)];
    }

    return [action.id, getFallbackActionDuration(action)];
  }));
}

async function loadMotionActionChannelOverrides(actions: readonly ModelAction[], modelBaseUrl: string): Promise<Readonly<Record<string, readonly string[]>>> {
  const motionActions = actions.filter((action) => action.source === "motion" && action.sourceKey.startsWith("motion-file:"));
  const entries = await Promise.all(motionActions.map(async (action) => {
    const file = action.sourceKey.slice("motion-file:".length);
    const rawMotion = await fetchJson(`${modelBaseUrl}/${file}`);
    const channels = parseMotionParameterChannelIds(rawMotion);
    return [
      action.id,
      channels.length ? channels : action.channelIds
    ] as const;
  }));

  return Object.fromEntries(entries);
}

function parseMotionParameterChannelIds(value: unknown): readonly string[] {
  if (!value || typeof value !== "object" || !("Curves" in value) || !Array.isArray(value.Curves)) {
    return [];
  }

  const channelIds = new Set<string>();
  for (const curve of value.Curves) {
    if (
      !curve ||
      typeof curve !== "object" ||
      !("Target" in curve) ||
      curve.Target !== "Parameter" ||
      !("Id" in curve)
    ) {
      continue;
    }

    channelIds.add(`parameter:${String(curve.Id)}`);
  }

  return [...channelIds].sort();
}

async function loadMotionResetParameters(resetActions: readonly ModelAction[], modelBaseUrl: string): Promise<readonly ModelParameterValue[]> {
  const motionFiles = [...new Set(resetActions
    .filter((action) => action.source === "motion" && action.sourceKey.startsWith("motion-file:"))
    .map((action) => action.sourceKey.slice("motion-file:".length))
    .filter(Boolean))];

  const parameterEntries = await Promise.all(motionFiles.map(async (file) => {
    const rawMotion = await fetchJson(`${modelBaseUrl}/${file}`);
    return parseMotionResetParameters(rawMotion);
  }));
  const resetValues = new Map<string, number>();

  for (const parameters of parameterEntries) {
    for (const parameter of parameters) {
      resetValues.set(parameter.id, parameter.value);
    }
  }

  return [...resetValues.entries()].map(([id, value]) => ({ id, value }));
}

function parseMotionResetParameters(value: unknown): readonly ModelParameterValue[] {
  if (!value || typeof value !== "object" || !("Curves" in value) || !Array.isArray(value.Curves)) {
    return [];
  }

  const parameters: ModelParameterValue[] = [];
  for (const curve of value.Curves) {
    if (
      !curve ||
      typeof curve !== "object" ||
      !("Target" in curve) ||
      curve.Target !== "Parameter" ||
      !("Id" in curve) ||
      !("Segments" in curve) ||
      !Array.isArray(curve.Segments) ||
      curve.Segments.length === 0
    ) {
      continue;
    }

    const valueAtEnd = Number(curve.Segments[curve.Segments.length - 1]);
    if (!Number.isFinite(valueAtEnd)) {
      continue;
    }

    parameters.push({
      id: String(curve.Id),
      value: valueAtEnd
    });
  }

  return parameters;
}

function parseMotionPreviewDuration(value: unknown): number {
  if (!value || typeof value !== "object" || !("Meta" in value)) {
    return 1600;
  }

  const meta = value.Meta;
  if (!meta || typeof meta !== "object" || !("Duration" in meta)) {
    return 1600;
  }

  const durationSeconds = Number(meta.Duration);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return 1600;
  }

  return clamp(durationSeconds * 1000, 900, 2400);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

async function loadExpressionMetadata(
  expressions: readonly { readonly name: string; readonly file: string }[],
  modelBaseUrl: string
): Promise<ModelExpressionMetadata> {
  const entries = await Promise.all(expressions.map(async (expression) => {
    const raw = await fetchJson(`${modelBaseUrl}/${expression.file}`);
    return [
      expression.name,
      parseExpressionMetadata(raw)
    ] as const;
  }));

  return {
    parameters: Object.fromEntries(entries.map(([name, metadata]) => [name, metadata.parameters])),
    fadeInMsByName: Object.fromEntries(entries.map(([name, metadata]) => [name, metadata.fadeInMs]))
  };
}

function parseExpressionMetadata(value: unknown): {
  readonly parameters: readonly { readonly id: string; readonly value: number; readonly blend?: string }[];
  readonly fadeInMs: number;
} {
  if (!value || typeof value !== "object") {
    return { parameters: [], fadeInMs: 0 };
  }

  const fadeInSeconds = "FadeInTime" in value ? Number(value.FadeInTime) : 0;
  const fadeInMs = Number.isFinite(fadeInSeconds) && fadeInSeconds > 0
    ? clamp(fadeInSeconds * 1000, 0, 800)
    : 0;

  if (!("Parameters" in value) || !Array.isArray(value.Parameters)) {
    return { parameters: [], fadeInMs };
  }

  const parameters: { id: string; value: number; blend?: string }[] = [];
  for (const parameter of value.Parameters) {
    if (!parameter || typeof parameter !== "object" || !("Id" in parameter) || !("Value" in parameter)) {
      continue;
    }

    const parsedParameter: { id: string; value: number; blend?: string } = {
      id: String(parameter.Id),
      value: Number(parameter.Value)
    };

    if ("Blend" in parameter) {
      parsedParameter.blend = String(parameter.Blend);
    }

    parameters.push(parsedParameter);
  }

  return { parameters, fadeInMs };
}

function fitModel(app: Application, model: Live2DModel): void {
  const safeWidth = Math.max(model.width, 1);
  const safeHeight = Math.max(model.height, 1);
  const scale = Math.min(app.screen.width / safeWidth, app.screen.height / safeHeight) * 0.82;
  model.scale.set(scale);
  model.x = (app.screen.width - model.width) / 2;
  model.y = (app.screen.height - model.height) / 2;
}
