import type { DefendLayerId, UiSnapshot } from "../game/types";

interface DefendBarProps {
  ui: UiSnapshot;
  onDefend: (layer: DefendLayerId | null) => void;
  /** When false, hide even if layers exist (e.g. non-king). */
  enabled?: boolean;
}

/** Concentrate troops on a river-bridge layer (Hold fords). */
export function DefendBar({ ui, onDefend, enabled = true }: DefendBarProps) {
  const layers = ui.basilisk?.defendLayers ?? [];
  const active = ui.basilisk?.defendLayer ?? null;
  if (!enabled || ui.phase !== "running" || layers.length === 0) return null;
  return (
    <div className="defend-bar" role="toolbar" aria-label="Defend bridges">
      <strong>Defend</strong>
      {layers.map((layer) => (
        <button
          key={layer.id}
          type="button"
          className={active === layer.id ? "active" : ""}
          aria-pressed={active === layer.id}
          onClick={() => onDefend(active === layer.id ? null : layer.id)}
        >
          {layer.label}
        </button>
      ))}
      {active && (
        <button type="button" className="ghost" onClick={() => onDefend(null)}>
          Stand down
        </button>
      )}
    </div>
  );
}
