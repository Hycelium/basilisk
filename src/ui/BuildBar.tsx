import { formatCost, type ResCost } from "../game/balance";
import type { BuildingKind, UiSnapshot } from "../game/types";

interface BuildBarProps {
  ui: UiSnapshot;
  /** Horizontal icon strip with cost badges (phones). */
  compact?: boolean;
  getCost: (kind: BuildingKind) => ResCost;
  onSelect: (kind: BuildingKind) => void;
  onCancel: () => void;
}

const builds: { kind: BuildingKind; label: string; blurb: string }[] = [
  { kind: "watchtower", label: "Watch", blurb: "Arrows · soft vs siege" },
  { kind: "ballista", label: "Ballista", blurb: "Long shot" },
  { kind: "catapult", label: "Catapult", blurb: "Splash" },
  { kind: "barracks", label: "Barracks", blurb: "Trains soldiers" },
  { kind: "house", label: "House", blurb: "+3 peon pop · eco pad" },
  { kind: "barricade", label: "Barricade", blurb: "Peon-built road block" },
];

export function BuildBar({ ui, compact = false, getCost, onSelect, onCancel }: BuildBarProps) {
  return (
    <div className={compact ? "build-wrap compact" : "build-wrap"}>
      {ui.buildSelection && (
        <div className="build-hint" role="status">
          <span>
            Place <strong>{ui.buildSelection}</strong>
            {ui.buildSelection === "house"
              ? " on a green eco pad behind your keep"
              : ui.buildSelection === "barricade"
                ? " directly across either road"
                : " on a glowing combat pad"}
            {" — "}
            {formatCost(getCost(ui.buildSelection))}
          </span>
          <button type="button" className="ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      )}
      <div className="buildbar" role="toolbar" aria-label="Build">
        {builds.map(({ kind, label, blurb }, i) => {
          const selected = ui.buildSelection === kind;
          const cost = getCost(kind);
          const afford = ui.yourGold >= cost.gold && ui.yourWood >= cost.wood;
          return (
            <button
              key={kind}
              type="button"
              className={selected ? "build-btn selected" : "build-btn"}
              onClick={() => (selected ? onCancel() : onSelect(kind))}
              aria-pressed={selected}
              aria-label={`${label} — ${blurb} — ${formatCost(cost)}`}
              title={`${label} (${i + 1}) · ${blurb}`}
            >
              <span className="build-icon" data-kind={kind} aria-hidden />
              <span className="build-copy">
                <strong>{label}</strong>
                <small>{blurb}</small>
              </span>
              <span className={afford ? "cost" : "cost broke"}>{formatCost(cost)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
