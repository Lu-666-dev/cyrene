import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import type {
  Live2DActionContract,
  Live2DActionMapContract,
  Live2DInteractionPresetContract
} from "@cyrene/content";
import { loadLive2DContentBundle } from "../runtime/content-loader.js";
import { getActiveCharacterBaseUrl } from "../runtime/active-character.js";
import {
  createDefaultInteractionActionBindings,
  interactionBindingsEvent,
  loadInteractionActionBindings,
  saveInteractionActionBindings
} from "../runtime/interaction-bindings.js";
import type { InteractionActionBindings } from "../runtime/interaction-bindings.js";
import { ChatPage } from "./ChatPage.js";

const packBaseUrl = getActiveCharacterBaseUrl();
const snapDurationMs = 260;
const settleDurationMs = 360;

interface PointerDragState {
  readonly actionId: string;
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
}

interface RegionDropProximity {
  readonly regionId: string;
  readonly progress: number;
  readonly inside: boolean;
  readonly rect: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

interface DropAnimationState {
  readonly actionId: string;
  readonly regionId: string;
  readonly targetX: number;
  readonly targetY: number;
  readonly width: number;
  readonly height: number;
  readonly deltaX: number;
  readonly deltaY: number;
}

interface SettingsData {
  readonly packId: string;
  readonly actionMap: Live2DActionMapContract;
  readonly interactionPreset: Live2DInteractionPresetContract;
  readonly defaults: InteractionActionBindings;
}

type SettingsPage = "chat" | "interactions";

export function SettingsApp() {
  const [page, setPage] = useState<SettingsPage>("chat");
  const [chatContent, setChatContent] = useState<Awaited<ReturnType<typeof loadLive2DContentBundle>> | null>(null);
  const [chatLoadError, setChatLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadLive2DContentBundle(packBaseUrl)
      .then((content) => { if (!cancelled) setChatContent(content); })
      .catch((error: unknown) => { if (!cancelled) setChatLoadError(error instanceof Error ? error.message : String(error)); });
    return () => { cancelled = true; };
  }, []);

  const displayName = chatContent?.chatProfile.displayName ?? "Cyrene";

  return (
    <div className="settings-shell">
      <aside className="settings-sidebar">
        <nav className="settings-tabs" aria-label="功能页面">
          <SidebarTab active={page === "chat"} label={`和 ${displayName} 聊聊`} onClick={() => setPage("chat")} icon={<ChatIcon />} />
          <SidebarTab active={page === "interactions"} label="点击动作设置" onClick={() => setPage("interactions")} icon={<PointerIcon />} />
        </nav>
        <div className="sidebar-account">
          <span className="sidebar-avatar">C</span>
          <div><strong>本地模式</strong><small>数据保存在此设备</small></div>
        </div>
      </aside>
      {page === "chat" ? (
        chatContent ? <ChatPage key={chatContent.manifest.id} packId={chatContent.manifest.id} chatProfile={chatContent.chatProfile} avatarUrl={`${chatContent.baseUrl}/${chatContent.manifest.icon ?? "assets/icon.png"}`} />
          : <main className="chat-main"><div className="friend-empty"><span>{chatLoadError ? `角色聊天配置加载失败：${chatLoadError}` : "正在加载角色聊天配置…"}</span></div></main>
      ) : <InteractionSettingsPage />}
    </div>
  );
}

function SidebarTab({ active, label, onClick, icon }: {
  readonly active: boolean;
  readonly label: string;
  readonly onClick: () => void;
  readonly icon: React.ReactNode;
}) {
  return <button className={`settings-tab${active ? " is-active" : ""}`} type="button" aria-current={active ? "page" : undefined} onClick={onClick}>{icon}<span>{label}</span></button>;
}

function ChatIcon() {
  return <svg className="tab-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18.5 3.5 21v-5.2A8.1 8.1 0 0 1 2 11c0-5 4.5-9 10-9s10 4 10 9-4.5 9-10 9a11 11 0 0 1-5-.9Z" /></svg>;
}

