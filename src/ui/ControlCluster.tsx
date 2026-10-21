import { useEffect, useRef } from "react";
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
  /** Kept so a bottom sheet can still mark the rail; banners stay in the top-right. */
  flip?: boolean;
  dragMode: TouchDragMode;
  onDragMode: (mode: TouchDragMode) => void;
  /** 0 = closest, 1 = furthest. Non-touch only. */
  zoom: number;
  onZoom: (t: number) => void;
}

/**
 * Top-right command pennants. Collapsed, one banner. Open, the orders hang beneath it.
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

  return (
    <div ref={rootRef} className={`command-banners${expanded ? " open" : ""}${flip ? " flip" : ""}`}>
      <button
        type="button"
        className="pennant command-toggle"
        aria-expanded={expanded}
        aria-controls="cluster-arc"
        aria-label={expanded ? "Close quick actions" : "Open quick actions"}
        title={expanded ? "Close" : "Quick actions"}
        onClick={() => onToggle(!expanded)}
      >
        {expanded ? "Close" : "Commands"}
      </button>
      <div className="banner-stack" role="menu" aria-label="Quick actions" aria-hidden={!expanded} id="cluster-arc">
        {actions.map((a) => (
          <button
            key={a.id}
            type="button"
            role="menuitem"
            className={`pennant${a.active ? " active" : ""}${a.danger ? " danger" : ""}`}
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
            {a.label}
          </button>
        ))}
        {touch && (
          <div className="drag-mode" role="group" aria-label="One-finger drag mode">
            <button
              type="button"
              className={dragMode === "select" ? "on" : ""}
              aria-pressed={dragMode === "select"}
              onClick={() => onDragMode("select")}
              title="One-finger drag draws a selection box"
            >
              Select
            </button>
            <button
              type="button"
              className={dragMode === "camera" ? "on" : ""}
              aria-pressed={dragMode === "camera"}
              onClick={() => onDragMode("camera")}
              title="One-finger drag orbits the camera"
            >
              Camera
            </button>
          </div>
        )}
        {!touch && (
          <label className="banner-zoom" title="Zoom">
            <span>Zoom</span>
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
      </div>
    </div>
  );
}
