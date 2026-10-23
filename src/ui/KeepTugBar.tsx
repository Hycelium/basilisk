import type { UiSnapshot } from "../game/types";

interface KeepTugBarProps {
  ui: UiSnapshot;
}

export function KeepTugBar({ ui }: KeepTugBarProps) {
  const youIsLocal = ui.localTeam === "you";
  const youHp = youIsLocal ? ui.yourHp : ui.foeHp;
  const foeHp = youIsLocal ? ui.foeHp : ui.yourHp;
  const youMax = youIsLocal ? ui.yourMaxHp : ui.foeMaxHp;
  const foeMax = youIsLocal ? ui.foeMaxHp : ui.yourMaxHp;
  const youPct = Math.max(0, Math.min(1, youHp / Math.max(1, youMax)));
  const foePct = Math.max(0, Math.min(1, foeHp / Math.max(1, foeMax)));
  return (
    <div
      className="keep-tug"
      role="img"
      aria-label={`South keep ${youHp}, north keep ${foeHp}`}
    >
      <div className="keep-tug-half you">
        <i style={{ width: `${youPct * 100}%` }} />
        <span>{youHp}</span>
      </div>
      <div className="keep-tug-half foe">
        <i style={{ width: `${foePct * 100}%` }} />
        <span>{foeHp}</span>
      </div>
    </div>
  );
}
