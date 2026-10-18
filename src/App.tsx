import { useEffect, useMemo, useRef, useState } from "react";
import "./styles.css";
import { GameRenderer } from "./game/render3d";
import { GameSim, hitTest } from "./game/sim";
import type { BuildingKind, CombatEventKind, TrainKind, UiSnapshot } from "./game/types";
import { BUILD_COST } from "./game/balance";
import { Hud } from "./ui/Hud";
import { BuildBar } from "./ui/BuildBar";
import { DetailSheet } from "./ui/DetailSheet";
import { Overlays } from "./ui/Overlays";

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
  foeGames: 0,
  foeWins: 0,
  foeExplore: 0.35,
  foeLastAction: "wait",
};

export default function App() {
  const pageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sim = useMemo(() => new GameSim(), []);
  const rendererRef = useRef<GameRenderer | null>(null);
  const [ui, setUi] = useState<UiSnapshot>(() => sim.getUiSnapshot() ?? defaultUi);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const heardCombatRef = useRef(new Set<number>());
  const heardMapRef = useRef("");
  const hpRef = useRef(100);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const patrolModeRef = useRef(false);
  const selectionBoxRef = useRef<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const [patrolMode, setPatrolMode] = useState(false);
  const [selectionBox, setSelectionBox] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await pageRef.current?.requestFullscreen();
    }
  };

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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new GameRenderer(canvas);
    rendererRef.current = renderer;
    renderer.resize();
    const onResize = () => renderer.resize();
    window.addEventListener("resize", onResize);

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

    const onDown = (ev: PointerEvent) => {
      if (!rendererRef.current) return;
      if (ev.button === 2) ev.preventDefault();
      const rect = canvas.getBoundingClientRect();
      if (ev.pointerType === "mouse" && ev.button === 0 && !ev.shiftKey && !ev.altKey) {
        dragStartRef.current = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
      } else {
        dragStartRef.current = null;
      }
      rendererRef.current.onPointerDown(ev);
      if (!sim.getState().audioUnlocked) sim.unlockAudio();
    };
    const onMove = (ev: PointerEvent) => {
      rendererRef.current?.onPointerMove(ev);
      const start = dragStartRef.current;
      if (start && (ev.buttons & 1) !== 0) {
        const rect = canvas.getBoundingClientRect();
        const x = ev.clientX - rect.left;
        const y = ev.clientY - rect.top;
        if (Math.hypot(x - start.x, y - start.y) > 6) {
          const box = {
            left: Math.min(start.x, x),
            top: Math.min(start.y, y),
            width: Math.abs(x - start.x),
            height: Math.abs(y - start.y),
          };
          selectionBoxRef.current = box;
          setSelectionBox(box);
        }
      }
    };
    const onUp = (ev: PointerEvent) => {
      const r = rendererRef.current;
      if (!r) return;
      const tap = r.onPointerUp(ev);
      const rect = canvas.getBoundingClientRect();
      const localX = ev.clientX - rect.left;
      const localY = ev.clientY - rect.top;
      const start = dragStartRef.current;
      const box = selectionBoxRef.current;
      if (box && start && ev.button === 0) {
        const a = r.screenToWorld(box.left, box.top);
        const b = r.screenToWorld(
          box.left + box.width,
          box.top + box.height,
        );
        sim.selectVillagersInRect(a, b, ev.ctrlKey || ev.metaKey);
        setUi(sim.getUiSnapshot());
        setSelectionBox(null);
        selectionBoxRef.current = null;
        dragStartRef.current = null;
        beep(410, 0.04);
        return;
      }
      setSelectionBox(null);
      selectionBoxRef.current = null;
      dragStartRef.current = null;
      if (!tap) return;
      const world = r.screenToWorld(localX, localY);
      const hit = hitTest(sim.getState(), world.x, world.y);
      if (ev.button === 2) {
        if (sim.getState().buildSelection) sim.click(hit, world);
        else sim.commandSelected(world, hit, patrolModeRef.current);
        patrolModeRef.current = false;
        setPatrolMode(false);
        beep(hit?.kind === "node" ? 520 : 370, 0.045);
      } else {
        sim.click(hit, world);
      }
      setUi(sim.getUiSnapshot());
      if (ev.button !== 2) beep(320);
    };
    const onWheel = (ev: WheelEvent) => rendererRef.current?.onWheel(ev);
    const onContext = (ev: Event) => ev.preventDefault();

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", onContext);

    return () => {
      window.removeEventListener("resize", onResize);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onContext);
      cancelAnimationFrame(raf);
    };
  }, [sim]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
      requestAnimationFrame(() => rendererRef.current?.resize());
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
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
        patrolModeRef.current = false;
        setPatrolMode(false);
      }
      if ((ev.key === "p" || ev.key === "P") && sim.getState().selectedVillagerIds.length > 0) {
        patrolModeRef.current = !patrolModeRef.current;
        setPatrolMode(patrolModeRef.current);
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
      }
      setUi(sim.getUiSnapshot());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sim]);

  const onSelectBuild = (kind: BuildingKind) => {
    sim.selectBuild(kind);
    setUi(sim.getUiSnapshot());
    beep(280);
  };

  const onEnqueue = (kind: TrainKind) => {
    sim.enqueueTrain(kind, "you");
    setUi(sim.getUiSnapshot());
    beep(360);
  };

  return (
    <div className="page" ref={pageRef}>
      <div className="phone">
        <header className="brand">
          <span className="brand-mark">Roadkeep</span>
          <span className="brand-sub">three.js siege · dusk valley</span>
        </header>

        <div className="stage">
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
          {ui.selectedPeonCount > 0 && (
            <div className="unit-command-bar">
              <strong>{ui.selectedPeonCount} peon{ui.selectedPeonCount === 1 ? "" : "s"}</strong>
              <button
                type="button"
                className={patrolMode ? "active" : ""}
                onClick={() => {
                  patrolModeRef.current = !patrolModeRef.current;
                  setPatrolMode(patrolModeRef.current);
                }}
                title="Then right-click a patrol destination"
              >
                Patrol (P)
              </button>
              <button
                type="button"
                onClick={() => {
                  sim.stopSelectedVillagers();
                  setUi(sim.getUiSnapshot());
                }}
              >
                Stop
              </button>
              <small>Right-click to move, gather, or attack · Ctrl+number saves group</small>
            </div>
          )}
          <div className="cam-pad" aria-label="Camera controls">
            <button type="button" title="Zoom in" onClick={() => rendererRef.current?.zoomBy(0.88)}>
              +
            </button>
            <button type="button" title="Zoom out" onClick={() => rendererRef.current?.zoomBy(1.14)}>
              −
            </button>
            <button type="button" title="Tilt up" onClick={() => rendererRef.current?.orbitBy(0, -36)}>
              ⌃
            </button>
            <button type="button" title="Tilt down" onClick={() => rendererRef.current?.orbitBy(0, 36)}>
              ⌄
            </button>
            <button type="button" title="Reset view" className="cam-reset" onClick={() => rendererRef.current?.resetCamera()}>
              ⟲
            </button>
            <button
              type="button"
              title={isFullscreen ? "Exit full screen (F)" : "Full screen (F)"}
              aria-label={isFullscreen ? "Exit full screen" : "Enter full screen"}
              className="fullscreen-toggle"
              onClick={() => void toggleFullscreen()}
            >
              {isFullscreen ? "↙" : "⛶"}
            </button>
            <button
              type="button"
              title="Recall all peons"
              aria-label="Recall all peons to your keep"
              className="peon-recall"
              onClick={() => {
                sim.callVillagersHome("you");
                setUi(sim.getUiSnapshot());
                beep(620, 0.12);
              }}
            >
              🔔
            </button>
          </div>
          <p className="cam-hint">Drag-select · right-click orders · right-drag orbit · Shift-drag pan</p>
          <DetailSheet
            ui={ui}
            onClose={() => {
              sim.cancelSelection();
              setUi(sim.getUiSnapshot());
            }}
            onUpgradeDamage={() => {
              sim.buyUpgrade("damage");
              setUi(sim.getUiSnapshot());
              beep(400);
            }}
            onUpgradeRate={() => {
              sim.buyUpgrade("rate");
              setUi(sim.getUiSnapshot());
              beep(460);
            }}
            onRaze={() => {
              sim.razeSelected();
              setUi(sim.getUiSnapshot());
              beep(220);
            }}
            onEnqueue={onEnqueue}
            onCancelQueue={(i) => {
              sim.cancelQueueSlot(i);
              setUi(sim.getUiSnapshot());
              beep(200);
            }}
            onEnqueuePeon={() => {
              sim.enqueuePeon("you");
              setUi(sim.getUiSnapshot());
              beep(300);
            }}
            onCallHome={() => {
              sim.callVillagersHome("you");
              setUi(sim.getUiSnapshot());
              beep(240);
            }}
            onGarrison={() => {
              sim.garrisonVillagers("you");
              setUi(sim.getUiSnapshot());
              beep(560);
            }}
            onUngarrison={() => {
              sim.ungarrisonVillagers("you");
              setUi(sim.getUiSnapshot());
              beep(260);
            }}
          />
          <Overlays
            ui={ui}
            onRerollMap={() => {
              sim.rerollMap();
              setUi(sim.getUiSnapshot());
              beep(440);
            }}
            onStart={() => {
              sim.startMatch();
              setUi(sim.getUiSnapshot());
              beep(520);
            }}
            onRestart={() => {
              sim.reset();
              setUi(sim.getUiSnapshot());
              hpRef.current = 100;
            }}
          />
        </div>

        <Hud
          ui={ui}
          onPause={() => {
            sim.togglePause();
            setUi(sim.getUiSnapshot());
          }}
          onSpeed={() => {
            sim.toggleSpeed();
            setUi(sim.getUiSnapshot());
          }}
          onSound={() => {
            sim.unlockAudio();
            if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
            void audioCtxRef.current.resume();
            sim.setSound(!sim.getState().soundOn);
            setUi(sim.getUiSnapshot());
          }}
          onRush={() => {
            sim.rushNextWave();
            setUi(sim.getUiSnapshot());
            beep(500);
          }}
        />
        <BuildBar
          ui={ui}
          getCost={(k) => BUILD_COST[k]!}
          onSelect={onSelectBuild}
          onCancel={() => {
            sim.cancelSelection();
            setUi(sim.getUiSnapshot());
          }}
        />
      </div>
    </div>
  );
}