function PointerIcon() {
  return <svg className="tab-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 3 13.5 8.2-6.1 1.3-3 5.5L5 3Z" /><path d="m13 13 5 6" /></svg>;
}

function InteractionSettingsPage() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [bindings, setBindings] = useState<InteractionActionBindings>({});
  const [selectedAction, setSelectedAction] = useState<string | null>(null);
  const [pointerDrag, setPointerDrag] = useState<PointerDragState | null>(null);
  const [dropProximity, setDropProximity] = useState<RegionDropProximity | null>(null);
  const [dropAnimation, setDropAnimation] = useState<DropAnimationState | null>(null);
  const [settlingRegion, setSettlingRegion] = useState<string | null>(null);
  const pointerDragRef = useRef<PointerDragState | null>(null);
  const dropCommitTimerRef = useRef<number | null>(null);
  const settleTimerRef = useRef<number | null>(null);
  const [status, setStatus] = useState("加载点击动作设置…");
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadLive2DContentBundle(packBaseUrl)
      .then((content) => {
        if (cancelled) {
          return;
        }
        const defaults = createDefaultInteractionActionBindings(content.interactionPreset);
        const savedBindings = loadInteractionActionBindings(content.manifest.id, defaults, Object.keys(content.actionMap.actions));
        setData({
          packId: content.manifest.id,
          actionMap: content.actionMap,
          interactionPreset: content.interactionPreset,
          defaults
        });
        setBindings(savedBindings);
        setStatus("拖动动作到部位卡片，松开后吸附并立即生效");
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => () => {
    if (dropCommitTimerRef.current !== null) {
      window.clearTimeout(dropCommitTimerRef.current);
    }
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current);
    }
  }, []);

  const actions = useMemo(() => data
    ? Object.entries(data.actionMap.actions).sort(([left], [right]) => left.localeCompare(right))
    : [], [data]);
  const regionOrder = useMemo(() => data ? Object.keys(data.interactionPreset.interactionRegions) : [], [data]);

  async function assignAction(regionId: string, actionId: string): Promise<void> {
    if (!data?.actionMap.actions[actionId] || !bindings[regionId]) {
      return;
    }

    const nextBindings = { ...bindings, [regionId]: actionId };
    setBindings(nextBindings);
    setSelectedAction(actionId);
    saveInteractionActionBindings(data.packId, nextBindings);
    setStatus(`${data.interactionPreset.interactionRegions[regionId]?.label ?? regionId} 已切换为 ${actionId}`);

    if (isTauri()) {
      try {
        await emit(interactionBindingsEvent, nextBindings);
      } catch (error) {
        console.error("Failed to synchronize interaction bindings with the pet window.", error);
        setStatus("设置已保存；与桌宠同步失败，重启桌宠后生效");
      }
    }
  }

  function beginPointerDrag(event: React.PointerEvent<HTMLButtonElement>, actionId: string): void {
    if (event.button !== 0 || !event.isPrimary || dropAnimation) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedAction(actionId);
    const nextPointerDrag = {
      actionId,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY
    };
    pointerDragRef.current = nextPointerDrag;
    setPointerDrag(nextPointerDrag);
  }

  function movePointerDrag(event: React.PointerEvent<HTMLButtonElement>): void {
    const activeDrag = pointerDragRef.current;
    if (!activeDrag || activeDrag.pointerId !== event.pointerId) {
      return;
    }
    setDropProximity(getRegionDropProximity(event.clientX, event.clientY));
    const nextPointerDrag = {
      ...activeDrag,
      x: event.clientX,
      y: event.clientY
    };
    pointerDragRef.current = nextPointerDrag;
    setPointerDrag(nextPointerDrag);
  }

  function finishPointerDrag(event: React.PointerEvent<HTMLButtonElement>): void {
    const activeDrag = pointerDragRef.current;
    if (!activeDrag || activeDrag.pointerId !== event.pointerId) {
      return;
    }
    const proximity = getRegionDropProximity(event.clientX, event.clientY);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    pointerDragRef.current = null;
    setPointerDrag(null);
    if (proximity?.inside) {
      startDropAnimation(activeDrag.actionId, event.clientX, event.clientY, proximity);
    } else {
      setDropProximity(null);
    }
  }

  function startDropAnimation(
    actionId: string,
    pointerX: number,
    pointerY: number,
    proximity: RegionDropProximity
  ): void {
    const targetCenterX = proximity.rect.x + proximity.rect.width / 2;
    const targetCenterY = proximity.rect.y + proximity.rect.height / 2;
    setDropProximity({ ...proximity, progress: 1 });
    setDropAnimation({
      actionId,
      regionId: proximity.regionId,
      targetX: proximity.rect.x,
      targetY: proximity.rect.y,
      width: proximity.rect.width,
      height: proximity.rect.height,
      deltaX: pointerX - targetCenterX,
      deltaY: pointerY - targetCenterY
    });

    dropCommitTimerRef.current = window.setTimeout(() => {
      void assignAction(proximity.regionId, actionId);
      setDropAnimation(null);
      setDropProximity(null);
      setSettlingRegion(proximity.regionId);
      settleTimerRef.current = window.setTimeout(() => {
        setSettlingRegion(null);
        settleTimerRef.current = null;
      }, settleDurationMs);
      dropCommitTimerRef.current = null;
    }, snapDurationMs);
  }

  function resetBindings(): void {
    if (!data) {
      return;
    }
    if (dropCommitTimerRef.current !== null) {
      window.clearTimeout(dropCommitTimerRef.current);
      dropCommitTimerRef.current = null;
    }
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    pointerDragRef.current = null;
    setBindings(data.defaults);
    saveInteractionActionBindings(data.packId, data.defaults);
    setSelectedAction(null);
    setDropProximity(null);
    setDropAnimation(null);
    setPointerDrag(null);
    setSettlingRegion(null);
    setStatus("已恢复内容包中的初始动作");
    if (isTauri()) {
      void emit(interactionBindingsEvent, data.defaults).catch((error) => {
        console.error("Failed to synchronize reset interaction bindings.", error);
      });
    }
  }

  return (
    <main className="settings-main interaction-main">
        <header className="settings-header">
          <div>
            <p className="eyebrow">交互设置</p>
            <h1>点击动作设置</h1>
            <p>每个部位只能绑定一个动作。拖入后松开，新动作会吸附覆盖并立即同步到桌宠。</p>
          </div>
          <button className="reset-button" type="button" onClick={resetBindings} disabled={!data}>
            恢复初始动作
          </button>
        </header>

        {loadError ? <div className="settings-error">加载失败：{loadError}</div> : null}

        <section className="binding-section" aria-labelledby="binding-title">
          <div className="section-heading">
            <div>
              <h2 id="binding-title">部位动作</h2>
              <p>将下方任意动作拖到对应部位。</p>
            </div>
            <span className="binding-status">{status}</span>
          </div>

          <div className="region-grid">
            {data ? regionOrder.map((regionId, index) => {
              const region = data.interactionPreset.interactionRegions[regionId];
              const actionId = bindings[regionId];
              if (!region || !actionId) {
                return null;
              }
              const sinkProgress = dropProximity?.regionId === regionId
                ? dropProximity.progress
                : 0;
              return (
                <article className="region-card" key={regionId}>
                  <div className="region-card-heading">
                    <span className="region-index">{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <h3>{region.label}</h3>
                      <small>{region.semanticEvent}</small>
                    </div>
                  </div>
                  <button
                    className={[
                      "action-slot",
                      sinkProgress > 0 ? "is-drag-target" : "",
                      settlingRegion === regionId ? "is-settling" : ""
                    ].filter(Boolean).join(" ")}
                    type="button"
                    data-region-id={regionId}
                    style={{ "--sink-progress": sinkProgress } as CSSProperties}
                    onClick={() => selectedAction && void assignAction(regionId, selectedAction)}
                    aria-label={`${region.label}当前动作 ${actionId}`}
                  >
                    <span className="slot-content">
                      <span className="slot-label">当前动作</span>
                      <strong>{actionId}</strong>
                      <small>{describeAction(data.actionMap.actions[actionId])}</small>
                      <span className="slot-replace">拖到这里松开</span>
                    </span>
                  </button>
                </article>
              );
            }) : <RegionSkeletons />}
          </div>
        </section>

        <section className="action-library" aria-labelledby="action-library-title">
          <div className="section-heading">
            <div>
              <h2 id="action-library-title">全部动作</h2>
              <p>点击可选中，再点击部位卡片；也可以直接拖放。</p>
            </div>
            <span className="action-count">{actions.length} 个动作</span>
          </div>
          <div className="action-grid" role="list">
            {actions.map(([actionId, mapping]) => (
              <button
                className={`action-item${selectedAction === actionId ? " is-selected" : ""}`}
                type="button"
                role="listitem"
                key={actionId}
                onClick={() => setSelectedAction(actionId)}
                onPointerDown={(event) => beginPointerDrag(event, actionId)}
                onPointerMove={movePointerDrag}
                onPointerUp={finishPointerDrag}
                onPointerCancel={(event) => {
                  if (pointerDragRef.current?.pointerId === event.pointerId) {
                    pointerDragRef.current = null;
                    setPointerDrag(null);
                    setDropProximity(null);
                  }
                }}
              >
                <strong>{actionId}</strong>
                <small>{describeAction(mapping)}</small>
                <span>拖动</span>
              </button>
            ))}
          </div>
        </section>
        {pointerDrag ? (
          <div
            className="drag-preview"
            style={{ left: pointerDrag.x, top: pointerDrag.y }}
            aria-hidden="true"
          >
            <strong>{pointerDrag.actionId}</strong>
            <small>{describeAction(data?.actionMap.actions[pointerDrag.actionId])}</small>
            <span>放入部位</span>
          </div>
        ) : null}
        {dropAnimation ? (
          <div
            className="drop-snap-card"
            style={{
              left: dropAnimation.targetX,
              top: dropAnimation.targetY,
              width: dropAnimation.width,
              height: dropAnimation.height,
              "--drop-delta-x": `${dropAnimation.deltaX}px`,
              "--drop-delta-y": `${dropAnimation.deltaY}px`
            } as CSSProperties}
            aria-hidden="true"
          >
            <span>新动作</span>
            <strong>{dropAnimation.actionId}</strong>
            <small>{describeAction(data?.actionMap.actions[dropAnimation.actionId])}</small>
          </div>
        ) : null}
    </main>
  );
}

