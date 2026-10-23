import { useRef, type PointerEvent } from "react";
import type { WorkKind } from "../game/types";

const JOBS: { kind: WorkKind; label: string }[] = [
  { kind: "wood", label: "Wood" },
  { kind: "gold", label: "Gold" },
  { kind: "farm", label: "Farm" },
  { kind: "hunt", label: "Hunt" },
];

interface LaborSteppersProps {
  labor: { wood: number; gold: number; farm: number; hunt: number };
  idle: number;
  peonCount: number;
  onAdjust: (kind: WorkKind, delta: number) => void;
}

function holdRepeat(fn: () => void) {
  let timer: number | null = null;
  const start = () => {
    fn();
    timer = window.setTimeout(function tick() {
      fn();
      timer = window.setTimeout(tick, 90);
    }, 360);
  };
  const stop = () => {
    if (timer != null) window.clearTimeout(timer);
    timer = null;
  };
  return { start, stop };
}

export function LaborSteppers({ labor, idle, peonCount, onAdjust }: LaborSteppersProps) {
  const latest = useRef({ labor, peonCount, onAdjust });
  latest.current = { labor, peonCount, onAdjust };
  const holds = useRef(new Map<string, ReturnType<typeof holdRepeat>>());

  const bind = (key: string, kind: WorkKind, delta: number) => {
    let hold = holds.current.get(key);
    if (!hold) {
      hold = holdRepeat(() => {
        const s = latest.current;
        const count = s.labor[kind];
        if (delta > 0 && count >= s.peonCount) return;
        if (delta < 0 && count <= 0) return;
        s.onAdjust(kind, delta);
      });
      holds.current.set(key, hold);
    }
    return {
      onPointerDown: (ev: PointerEvent<HTMLButtonElement>) => {
        ev.preventDefault();
        ev.currentTarget.setPointerCapture(ev.pointerId);
        hold!.start();
      },
      onPointerUp: () => hold!.stop(),
      onPointerCancel: () => hold!.stop(),
    };
  };

  return (
    <div className="labor-grid">
      {JOBS.map(({ kind, label }) => {
        const count = labor[kind];
        const canAdd = count < peonCount;
        const canCut = count > 0;
        return (
          <div key={kind} className="labor-step">
            <button
              type="button"
              className="labor-adj"
              disabled={!canCut}
              aria-label={`Fewer ${label} peons`}
              {...bind(`${kind}-`, kind, -1)}
            >
              −
            </button>
            <span className="labor-meta">
              <em>{label}</em>
              <strong>{count}</strong>
            </span>
            <button
              type="button"
              className="labor-adj"
              disabled={!canAdd}
              aria-label={`More ${label} peons`}
              {...bind(`${kind}+`, kind, 1)}
            >
              +
            </button>
          </div>
        );
      })}
      <p className="labor-idle">{idle} idle</p>
    </div>
  );
}
