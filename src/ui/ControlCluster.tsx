import { useEffect, useRef, type CSSProperties } from "react";
import type { TouchDragMode } from "../game/render3d";

export interface ClusterAction {
  id: string;
  icon: string;
  label: string;
  hint?: string;
  onPress: () => void;
  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
}

interface ControlClusterProps {
  expanded: boolean;
  onToggle: (open: boolean) => void;
  actions: ClusterAction[];
  touch: boolean;
  /** Arc opens downward instead of upward (used when a bottom sheet is open and the FAB rides at the top). */
  flip?: boolean;
  dragMode: TouchDragMode;
  onDragMode: (mode: TouchDragMode) => void;
  /** 0 = closest, 1 = furthest. Non-touch only. */
  zoom: number;
  onZoom: (t: number) => void;
}

/**
 * Collapsible floating action button. Collapsed it is a single 52px round button;
 * expanded it fans 4–6 actions along a quarter-arc so nothing sits over the battlefield
 * unless the player asks for it.
 */
export function ControlCluster({
  expanded,
  onToggle,
  actions,
  touch,
  flip = false,
  dragMode,
  onDragMode,
  zoom,
  onZoom,
}: ControlClusterProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onToggle(false);
    };
    const onDown = (ev: PointerEvent) => {
      if (!rootRef.current?.contains(ev.target as Node)) onToggle(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [expanded, onToggle]);

  const count = actions.length;
  const radius = count <= 4 ? 108 : 132;
  const span = count <= 4 ? 90 : 96;
  const start = (90 - span) / 2 + (span > 90 ? -3 : 0);
  const step = count > 1 ? span / (count - 1) : 0;

  return (
    <div ref={rootRef} className={`control-cluster${expanded ? " open" : ""}${flip ? " flip" : ""}`}>
      {touch && (
        <div className="drag-mode" role="group" aria-label="One-finger drag mode">
          <button
            type="button"
            className={dragMode === "select" ? "on" : ""}
            aria-pressed={dragMode === "select"}
            onClick={() => onDragMode("select")}
            title="One-finger drag draws a selection box"
          >
            ▭ Select
          </button>
          <button
            type="button"
            className={dragMode === "camera" ? "on" : ""}
            aria-pressed={dragMode === "camera"}
            onClick={() => onDragMode("camera")}
            title="One-finger drag orbits the camera"
          >
            ⟲ Camera
          </button>
        </div>
      )}
      {!touch && expanded && (
        <label className="zoom-slider" title="Zoom">
          <span className="sr-only">Zoom</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={zoom}
            onChange={(ev) => onZoom(Number(ev.currentTarget.value))}
            aria-label="Camera zoom"
          />
        </label>
      )}
      <div className="cluster-arc" role="menu" aria-label="Quick actions" aria-hidden={!expanded} id="cluster-arc">
        {actions.map((a, i) => {
          const deg = (start + step * i) * (Math.PI / 180);
          const tx = -Math.cos(deg) * radius;
          const ty = (flip ? 1 : -1) * Math.sin(deg) * radius;
          return (
            <button
              key={a.id}
              type="button"
              role="menuitem"
              className={`cluster-btn${a.active ? " active" : ""}${a.danger ? " danger" : ""}`}
              style={
                {
                  "--tx": `${tx.toFixed(1)}px`,
                  "--ty": `${ty.toFixed(1)}px`,
                  "--delay": `${i * 22}ms`,
                } as CSSProperties
              }
              tabIndex={expanded ? 0 : -1}
              disabled={a.disabled}
              aria-label={a.label}
              aria-pressed={a.active ?? undefined}
              title={a.hint ?? a.label}
              onClick={() => {
                a.onPress();
                if (a.id !== "patrol") onToggle(false);
              }}
            >
              <span className="cluster-ico" aria-hidden>
                {a.icon}
              </span>
              <span className="cluster-cap" aria-hidden>
                {a.label}
              </span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="fab"
        aria-expanded={expanded}
        aria-controls="cluster-arc"
        aria-label={expanded ? "Close quick actions" : "Open quick actions"}
        title={expanded ? "Close" : "Quick actions"}
        onClick={() => onToggle(!expanded)}
      >
        <span className="fab-glyph" aria-hidden>
          {expanded ? "✕" : "⚔"}
        </span>
      </button>
    </div>
  );
}
