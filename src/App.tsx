import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./styles.css";
import { GameRenderer, type QualityInfo, type QualitySetting, type TouchDragMode } from "./game/render3d";
import { GameSim, hitTest } from "./game/sim";
import type { BuildingKind, CombatEventKind, KingOrder, RectHit, Team, TrainKind, UiSnapshot } from "./game/types";
import { BUILD_COST } from "./game/balance";
import { Hud } from "./ui/Hud";
import { BuildBar } from "./ui/BuildBar";
import { DetailSheet } from "./ui/DetailSheet";
import { Overlays } from "./ui/Overlays";
import { CampaignMap } from "./ui/CampaignMap";
import { ControlCluster, type ClusterAction } from "./ui/ControlCluster";
import { RadialMenu, type RadialItem } from "./ui/RadialMenu";
import { useHints } from "./ui/hints";
import { useLayout } from "./ui/useLayout";
import { skirmishMaps } from "./game/map";
import { useSkirmish } from "./net/useSkirmish";
import { SkirmishEnd, SkirmishLobby } from "./ui/SkirmishLobby";
import { afterPortalBreak, bindPortalAudio, onMatchEndToMenu, onMatchStart, onReturnToTitle } from "./portal";

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
  idlePeonCount: 0,
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
  foeGames: 0,
  foeWins: 0,
  foeExplore: 0.35,
  foeLastAction: "wait",
  localTeam: "you",
  pvp: false,
  missionId: null,
  missionName: "",
  freshUnlock: "",
  freshHold: false,
  possessed: null,
  basilisk: null,
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
  const skirmish = useSkirmish(sim, rendererRef);
  const { roleRef, liveRef, linkRef } = skirmish;
  const [ui, setUi] = useState<UiSnapshot>(() => sim.getUiSnapshot() ?? defaultUi);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const heardCombatRef = useRef(new Set<number>());
  const heardMapRef = useRef("");
  const hpRef = useRef(100);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fsSupported] = useState(fullscreenSupported);
  /** Fullscreen is the default. A browser only allows it from a click or key press, so the first one enters. Leaving fullscreen keeps the windowed view for the rest of the session. */
  const fullscreenWantedRef = useRef(true);
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [triumph, setTriumph] = useState<{ id: number; unlock: string } | null>(null);
  const fullscreenRequestRef = useRef<Promise<void> | null>(null);
  const fullscreenTriedRef = useRef(false);
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
  const [zoomT, setZoomT] = useState(0.54);
  const [tapMarkers, setTapMarkers] = useState<TapMarker[]>([]);
  const tapIdRef = useRef(0);
  const [radial, setRadial] = useState<RadialState | null>(null);
  const radialRef = useRef<RadialState | null>(null);
  radialRef.current = radial;
  const longPressRef = useRef<{ timer: number; x: number; y: number; pointerId: number } | null>(null);
  const { hint, show: showHint, dismiss: dismissHint } = useHints();
  const prevUiRef = useRef(ui);
  const phaseRef = useRef(ui.phase);

  const refreshUi = useCallback(() => setUi(sim.getUiSnapshot()), [sim]);

  const requestFullscreen = useCallback(async () => {
    if (!fullscreenWantedRef.current || fullscreenElement() || fullscreenRequestRef.current) return;
    const el = pageRef.current as FsElement | null;
    if (!el) return;
    const task = (async () => {
      try {
        if (el.requestFullscreen) await el.requestFullscreen();
        else await el.webkitRequestFullscreen?.();
      } catch {
        /* iOS Safari and some embedded browsers reject — the dvh layout already fills the screen */
      }
    })();
    fullscreenRequestRef.current = task;
    try {
      await task;
    } finally {
      fullscreenRequestRef.current = null;
    }
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const d = document as FsDocument;
    try {
      if (fullscreenElement()) {
        fullscreenWantedRef.current = false;
        if (d.exitFullscreen) await d.exitFullscreen();
        else await d.webkitExitFullscreen?.();
      } else {
        fullscreenWantedRef.current = true;
        await requestFullscreen();
      }
    } catch {
      /* iOS Safari and some embedded browsers reject — the dvh layout already fills the screen */
    }
  }, [requestFullscreen]);

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
    } else if (kind === "sabotage") {
      noise(0.18, 0.04, 2400);
      tone(520, 180, 0.22, 0.04, "sine");
    } else if (kind === "ramImpact" || kind === "keepImpact" || kind === "trebuchet") {
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
    let snapAcc = 0;
    const frame = (now: number) => {
      let elapsed = (now - prev) / 1000;
      prev = now;
      if (!Number.isFinite(elapsed) || elapsed < 0) elapsed = 0;
      const hosting = roleRef.current === "host" && liveRef.current;
      if (roleRef.current === "guest") sim.tickPresentation(elapsed);
      else if (hosting && document.hidden) sim.stepMatch(elapsed, true);
      else sim.update(Math.min(0.05, elapsed));
      const gameState = sim.getState();
      if (!gameState.possessedId && document.pointerLockElement === canvas) document.exitPointerLock();
      if (gameState.basilisk && gameState.possessedId != null && document.pointerLockElement !== canvas) {
        renderer.enterPossess(sim.getPossessYaw(), false);
      }
      const home = sim.getLocalTeam();
      if (renderer.getHomeSide() !== home) renderer.setHomeSide(home);
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
      uiTick += Math.min(1, elapsed);
      const snap = sim.getUiSnapshot();
      if (snap.yourHp < hpRef.current) beep(110, 0.08);
      hpRef.current = snap.yourHp;
      if (uiTick >= 0.08) {
        setUi(snap);
        uiTick = 0;
      }
      if (hosting) {
        snapAcc += Math.min(1, elapsed);
        // 20 pictures a second. Oversized pictures still split for PeerJS.
        if (snapAcc >= 0.05) {
          snapAcc = 0;
          linkRef.current?.send({ t: "snap", snap: sim.exportSnapshot() });
        }
      }
      if (!document.hidden) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const heart = window.setInterval(() => {
      if (document.hidden && roleRef.current === "host" && liveRef.current) frame(performance.now());
    }, 50);

    const local = (ev: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
    };
    const isTouchLike = (ev: PointerEvent) => ev.pointerType !== "mouse";

    const onDown = (ev: PointerEvent) => {
      const r = rendererRef.current;
      if (!r) return;
      if (document.pointerLockElement === canvas) {
        ev.preventDefault();
        return;
      }
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
      if (document.pointerLockElement === canvas) return;
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
      if (document.pointerLockElement === canvas) return;
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
        const side = sim.getLocalTeam();
        const ownPeon = hit?.kind === "villager" && state.villagers.some((v) => v.id === Number(hit.id) && v.team === side);
        const ownStructure =
          (hit?.kind === "building" && state.buildings.some((b) => b.id === Number(hit.id) && b.team === side)) ||
          (hit?.kind === "keep" && hit.id === side);
        if (!state.buildSelection && peonsSelected && !ownPeon && !ownStructure) {
          // Tap-to-order: ground → move, tree/mine → gather, enemy → attack.
          issueOrder(world, hit, p.x, p.y);
          return;
        }
      }

      if ((sim.getState().basilisk || (!touch && ev.button === 0)) && hit?.kind === "unit" && sim.getMatchMode() !== "pvp") {
        if (sim.tryPossess(Number(hit.id))) {
          const body = sim.getState().units.find((u) => u.id === Number(hit.id));
          r.enterPossess(sim.getPossessYaw(), body?.kind === "trebuchet");
          canvas.requestPointerLock();
          refreshUi();
          beep(360, 0.08);
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
      prev = performance.now();
      if (document.hidden) {
        clearLongPress();
        return;
      }
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
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
      window.clearInterval(heart);
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
      const on = Boolean(fullscreenElement());
      if (!on) fullscreenWantedRef.current = false;
      setIsFullscreen(on);
      requestAnimationFrame(() => rendererRef.current?.resize());
    };
    const enter = () => {
      if (fullscreenTriedRef.current) return;
      fullscreenTriedRef.current = true;
      void requestFullscreen();
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("webkitfullscreenchange", onFullscreenChange);
    window.addEventListener("pointerdown", enter, true);
    window.addEventListener("keydown", enter, true);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", onFullscreenChange);
      window.removeEventListener("pointerdown", enter, true);
      window.removeEventListener("keydown", enter, true);
    };
  }, [requestFullscreen]);

  useEffect(() => {
    const prev = phaseRef.current;
    phaseRef.current = ui.phase;
    if (prev === ui.phase) return;
    if (ui.phase === "running") onMatchStart();
    else if (ui.phase === "title" && prev === "ended") onMatchEndToMenu();
    else if (ui.phase === "title") onReturnToTitle();
  }, [ui.phase]);

  useEffect(() => {
    if (ui.phase !== "ended" || !skirmish.lobby.live || skirmish.lobby.role !== "host") return;
    skirmish.announceMap();
  }, [skirmish.announceMap, skirmish.lobby.live, skirmish.lobby.role, ui.phase]);

  useEffect(() => {
    let held = false;
    let saved = false;
    bindPortalAudio({
      mute() {
        if (held) return;
        held = true;
        saved = sim.getState().soundOn;
        if (saved) sim.setSound(false);
        void audioCtxRef.current?.suspend();
      },
      restore() {
        if (!held) return;
        held = false;
        if (saved) sim.setSound(true);
        void audioCtxRef.current?.resume();
      },
    });
  }, [sim]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA")) return;
      const r = rendererRef.current;
      const possessed = sim.getState().possessedId != null;
      const step = ev.key.toLowerCase();
      if (possessed && (step === "w" || step === "a" || step === "s" || step === "d")) {
        ev.preventDefault();
        sim.setPossessKey(step, true);
        return;
      }
      if (possessed && ev.key === "Escape") {
        ev.preventDefault();
        sim.releasePossess("esc");
        document.exitPointerLock();
        refreshUi();
        return;
      }
      const realm = sim.getState();
      if (realm.basilisk && realm.kingId[sim.getLocalTeam()] === (realm.possessedId ?? realm.playerUnitId)) {
        if (ev.key === "1") {
          sim.setKingOrder("gather");
          refreshUi();
          return;
        }
        if (ev.key === "2") {
          sim.setKingOrder("hold");
          refreshUi();
          return;
        }
        if (ev.key === "3") {
          sim.setKingOrder("hunt");
          refreshUi();
          return;
        }
      }
      if (possessed) {
        if (ev.code === "Space") {
          ev.preventDefault();
          sim.togglePause();
          refreshUi();
        }
        return;
      }
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
    const onUp = (ev: KeyboardEvent) => {
      const step = ev.key.toLowerCase();
      if (step === "w" || step === "a" || step === "s" || step === "d") sim.setPossessKey(step, false);
    };
    const onLock = () => {
      if (document.pointerLockElement != null) return;
      if (!sim.getState().basilisk || sim.getState().possessedId == null) return;
      sim.releasePossess("esc");
      refreshUi();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onUp);
    document.addEventListener("pointerlockchange", onLock);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onUp);
      document.removeEventListener("pointerlockchange", onLock);
    };
  }, [sim, refreshUi, setPatrol, toggleFullscreen]);

  useEffect(() => {
    const onLook = (ev: MouseEvent) => {
      const canvas = canvasRef.current;
      if (document.pointerLockElement !== canvas) return;
      const r = rendererRef.current;
      if (!r) return;
      r.lookBy(ev.movementX, ev.movementY);
      sim.setPossessYaw(r.getFpsYaw());
    };
    const onLockChange = () => {
      if (document.pointerLockElement === canvasRef.current) return;
      if (sim.getState().possessedId == null) return;
      sim.releasePossess("esc");
      setUi(sim.getUiSnapshot());
    };
    const onStrike = (ev: MouseEvent) => {
      if (document.pointerLockElement !== canvasRef.current) return;
      if (ev.button !== 0) return;
      ev.preventDefault();
      sim.possessAttack();
      rendererRef.current?.kickSwing();
    };
    document.addEventListener("mousemove", onLook);
    document.addEventListener("pointerlockchange", onLockChange);
    document.addEventListener("mousedown", onStrike);
    return () => {
      document.removeEventListener("mousemove", onLook);
      document.removeEventListener("pointerlockchange", onLockChange);
      document.removeEventListener("mousedown", onStrike);
    };
  }, [sim]);

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
          : ui.pvp
            ? "Click your keep to train peons. Right-drag orbits, Shift-drag pans, wheel zooms."
            : "Click a trained soldier to take the field. WASD move, mouse look, click to strike. Kills let you scroll the wheel out. Esc returns.",
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
    if (ui.selectedKeepTeam === ui.localTeam && prev.selectedKeepTeam !== ui.localTeam) {
      showHint("keep-panel", "Queue peons here. Build Houses on eco pads to raise the cap.");
    }
  }, [ui, showHint]);

  const onSelectBuild = (kind: BuildingKind) => {
    sim.selectBuild(kind);
    refreshUi();
    beep(280);
  };

  const onEnqueue = (kind: TrainKind) => {
    sim.enqueueTrain(kind, sim.getLocalTeam());
    refreshUi();
    beep(360);
  };

  const onQuality = (setting: QualitySetting) => {
    rendererRef.current?.setQuality(setting);
  };

  const sheetOpen = ui.selectedKeepTeam === ui.localTeam || Boolean(ui.selectedBuildingId && ui.selectedBuildingKind);
  const compactHud = layout.layout === "column" || layout.phone;
  const compactBuild = layout.layout === "column" && layout.phone;

  const clusterActions: ClusterAction[] = [
    {
      id: "recall",
      icon: "🔔",
      label: "Recall",
      hint: "Recall all peons to your keep",
      onPress: () => {
        sim.callVillagersHome(sim.getLocalTeam());
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
        sim.garrisonVillagers(sim.getLocalTeam());
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
      if (hit?.kind === "unit" && state.units.some((u) => u.id === Number(hit.id) && u.team !== sim.getLocalTeam())) {
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
        sim.callVillagersHome(sim.getLocalTeam());
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
          <span className="brand-mark">Basilisk</span>
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
        />

        <div className={sheetOpen ? "stage sheet-open" : "stage"} ref={stageRef}>
          <canvas ref={canvasRef} className={ui.possessed ? "battlefield possessed" : "battlefield"} />
          {ui.possessed && (
            <div className={`fps-hud${ui.possessed.kind === "trebuchet" ? " treb-hud" : ""}`} aria-hidden>
              <span className="fps-crosshair" />
              {ui.possessed.kind === "trebuchet" ? (
                <>
                  <p className="fps-banner">
                    {ui.possessed.label} · {ui.possessed.hp}/{Math.ceil(ui.possessed.maxHp)}
                    {ui.possessed.aimLabel ? ` · ${ui.possessed.aimLabel}` : " · look at a tower, then click to wind"}
                  </p>
                  <div className="fps-charge">
                    <i style={{ width: `${Math.round(Math.min(1, ui.possessed.charge) * 100)}%` }} />
                    <span>{ui.possessed.charge >= 1 ? "Loose!" : "Click to wind"}</span>
                  </div>
                </>
              ) : (
                <>
                <p className="fps-banner">
                  {ui.possessed.label} · {ui.possessed.hp}/{Math.ceil(ui.possessed.maxHp)} · vision{" "}
                  {Math.min(ui.possessed.visionMax, Math.floor(ui.possessed.visionScore))}/{ui.possessed.visionMax}
                  {ui.basilisk
                    ? ui.possessed.visionScore < 1
                      ? " · haul to look out"
                      : " · wheel looks out"
                    : ui.possessed.visionScore <= 0
                      ? " · kill to scroll out"
                      : " · wheel looks out"}
                  {ui.possessed.isKing ? " · KING" : ""}
                </p>
                {ui.basilisk && (
                  <button
                    type="button"
                    className="ghost leave-body"
                    onClick={() => {
                      sim.releasePossess("esc");
                      document.exitPointerLock();
                      refreshUi();
                    }}
                  >
                    Leave body
                  </button>
                )}
                </>
              )}
            </div>
          )}
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
                  sim.garrisonVillagers(sim.getLocalTeam());
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
          {ui.phase === "running" && !ui.basilisk && (
          <div className="banner-rail">
            {ui.idlePeonCount > 0 && (
              <button
                type="button"
                className="pennant work-pennant"
                aria-label={`Send ${ui.idlePeonCount} idle peon${ui.idlePeonCount === 1 ? "" : "s"} back to work`}
                title={`Send ${ui.idlePeonCount} idle peon${ui.idlePeonCount === 1 ? "" : "s"} back to work`}
                onClick={() => {
                  sim.sendPeonsToWork(sim.getLocalTeam());
                  refreshUi();
                  beep(340);
                }}
              >
                To work
                <span>{ui.idlePeonCount}</span>
              </button>
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
          </div>
          )}
          {!layout.touch && !ui.basilisk && (
            <p className="cam-hint">Drag-select · right-click orders · right-drag orbit · Shift-drag pan · wheel zoom</p>
          )}
          {!layout.touch && ui.basilisk && ui.phase === "running" && (
            <p className="cam-hint">WASD walk · stand on farm/deer/mine/trees to fill 10 · dump at keep</p>
          )}
          {ui.basilisk?.youAreKing && ui.phase === "running" && (
            <div className="king-orders" role="toolbar" aria-label="King orders">
              <strong>Crown</strong>
              {(["gather", "hold", "hunt"] as KingOrder[]).map((order) => (
                <button
                  key={order}
                  type="button"
                  className={ui.basilisk?.kingOrder === order ? "active" : ""}
                  onClick={() => {
                    sim.setKingOrder(order);
                    refreshUi();
                    beep(400);
                  }}
                >
                  {order === "gather" ? "Gather" : order === "hold" ? "Hold fords" : "Hunt"}
                </button>
              ))}
            </div>
          )}
          <div className="sheet-dock">
            <div className="sheet-slot">
            {(!ui.basilisk || ui.basilisk.youAreKing) && (
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
              sim.enqueuePeon(sim.getLocalTeam());
              refreshUi();
              beep(300);
            }}
            onCallHome={() => {
              sim.callVillagersHome(sim.getLocalTeam());
              refreshUi();
              beep(240);
            }}
            onGarrison={() => {
              sim.garrisonVillagers(sim.getLocalTeam());
              refreshUi();
              beep(560);
            }}
            onUngarrison={() => {
              sim.ungarrisonVillagers(sim.getLocalTeam());
              refreshUi();
              beep(260);
            }}
          />
            )}
            </div>
          </div>
          <Overlays
            ui={ui}
            hideTitle={skirmish.lobby.open || skirmish.lobby.live || campaignOpen}
            skirmishLive={skirmish.lobby.live}
            onRerollMap={() => {
              sim.rerollMap();
              refreshUi();
              beep(440);
            }}
            onSkirmish={skirmish.openLobby}
            onCampaign={() => {
              setTriumph(null);
              setCampaignOpen(true);
            }}
            onStart={(clan: Team) => {
              if (skirmish.lobby.open || skirmish.lobby.live) return;
              setCampaignOpen(false);
              afterPortalBreak(() => {
                sim.setMatchMode("ai");
                sim.setLocalTeam(clan);
                sim.startBasilisk(clan);
                const r = rendererRef.current;
                r?.enterPossess(sim.getPossessYaw(), false);
                canvasRef.current?.requestPointerLock();
                refreshUi();
                beep(520);
              });
            }}
            onRestart={() => {
              if (skirmish.lobby.live) return;
              if (ui.pvp) skirmish.leave();
              else sim.reset();
              refreshUi();
              hpRef.current = 100;
            }}
            onReturnToMap={() => {
              if (ui.missionId != null && ui.freshHold) {
                setTriumph({ id: ui.missionId, unlock: ui.freshUnlock });
              } else {
                setTriumph(null);
              }
              sim.reset();
              setCampaignOpen(true);
              refreshUi();
              hpRef.current = 100;
            }}
            onMarchAgain={() => {
              if (ui.missionId == null) return;
              afterPortalBreak(() => {
                sim.startCampaign(ui.missionId!);
                setCampaignOpen(false);
                refreshUi();
                beep(520);
              });
            }}
          />
          {campaignOpen && ui.phase === "title" && (
            <CampaignMap
              triumph={triumph}
              onTriumphDone={() => setTriumph(null)}
              onClose={() => {
                setTriumph(null);
                setCampaignOpen(false);
              }}
              onMarch={(id) => {
                setTriumph(null);
                afterPortalBreak(() => {
                  sim.startCampaign(id);
                  setCampaignOpen(false);
                  refreshUi();
                  beep(520);
                });
              }}
            />
          )}
          {skirmish.lobby.open && !skirmish.lobby.live && (
            <SkirmishLobby
              name={skirmish.name}
              onName={skirmish.setName}
              role={skirmish.lobby.role}
              hostName={skirmish.lobby.hostName}
              guestName={skirmish.lobby.guestName}
              hostConnected={skirmish.lobby.hostConnected}
              guestConnected={skirmish.lobby.guestConnected}
              invite={skirmish.lobby.invite}
              joinDraft={skirmish.lobby.joinDraft}
              onJoinDraft={skirmish.setJoinDraft}
              status={skirmish.lobby.status}
              link={skirmish.lobby.link}
              copied={skirmish.lobby.copied}
              canStart={skirmish.lobby.role === "host" && skirmish.lobby.guestConnected}
              onHost={skirmish.hostMatch}
              onJoin={() => skirmish.joinMatch()}
              onCopy={() => void skirmish.copyInvite()}
              onStart={() => {
                afterPortalBreak(() => {
                  skirmish.startSkirmish();
                  refreshUi();
                  beep(520);
                });
              }}
              onLeave={() => {
                skirmish.leave();
                refreshUi();
              }}
            />
          )}
          {skirmish.lobby.live && (
            <div className="link-pill" role="status">
              {skirmish.lobby.link === "down"
                ? "Link lost"
                : skirmish.lobby.pingMs != null
                  ? `Link ${skirmish.lobby.pingMs} ms`
                  : "Link …"}
            </div>
          )}
          {skirmish.lobby.live && ui.phase === "ended" && (
            <SkirmishEnd
              result={ui.endReason}
              role={skirmish.lobby.role}
              maps={skirmishMaps()}
              mapId={skirmish.lobby.selectedMapId}
              linkDown={skirmish.lobby.link === "down"}
              canRematch={skirmish.lobby.role === "host" && skirmish.lobby.link === "open" && skirmish.lobby.guestConnected}
              onPick={skirmish.pickMap}
              onRematch={() => {
                skirmish.rematch();
                refreshUi();
                beep(520);
              }}
              onLeave={() => {
                skirmish.leave();
                refreshUi();
                hpRef.current = 100;
              }}
            />
          )}
          {skirmish.lobby.link === "down" && ui.phase === "running" && (
            <div className="opponent-down" role="alert">
              Opponent disconnected
            </div>
          )}
        </div>

        {ui.phase === "running" && (!ui.basilisk || ui.basilisk.youAreKing) && (
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
        )}
      </div>
    </div>
  );
}
