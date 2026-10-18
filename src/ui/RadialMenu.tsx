import { useEffect, useRef } from "react";

export interface RadialItem {
  id: string;
  icon: string;
  label: string;
  onPress: () => void;
  tone?: "move" | "patrol" | "gather" | "attack" | "build" | "recall";
}

interface RadialMenuProps {
  /** Anchor in stage-local pixels. */
  x: number;
  y: number;
  /** Stage size, used to keep the ring on screen. */
  width: number;
  height: number;
  items: RadialItem[];
  onDismiss: () => void;
  /** Auto-dismiss delay in ms. */
  ttl?: number;
}

/** Compact contextual ring opened by a long-press. Dismisses on choice, outside tap, or timeout. */
export function RadialMenu({ x, y, width, height, items, onDismiss, ttl = 4200 }: RadialMenuProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const t = window.setTimeout(onDismiss, ttl);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onDismiss();
    };
    const onDown = (ev: PointerEvent) => {
      if (!rootRef.current?.contains(ev.target as Node)) onDismiss();
    };
    window.addEventListener("keydown", onKey);
    // Deferred so the long-press pointerup that opened us doesn't instantly close us.
    const arm = window.setTimeout(() => window.addEventListener("pointerdown", onDown, true), 50);
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(arm);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [onDismiss, ttl]);

  const radius = 72;
  const pad = radius + 30;
  const cx = Math.min(Math.max(x, pad), Math.max(pad, width - pad));
  const cy = Math.min(Math.max(y, pad), Math.max(pad, height - pad));
  const n = items.length;

  return (
    <div
      ref={rootRef}
      className="radial"
      style={{ left: cx, top: cy }}
      role="menu"
      aria-label="Orders"
      onContextMenu={(ev) => ev.preventDefault()}
    >
      <span className="radial-core" aria-hidden />
      {items.map((item, i) => {
        const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
        const tx = Math.cos(a) * radius;
        const ty = Math.sin(a) * radius;
        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={`radial-item tone-${item.tone ?? "move"}`}
            style={{ transform: `translate(calc(-50% + ${tx.toFixed(1)}px), calc(-50% + ${ty.toFixed(1)}px))` }}
            onClick={() => {
              item.onPress();
              onDismiss();
            }}
            aria-label={item.label}
          >
            <span aria-hidden>{item.icon}</span>
            <small>{item.label}</small>
          </button>
        );
      })}
    </div>
  );
}