function describeAction(mapping: Live2DActionContract | undefined): string {
  if (!mapping) {
    return "动作映射缺失";
  }
  const parts = [
    mapping.motionName ?? mapping.motionGroup,
    mapping.expression,
    mapping.after ? `随后 ${mapping.after}` : undefined
  ].filter((value): value is string => Boolean(value));
  return parts.join(" · ") || "参数动作";
}

function RegionSkeletons() {
  return <>{Array.from({ length: 4 }, (_, index) => <div className="region-card is-loading" key={index} />)}</>;
}

function getRegionDropProximity(clientX: number, clientY: number): RegionDropProximity | null {
  let nearest: RegionDropProximity | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const slot of document.querySelectorAll<HTMLElement>("[data-region-id]")) {
    const regionId = slot.dataset.regionId;
    if (!regionId) {
      continue;
    }
    const rect = slot.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const distance = Math.hypot(clientX - centerX, clientY - centerY);
    if (distance >= nearestDistance) {
      continue;
    }
    const influenceRadius = Math.max(rect.width, rect.height) * 1.15;
    const progress = Math.max(0, Math.min(1, 1 - distance / influenceRadius));
    if (progress <= 0) {
      continue;
    }
    nearestDistance = distance;
    nearest = {
      regionId,
      progress,
      inside: clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom,
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height
      }
    };
  }

  return nearest;
}
