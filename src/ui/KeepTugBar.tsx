import type { UiSnapshot } from "../game/types";

interface KeepTugBarProps {
  ui: UiSnapshot;
}

export function KeepTugBar({ ui }: KeepTugBarProps) {
  const youPct = Math.max(0, Math.min(1, ui.yourHp / Math.max(1, ui.yourMaxHp)));
  const foePct = Math.max(0, Math.min(1, ui.foeHp / Math.max(1, ui.foeMaxHp)));
  const foeName = ui.pvp ? (ui.localTeam === "you" ? "Red" : "Blue") : "CPU";
  const youCost = ui.armyCost;
  const foeCost = ui.foeArmyCost;
  const costTotal = youCost + foeCost;
  const youShare = costTotal > 0 ? youCost / costTotal : 0.5;
  const foeShare = costTotal > 0 ? foeCost / costTotal : 0.5;
  return (
    <div className="keep-tug-stack">
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
      <div
        className="army-tug"
        role="img"
        aria-label={`Military strength you ${youCost}, ${foeName} ${foeCost}`}
      >
        <span className="army-tug-cost you">{youCost}</span>
        <div className="army-tug-track" title="Relative barracks army cost">
          <i className="you" style={{ width: `${youShare * 100}%` }} />
          <i className="foe" style={{ width: `${foeShare * 100}%` }} />
        </div>
        <span className="army-tug-cost foe">{foeCost}</span>
        <em className="army-tug-label">Strength</em>
      </div>
    </div>
  );
}
