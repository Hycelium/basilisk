import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./styles.css";
import { GameRenderer, type QualityInfo, type QualitySetting, type TouchDragMode } from "./game/render3d";
import { GameSim, hitTest } from "./game/sim";
import {
  diplomacyKey,
  type BuildingKind,
  type CombatEventKind,
  type RectHit,
  type SkirmishSetup,
  type TrainKind,
  type UiSnapshot,
} from "./game/types";
import { BUILD_COST } from "./game/balance";
import { Hud } from "./ui/Hud";
import { BuildBar } from "./ui/BuildBar";
import { DetailSheet } from "./ui/DetailSheet";
import { Overlays } from "./ui/Overlays";
import { ControlCluster, type ClusterAction } from "./ui/ControlCluster";
import { RadialMenu, type RadialItem } from "./ui/RadialMenu";
import { useHints } from "./ui/hints";
import { useLayout } from "./ui/useLayout";

const defaultUi: UiSnapshot = {
  phase: "title",
  mapId: "seed-0",
  mapName: "Dusk Valley",
  mapTagline: "Loading…",
  mapSeed: 0,
  campaignLevel: 1,
  scoutSalt: 0,
  paused: false,
  speed: 1,
  soundOn: false,
  yourHp: 100,
  foeHp: 100,
  yourMaxHp: 100,
  yourGold: 90,
  yourWood: 80,
  foeGold: 90,
  foeWood: 80,
  waveLabel: "1/16",
  wavePhase: "build",
  buildTimer: 20,
  canRush: false,
  totalWaves: 16,
  toasts: [],
  buildSelection: null,
  selectedBuildingId: null,
  selectedBuildingTeam: null,
  selectedBuildingKind: null,
  selectedKeepTeam: null,
  selectedPeonCount: 0,
  selectedRanks: null,
  selectedCanUpgradeDamage: false,
  selectedCanUpgradeRate: false,
  selectedCanRaze: false,
  selectedRazeRefund: 0,
  selectedRazeRefundWood: 0,
  selectedTrainPct: null,
  selectedUpgradeCost: { damage: 0, rate: 0 },
  trainQueue: [],
  trainOptions: [],
  peonQueue: [],
  peonCount: 2,
  peonCap: 2,
  keepGarrisoned: 0,
  keepGarrisonMax: 5,
  canTrainPeon: false,
  peonTrainCost: { gold: 18, wood: 0 },
  buildCosts: BUILD_COST,
  keepLevel: 1,
  keepXp: 0,
  keepXpNext: 40,
  keepXpPct: 0,
  endReason: "",
  lastXpGain: 0,
  stats: { slain: 0, goldEarned: 0, waves: 0, yourKeep: 100, foeKeep: 100 },
  foeIntellect: 8,
  foeIntellectPct: 0,
  foeGames: 0,
  foeWins: 0,
  foeExplore: 0.35,
  foeLastAction: "wait",
  players: 2,
  attackName: "Foe",
  enemyKeeps: [],
  foeWaveLine: "Foe wave 0 · steady",
  strongholdName: "",
  strongholdOwner: null,
  strongholdHoldLeft: 180,
  strongholdContested: false,
  strongholdChannel: 0,
  holdsStronghold: false,
  raidName: null,
  attackPrompt: null,
  canOrderAttack: false,
};

const LONG_PRESS_MS = 350;
const LONG_PRESS_SLOP = 10;
const TAP_SLOP_MOUSE = 6;
const TAP_SLOP_TOUCH = 10;
const DRAG_MODE_KEY = "roadkeep.touchDrag";

type FsDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

function fullscreenElement() {
  const d = document as FsDocument;
  return d.fullscreenElement ?? d.webkitFullscreenElement ?? null;
}

function fullscreenSupported() {
  if (typeof document === "undefined") return false;
  const el = document.documentElement as FsElement;
  return Boolean(document.fullscreenEnabled || el.requestFullscreen || el.webkitRequestFullscreen);
}

interface TapMarker {
  id: number;
  x: number;
  y: number;
  kind: "move" | "gather" | "attack" | "patrol" | "select" | "build";
  label: string;
}

interface RadialState {
  x: number;
  y: number;
  world: { x: number; y: number };
  hit: RectHit | null;
}

