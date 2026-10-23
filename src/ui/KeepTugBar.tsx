import type { UiSnapshot } from "../game/types";

interface KeepTugBarProps {
  ui: UiSnapshot;
}

export function KeepTugBar({ ui }: KeepTugBarProps) {
  const youPct = Math.max(0, Math.min(1, ui.yourHp / Math.max(1, ui.yourMaxHp)));
  const foePct = Math.max(0, Math.min(1, ui.foeHp / Math.max(1, ui.foeMaxHp)));
  const foeName = ui.pvp ? (ui.localTeam === "you" ? "Red" : "Blue") : "CPU";
  return (
    <div
      className="keep-tug"
      role="img"
      aria-label={`Your keep ${ui.yourHp}, ${foeName} keep ${ui.foeHp}`}
    >
      <div className="keep-tug-side you">
        <em>You</em>
        {ui.playerWins > 0 && <small>{ui.playerWins}W</small>}
        <div className="keep-tug-track">
          <i style={{ width: `${youPct * 100}%` }} />
        </div>
      </div>
      <div className="keep-tug-badge">{ui.yourHp}</div>
      <div className="keep-tug-side foe">
        <div className="keep-tug-track">
          <i style={{ width: `${foePct * 100}%` }} />
        </div>
        <em>{foeName}</em>
      </div>
    </div>
  );
}