export default function App() {
  const pageRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sim = useMemo(() => new GameSim(), []);
  const rendererRef = useRef<GameRenderer | null>(null);
  const [ui, setUi] = useState<UiSnapshot>(() => sim.getUiSnapshot() ?? defaultUi);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const heardCombatRef = useRef(new Set<number>());
  const heardMapRef = useRef("");
  const hpRef = useRef(100);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fsSupported] = useState(fullscreenSupported);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const patrolModeRef = useRef(false);
  const selectionBoxRef = useRef<{ left: number; top: number; width: number; height: number } | null>(null);
  const [patrolMode, setPatrolMode] = useState(false);
  const [selectionBox, setSelectionBox] = useState<{ left: number; top: number; width: number; height: number } | null>(
    null,
  );
  const layout = useLayout();
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const [clusterOpen, setClusterOpen] = useState(false);
  const [touchDrag, setTouchDrag] = useState<TouchDragMode>(() => {
    try {
      return localStorage.getItem(DRAG_MODE_KEY) === "camera" ? "camera" : "select";
    } catch {
      return "select";
    }
  });
  const [quality, setQuality] = useState<QualityInfo>({ setting: "auto", tier: "high", fps: 60 });
  const [zoomT, setZoomT] = useState(0.39);
  const [tapMarkers, setTapMarkers] = useState<TapMarker[]>([]);
  const tapIdRef = useRef(0);
  const [radial, setRadial] = useState<RadialState | null>(null);
  const radialRef = useRef<RadialState | null>(null);
  radialRef.current = radial;
  const longPressRef = useRef<{ timer: number; x: number; y: number; pointerId: number } | null>(null);
  const { hint, show: showHint, dismiss: dismissHint } = useHints();
  const prevUiRef = useRef(ui);

  const refreshUi = useCallback(() => setUi(sim.getUiSnapshot()), [sim]);

  const toggleFullscreen = useCallback(async () => {
    const d = document as FsDocument;
    const el = pageRef.current as FsElement | null;
    try {
      if (fullscreenElement()) {
        if (d.exitFullscreen) await d.exitFullscreen();
        else await d.webkitExitFullscreen?.();
      } else if (el) {
        if (el.requestFullscreen) await el.requestFullscreen();
        else await el.webkitRequestFullscreen?.();
      }
    } catch {
      /* iOS Safari and some embedded browsers reject — the dvh layout already fills the screen */
    }
  }, []);

  function beep(freq: number, dur = 0.06) {
    if (!sim.getState().soundOn || !sim.getState().audioUnlocked) return;
    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
    const ctx = audioCtxRef.current;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.type = "triangle";
    gain.gain.value = 0.04;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + dur);
  }

  function combatSound(kind: CombatEventKind) {
    if (!sim.getState().soundOn || !sim.getState().audioUnlocked) return;
    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
    const ctx = audioCtxRef.current;
    const tone = (start: number, end: number, duration: number, gainValue: number, type: OscillatorType = "triangle", delay = 0) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const at = ctx.currentTime + delay;
      osc.type = type;
      osc.frequency.setValueAtTime(start, at);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, end), at + duration);
      gain.gain.setValueAtTime(gainValue, at);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + duration);
    };
    const noise = (duration: number, gainValue: number, cutoff: number) => {
      const samples = Math.max(1, Math.floor(ctx.sampleRate * duration));
      const buffer = ctx.createBuffer(1, samples, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < samples; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / samples);
      const source = ctx.createBufferSource();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      source.buffer = buffer;
      filter.type = "lowpass";
      filter.frequency.value = cutoff;
      gain.gain.value = gainValue;
      source.connect(filter).connect(gain).connect(ctx.destination);
      source.start();
    };

    if (kind === "arrow") {
      noise(0.09, 0.018, 4200);
      tone(1500, 700, 0.08, 0.018, "sine");
    } else if (kind === "meleeHit") {
      noise(0.11, 0.035, 1700);
      tone(190, 75, 0.12, 0.035, "square");
    } else if (kind === "ramImpact" || kind === "keepImpact") {
      noise(0.26, 0.07, 650);
      tone(95, 34, 0.3, 0.09, "sine");
    } else if (kind === "woodHit") {
      noise(0.13, 0.045, 1200);
      tone(260, 100, 0.1, 0.025, "triangle");
    } else if (kind === "woodBreak") {
      noise(0.38, 0.085, 1900);
      tone(150, 38, 0.32, 0.07, "sawtooth");
    } else if (kind === "unitDeath") {
      tone(180, 55, 0.2, 0.025, "sawtooth");
    } else if (kind === "buildComplete") {
      tone(520, 700, 0.09, 0.025, "sine");
      tone(700, 920, 0.12, 0.022, "sine", 0.08);
    } else if (kind === "waveHorn") {
      tone(180, 145, 0.42, 0.06, "sawtooth");
      tone(240, 195, 0.46, 0.04, "triangle", 0.08);
    }
  }

  const pushTapMarker = useCallback((x: number, y: number, kind: TapMarker["kind"], label: string) => {
    const id = ++tapIdRef.current;
    setTapMarkers((list) => [...list.slice(-3), { id, x, y, kind, label }]);
    window.setTimeout(() => setTapMarkers((list) => list.filter((m) => m.id !== id)), 760);
  }, []);

  const setPatrol = useCallback((on: boolean) => {
    patrolModeRef.current = on;
    setPatrolMode(on);
  }, []);

  const clearLongPress = useCallback(() => {
    if (longPressRef.current) {
      window.clearTimeout(longPressRef.current.timer);
      longPressRef.current = null;
    }
  }, []);

  /** Shared contextual order used by right-click (mouse) and tap-with-selection (touch). */
  const issueOrder = useCallback(
    (world: { x: number; y: number }, hit: RectHit | null, localX: number, localY: number) => {
      const state = sim.getState();
      if (state.buildSelection) {
        sim.click(hit, world);
        pushTapMarker(localX, localY, "build", "Place");
      } else {
        const patrol = patrolModeRef.current;
        const hadPeons = state.selectedVillagerIds.length > 0;
        sim.commandSelected(world, hit, patrol);
        if (hadPeons) {
          const kind: TapMarker["kind"] =
            hit?.kind === "node" ? "gather" : hit?.kind === "unit" ? "attack" : patrol ? "patrol" : "move";
          const label = kind === "gather" ? "Gather" : kind === "attack" ? "Attack" : kind === "patrol" ? "Patrol" : "Move";
          pushTapMarker(localX, localY, kind, label);
        }
      }
      setPatrol(false);
      beep(hit?.kind === "node" ? 520 : 370, 0.045);
      refreshUi();
    },
    // beep is stable enough for this purpose; it only reads refs/sim.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sim, pushTapMarker, refreshUi, setPatrol],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    const renderer = new GameRenderer(canvas);
    rendererRef.current = renderer;
    renderer.setTouchDragMode(touchDrag);
    renderer.onQuality((info) => setQuality(info));
    renderer.resize();

    // Debounced resize via ResizeObserver on the stage (handles orientation, URL-bar collapse, fullscreen).
    let resizeTimer = 0;
    const scheduleResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => renderer.resize(), 80);
    };
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(scheduleResize) : null;
    ro?.observe(stage);
    window.addEventListener("resize", scheduleResize);
    window.addEventListener("orientationchange", scheduleResize);
    window.visualViewport?.addEventListener("resize", scheduleResize);

    let raf = 0;
    let prev = performance.now();
    let uiTick = 0;
    const frame = (now: number) => {
      const dt = (now - prev) / 1000;
      prev = now;
      sim.update(dt);
      const gameState = sim.getState();
      renderer.draw(gameState);
      if (heardMapRef.current !== gameState.mapId) {
        heardMapRef.current = gameState.mapId;
        heardCombatRef.current.clear();
      }
      for (const event of gameState.combatEvents) {
        if (heardCombatRef.current.has(event.id)) continue;
        heardCombatRef.current.add(event.id);
        combatSound(event.kind);
      }
      if (heardCombatRef.current.size > 1500) {
        heardCombatRef.current = new Set(gameState.combatEvents.map((event) => event.id));
      }
      uiTick += dt;
      const snap = sim.getUiSnapshot();
      if (snap.yourHp < hpRef.current) beep(110, 0.08);
      hpRef.current = snap.yourHp;
      if (uiTick >= 0.08) {
        setUi(snap);
        uiTick = 0;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const local = (ev: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
    };
    const isTouchLike = (ev: PointerEvent) => ev.pointerType !== "mouse";

    const onDown = (ev: PointerEvent) => {
      const r = rendererRef.current;
      if (!r) return;
      if (ev.button === 2) ev.preventDefault();
      const touch = isTouchLike(ev);
      // Any new finger cancels a pending long-press and the marquee.
      clearLongPress();
      if (radialRef.current) setRadial(null);
      const p = local(ev);
      const wasMultitouch = r.getDragMode() === "pinch";
      r.onPointerDown(ev);
      const nowPinch = r.getDragMode() === "pinch";
      if (nowPinch || wasMultitouch) {
        dragStartRef.current = null;
        selectionBoxRef.current = null;
        setSelectionBox(null);
      } else if (!touch && ev.button === 0 && !ev.shiftKey && !ev.altKey) {
        dragStartRef.current = p;
      } else if (touch && r.getTouchDragMode() === "select") {
        dragStartRef.current = p;
      } else {
        dragStartRef.current = null;
      }
      if (touch && !nowPinch && sim.getState().phase === "running") {
        const timer = window.setTimeout(() => {
          longPressRef.current = null;
          r.cancelTap();
          dragStartRef.current = null;
          selectionBoxRef.current = null;
          setSelectionBox(null);
          const world = r.screenToWorld(p.x, p.y);
          const hit = hitTest(sim.getState(), world.x, world.y);
          if (hit?.kind === "villager") {
            // Long-press on a peon: select it and open orders for it.
            sim.click(hit, world);
            refreshUi();
          }
          navigator.vibrate?.(12);
          setRadial({ x: p.x, y: p.y, world, hit });
        }, LONG_PRESS_MS);
        longPressRef.current = { timer, x: ev.clientX, y: ev.clientY, pointerId: ev.pointerId };
      }
      if (!sim.getState().audioUnlocked) sim.unlockAudio();
    };

    const onMove = (ev: PointerEvent) => {
      const r = rendererRef.current;
      if (!r) return;
      const lp = longPressRef.current;
      if (lp && lp.pointerId === ev.pointerId && Math.hypot(ev.clientX - lp.x, ev.clientY - lp.y) > LONG_PRESS_SLOP) {
        clearLongPress();
      }
      r.onPointerMove(ev);
      const start = dragStartRef.current;
      if (!start) return;
      const mode = r.getDragMode();
      if (mode === "pinch" || mode === "orbit" || mode === "pan") {
        dragStartRef.current = null;
        selectionBoxRef.current = null;
        setSelectionBox(null);
        return;
      }
      const pressed = isTouchLike(ev) || (ev.buttons & 1) !== 0;
      if (!pressed) return;
      const p = local(ev);
      const slop = isTouchLike(ev) ? TAP_SLOP_TOUCH : TAP_SLOP_MOUSE;
      if (Math.hypot(p.x - start.x, p.y - start.y) > slop && mode === "select") {
        const box = {
          left: Math.min(start.x, p.x),
          top: Math.min(start.y, p.y),
          width: Math.abs(p.x - start.x),
          height: Math.abs(p.y - start.y),
        };
        selectionBoxRef.current = box;
        setSelectionBox(box);
      }
    };

    const onUp = (ev: PointerEvent) => {
      const r = rendererRef.current;
      if (!r) return;
      clearLongPress();
      const tap = r.onPointerUp(ev);
      const p = local(ev);
      const touch = isTouchLike(ev);
      const start = dragStartRef.current;
      const box = selectionBoxRef.current;
      if (box && start && (touch || ev.button === 0)) {
        const a = r.screenToWorld(box.left, box.top);
        const b = r.screenToWorld(box.left + box.width, box.top + box.height);
        sim.selectVillagersInRect(a, b, ev.ctrlKey || ev.metaKey);
        refreshUi();
        setSelectionBox(null);
        selectionBoxRef.current = null;
        dragStartRef.current = null;
        beep(410, 0.04);
        return;
      }
      setSelectionBox(null);
      selectionBoxRef.current = null;
      dragStartRef.current = null;
      if (!tap || ev.type === "pointercancel") return;
      const world = r.screenToWorld(p.x, p.y);
      const state = sim.getState();
      const hit = hitTest(state, world.x, world.y);

      if (ev.button === 2) {
        issueOrder(world, hit, p.x, p.y);
        return;
      }

      if (touch && state.phase === "running") {
        const peonsSelected = state.selectedVillagerIds.length > 0;
        const ownPeon = hit?.kind === "villager" && state.villagers.some((v) => v.id === Number(hit.id) && v.team === "you");
        const ownStructure =
          (hit?.kind === "building" && state.buildings.some((b) => b.id === Number(hit.id) && b.team === "you")) ||
          (hit?.kind === "keep" && hit.id === "you");
        if (!state.buildSelection && peonsSelected && !ownPeon && !ownStructure) {
          // Tap-to-order: ground → move, tree/mine → gather, enemy → attack.
          issueOrder(world, hit, p.x, p.y);
          return;
        }
      }

      sim.click(hit, world);
      if (hit?.kind === "villager") pushTapMarker(p.x, p.y, "select", "");
      refreshUi();
      beep(320);
    };

    const onWheel = (ev: WheelEvent) => {
      rendererRef.current?.onWheel(ev);
      setZoomT(rendererRef.current?.getZoomT() ?? 0.4);
    };
    const onContext = (ev: Event) => ev.preventDefault();
    const stopGesture = (ev: Event) => {
      // Only the canvas itself; sheets/overlays inside the stage must keep scrolling.
      if (ev.type.startsWith("gesture") || ev.target === canvas) ev.preventDefault();
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", onContext);
    // iOS Safari pinch/double-tap page zoom over the stage.
    stage.addEventListener("gesturestart", stopGesture);
    stage.addEventListener("gesturechange", stopGesture);
    stage.addEventListener("touchmove", stopGesture, { passive: false });
    const onVisibility = () => {
      if (document.hidden) {
        clearLongPress();
        prev = performance.now();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      ro?.disconnect();
      window.clearTimeout(resizeTimer);
      window.removeEventListener("resize", scheduleResize);
      window.removeEventListener("orientationchange", scheduleResize);
      window.visualViewport?.removeEventListener("resize", scheduleResize);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onContext);
      stage.removeEventListener("gesturestart", stopGesture);
      stage.removeEventListener("gesturechange", stopGesture);
      stage.removeEventListener("touchmove", stopGesture);
      document.removeEventListener("visibilitychange", onVisibility);
      cancelAnimationFrame(raf);
      renderer.onQuality(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim]);

  useEffect(() => {
    rendererRef.current?.setTouchDragMode(touchDrag);
    try {
      localStorage.setItem(DRAG_MODE_KEY, touchDrag);
    } catch {
      /* ignore */
    }
  }, [touchDrag]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(Boolean(fullscreenElement()));
      requestAnimationFrame(() => rendererRef.current?.resize());
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("webkitfullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", onFullscreenChange);
    };
  }, []);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA")) return;
      const r = rendererRef.current;
      const slot = /^[1-9]$/.test(ev.key) ? Number(ev.key) : 0;
      let groupHandled = false;
      if (slot > 0 && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        sim.useControlGroup(slot, true);
        groupHandled = true;
      } else if (slot > 0) {
        groupHandled = sim.useControlGroup(slot, false);
      }
      if (!groupHandled) {
        if (ev.key === "1") sim.selectBuild("watchtower");
        if (ev.key === "2") sim.selectBuild("ballista");
        if (ev.key === "3") sim.selectBuild("catapult");
        if (ev.key === "4") sim.selectBuild("barracks");
        if (ev.key === "5") sim.selectBuild("house");
        if (ev.key === "6") sim.selectBuild("barricade");
      }
      if (ev.code === "Space") {
        ev.preventDefault();
        sim.togglePause();
      }
      if (ev.key === "Escape") {
        sim.cancelSelection();
        setPatrol(false);
        setRadial(null);
        setClusterOpen(false);
      }
      if ((ev.key === "p" || ev.key === "P") && sim.getState().selectedVillagerIds.length > 0) {
        setPatrol(!patrolModeRef.current);
      }
      if (ev.key === "f" || ev.key === "F") void toggleFullscreen();
      if (r) {
        if (ev.key === "=" || ev.key === "+") r.zoomBy(0.9);
        if (ev.key === "-" || ev.key === "_") r.zoomBy(1.1);
        if (ev.key === "r" || ev.key === "R") r.resetCamera();
        if ((ev.key === "t" || ev.key === "T") && sim.getState().phase === "running") {
          sim.cycleAttackTarget();
        }
        if (ev.key === "q" || ev.key === "Q") r.orbitBy(28, 0);
        if (ev.key === "e" || ev.key === "E") r.orbitBy(-28, 0);
        if (ev.key === "ArrowLeft") r.panBy(40, 0);
        if (ev.key === "ArrowRight") r.panBy(-40, 0);
        if (ev.key === "ArrowUp") r.panBy(0, 40);
        if (ev.key === "ArrowDown") r.panBy(0, -40);
        setZoomT(r.getZoomT());
      }
      refreshUi();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sim, refreshUi, setPatrol, toggleFullscreen]);

  // Contextual one-shot hints.
  useEffect(() => {
    const prev = prevUiRef.current;
    prevUiRef.current = ui;
    const touch = layoutRef.current.touch;
    if (ui.phase !== "running") return;
    if (prev.phase !== "running") {
      showHint(
        touch ? "touch-start" : "mouse-start",
        touch
          ? "Tap your keep to train peons. Two fingers: drag to pan, pinch to zoom, twist to rotate."
          : "Click your keep to train peons. Right-drag orbits, Shift-drag pans, wheel zooms.",
      );
    }
    if (ui.selectedPeonCount > 0 && prev.selectedPeonCount === 0) {
      showHint(
        touch ? "touch-order" : "mouse-order",
        touch
          ? "Tap the ground to move, tap a tree or mine to gather, tap a foe to attack. Hold for more orders."
          : "Right-click the ground to move, a tree or mine to gather, a foe to attack. P then right-click patrols.",
      );
    }
    if (ui.buildSelection && !prev.buildSelection) {
      showHint(
        "place-build",
        ui.buildSelection === "barricade"
          ? "Tap the road between the keeps; the nearest peon will build it."
          : "Tap a glowing pad to place it. Houses go on green pads behind your keep.",
      );
    }
    if (ui.selectedKeepTeam === "you" && prev.selectedKeepTeam !== "you") {
      showHint("keep-panel", "Queue peons here. Build Houses on eco pads to raise the cap.");
    }
  }, [ui, showHint]);

  const onSelectBuild = (kind: BuildingKind) => {
    sim.selectBuild(kind);
    refreshUi();
    beep(280);
  };

  const onEnqueue = (kind: TrainKind) => {
    sim.enqueueTrain(kind, "you");
    refreshUi();
    beep(360);
  };

  const onQuality = (setting: QualitySetting) => {
    rendererRef.current?.setQuality(setting);
  };

  const sheetOpen = ui.selectedKeepTeam === "you" || Boolean(ui.selectedBuildingId && ui.selectedBuildingKind);
  const compactHud = layout.layout === "column" || layout.phone;
  const compactBuild = layout.layout === "column" && layout.phone;

  const clusterActions: ClusterAction[] = [
    {
      id: "recall",
      icon: "🔔",
      label: "Recall",
      hint: "Recall all peons to your keep",
      onPress: () => {
        sim.callVillagersHome("you");
        refreshUi();
        beep(620, 0.12);
      },
    },
    {
      id: "garrison",
      icon: "🏰",
      label: "Garrison",
      hint: "Garrison peons in the keep (they fire arrows)",
      disabled: ui.keepGarrisoned >= ui.keepGarrisonMax || ui.phase !== "running",
      onPress: () => {
        sim.garrisonVillagers("you");
        refreshUi();
        beep(560);
      },
    },
    {
      id: "patrol",
      icon: "⇄",
      label: "Patrol",
      hint: layout.touch
        ? "Then tap a destination. They walk the route and fight nearby."
        : "Then right-click a destination (P). They walk the route and fight nearby.",
      disabled: ui.selectedPeonCount === 0,
      active: patrolMode,
      onPress: () => setPatrol(!patrolModeRef.current),
    },
    {
      id: "barricade",
      icon: "🪵",
      label: "Barricade",
      hint: "Build a barricade across a road",
      active: ui.buildSelection === "barricade",
      disabled: ui.phase !== "running",
      onPress: () => {
        if (sim.getState().buildSelection === "barricade") sim.cancelSelection();
        else sim.selectBuild("barricade");
        refreshUi();
        beep(280);
      },
    },
    {
      id: "reset-cam",
      icon: "⟲",
      label: "Reset view",
      hint: "Reset camera (R)",
      onPress: () => {
        rendererRef.current?.resetCamera();
        setZoomT(rendererRef.current?.getZoomT() ?? 0.4);
      },
    },
  ];
  if (ui.phase === "running" && ui.canOrderAttack && ui.attackPrompt) {
    clusterActions.push({
      id: "attack-keep",
      icon: "⚔",
      label: "Attack",
      hint: ui.holdsStronghold
        ? `Attack ${ui.attackPrompt}`
        : "Hold the Stronghold to attack a keep",
      disabled: !ui.holdsStronghold,
      danger: true,
      onPress: () => {
        sim.orderKeepAttack();
        refreshUi();
        beep(440);
      },
    });
  }
  if (fsSupported) {
    clusterActions.push({
      id: "fullscreen",
      icon: isFullscreen ? "↙" : "⛶",
      label: isFullscreen ? "Exit full" : "Fullscreen",
      hint: isFullscreen ? "Exit full screen (F)" : "Full screen (F)",
      onPress: () => void toggleFullscreen(),
    });
  }

  const radialItems: RadialItem[] = [];
  if (radial) {
    const state = sim.getState();
    const peons = state.selectedVillagerIds.length > 0;
    const { world, hit, x, y } = radial;
    if (peons) {
      radialItems.push({
        id: "move",
        icon: "➤",
        label: "Move",
        tone: "move",
        onPress: () => {
          setPatrol(false);
          issueOrder(world, null, x, y);
        },
      });
      radialItems.push({
        id: "patrol",
        icon: "⇄",
        label: "Patrol",
        tone: "patrol",
        onPress: () => {
          setPatrol(true);
          issueOrder(world, null, x, y);
        },
      });
      if (hit?.kind === "node") {
        radialItems.push({
          id: "gather",
          icon: "⛏",
          label: "Gather",
          tone: "gather",
          onPress: () => {
            setPatrol(false);
            issueOrder(world, hit, x, y);
          },
        });
      }
      if (
        hit?.kind === "unit" &&
        state.units.some((u) => {
          if (u.id !== Number(hit.id) || u.team === "you" || u.hp <= 0) return false;
          return (state.diplomacy[diplomacyKey("you", u.team)] ?? "neutral") !== "ally";
        })
      ) {
        radialItems.push({
          id: "attack",
          icon: "⚔",
          label: "Attack",
          tone: "attack",
          onPress: () => {
            setPatrol(false);
            issueOrder(world, hit, x, y);
          },
        });
      }
    } else if (hit?.kind === "node") {
      radialItems.push({
        id: "gather",
        icon: "⛏",
        label: "Gather",
        tone: "gather",
        onPress: () => {
          sim.click(hit, world);
          pushTapMarker(x, y, "gather", "Gather");
          refreshUi();
        },
      });
    }
    radialItems.push({
      id: "barricade",
      icon: "🪵",
      label: "Barricade",
      tone: "build",
      onPress: () => {
        sim.placeBarricadeAt(world);
        pushTapMarker(x, y, "build", "Build");
        refreshUi();
        beep(280);
      },
    });
    radialItems.push({
      id: "recall",
      icon: "🔔",
      label: "Recall",
      tone: "recall",
      onPress: () => {
        sim.callVillagersHome("you");
        refreshUi();
        beep(620, 0.12);
      },
    });
  }

  const dismissRadial = useCallback(() => setRadial(null), []);
  const stageRect = stageRef.current?.getBoundingClientRect();

  const pageClass = [
    "page",
    `layout-${layout.layout}`,
    layout.phone ? "is-phone" : "is-large",
    layout.touch ? "is-touch" : "is-pointer",
    isFullscreen ? "is-fullscreen" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={pageClass} ref={pageRef}>
      <div className="phone shell">
        <header className="brand">
          <span className="brand-mark">Roadkeep</span>
          <span className="brand-sub">three.js siege · dusk valley</span>
        </header>

        <Hud
          ui={ui}
          compact={compactHud}
          quality={quality}
          onQuality={onQuality}
          onPause={() => {
            sim.togglePause();
            refreshUi();
          }}
          onSpeed={() => {
            sim.toggleSpeed();
            refreshUi();
          }}
          onSound={() => {
            sim.unlockAudio();
            if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
            void audioCtxRef.current.resume();
            sim.setSound(!sim.getState().soundOn);
            refreshUi();
          }}
          onRush={() => {
            sim.rushNextWave();
            refreshUi();
            beep(500);
          }}
          onAttack={() => {
            sim.orderKeepAttack();
            refreshUi();
            beep(440);
          }}
        />

        <div className={sheetOpen ? "stage sheet-open" : "stage"} ref={stageRef}>
          <canvas ref={canvasRef} className="battlefield" />
          {selectionBox && (
            <div
              className="selection-box"
              style={{
                left: selectionBox.left,
                top: selectionBox.top,
                width: selectionBox.width,
                height: selectionBox.height,
              }}
            />
          )}
          {tapMarkers.map((m) => (
            <span key={m.id} className={`tap-marker ${m.kind}`} style={{ left: m.x, top: m.y }} aria-hidden>
              {m.label && <em>{m.label}</em>}
            </span>
          ))}
          {ui.selectedPeonCount > 0 && ui.phase === "running" && !sheetOpen && (
            <div className="unit-command-bar" role="toolbar" aria-label="Peon orders">
              <strong>
                {ui.selectedPeonCount} peon{ui.selectedPeonCount === 1 ? "" : "s"}
              </strong>
              <button
                type="button"
                className={patrolMode ? "active" : ""}
                aria-pressed={patrolMode}
                onClick={() => setPatrol(!patrolModeRef.current)}
                title={
                  layout.touch
                    ? "Then tap a destination. They walk the route and fight nearby."
                    : "Then right-click a destination (P). They walk the route and fight nearby."
                }
              >
                Patrol
              </button>
              <button
                type="button"
                title="Hold this spot and fight enemies that come close"
                onClick={() => {
                  sim.stopSelectedVillagers();
                  refreshUi();
                }}
              >
                Stop
              </button>
              <button
                type="button"
                onClick={() => {
                  sim.garrisonVillagers("you");
                  refreshUi();
                  beep(560);
                }}
                disabled={ui.keepGarrisoned >= ui.keepGarrisonMax}
                title="Garrison peons in the keep"
              >
                Garrison
              </button>
              <button
                type="button"
                className="ghost dismiss"
                aria-label="Deselect"
                onClick={() => {
                  sim.cancelSelection();
                  setPatrol(false);
                  refreshUi();
                }}
              >
                ✕
              </button>
            </div>
          )}
          {patrolMode && ui.selectedPeonCount > 0 && (
            <div className="mode-banner" role="status">
              Patrol: {layout.touch ? "tap" : "right-click"} the destination
            </div>
          )}
          {hint && (
            <button type="button" className="hint-toast" onClick={dismissHint} aria-live="polite">
              {hint.text}
            </button>
          )}
          {radial && radialItems.length > 0 && (
            <RadialMenu
              x={radial.x}
              y={radial.y}
              width={stageRect?.width ?? 400}
              height={stageRect?.height ?? 600}
              items={radialItems}
              onDismiss={dismissRadial}
            />
          )}
          <ControlCluster
            expanded={clusterOpen}
            onToggle={setClusterOpen}
            actions={clusterActions}
            touch={layout.touch}
            flip={sheetOpen}
            dragMode={touchDrag}
            onDragMode={setTouchDrag}
            zoom={zoomT}
            onZoom={(t) => {
              rendererRef.current?.setZoomT(t);
              setZoomT(t);
            }}
          />
          {!layout.touch && (
            <p className="cam-hint">Drag-select · right-click orders · right-drag orbit · Shift-drag pan · wheel zoom</p>
          )}
          <DetailSheet
            ui={ui}
            onClose={() => {
              sim.cancelSelection();
              refreshUi();
            }}
            onUpgradeDamage={() => {
              sim.buyUpgrade("damage");
              refreshUi();
              beep(400);
            }}
            onUpgradeRate={() => {
              sim.buyUpgrade("rate");
              refreshUi();
              beep(460);
            }}
            onRaze={() => {
              sim.razeSelected();
              refreshUi();
              beep(220);
            }}
            onEnqueue={onEnqueue}
            onCancelQueue={(i) => {
              sim.cancelQueueSlot(i);
              refreshUi();
              beep(200);
            }}
            onEnqueuePeon={() => {
              sim.enqueuePeon("you");
              refreshUi();
              beep(300);
            }}
            onCallHome={() => {
              sim.callVillagersHome("you");
              refreshUi();
              beep(240);
            }}
            onGarrison={() => {
              sim.garrisonVillagers("you");
              refreshUi();
              beep(560);
            }}
            onUngarrison={() => {
              sim.ungarrisonVillagers("you");
              refreshUi();
              beep(260);
            }}
          />
          <Overlays
            ui={ui}
            onRerollMap={() => {
              sim.rerollMap();
              refreshUi();
              beep(440);
            }}
            onStart={(setup: SkirmishSetup) => {
              sim.applySkirmish(setup);
              sim.startMatch();
              refreshUi();
              beep(520);
            }}
            onRestart={() => {
              sim.reset();
              refreshUi();
              hpRef.current = 100;
            }}
          />
        </div>

        <BuildBar
          ui={ui}
          compact={compactBuild}
          getCost={(k) => BUILD_COST[k]!}
          onSelect={onSelectBuild}
          onCancel={() => {
            sim.cancelSelection();
            refreshUi();
          }}
        />
      </div>
    </div>
  );
}
