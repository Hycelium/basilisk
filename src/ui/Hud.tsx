import type { UiSnapshot } from "../game/types";

interface HudProps {
  ui: UiSnapshot;
  onPause: () => void;
  onSpeed: () => void;
  onSound: () => void;
  onRush: () => void;
}

export function Hud({ ui, onPause, onSpeed, onSound, onRush }: HudProps) {
  const hpPct = Math.max(0, Math.min(1, ui.yourHp / ui.yourMaxHp));
  const xpPct = ui.keepXpPct;
  const phaseLabel =
    ui.wavePhase === "build"
      ? `Build ${Math.ceil(ui.buildTimer)}s`
      : ui.wavePhase === "spawning"
        ? "Spawning"
        : "Fighting";
  const explorePct = Math.round(ui.foeExplore * 100);

  return (
    <div className="hud">
      <div className="hud-top">
        <div className="stat lives">
          <span className="label">LIVES</span>
          <span className={ui.yourHp <= 80 ? "value danger" : "value"}>{ui.yourHp}</span>
          <div className="bar">
            <div className="fill" style={{ width: `${hpPct * 100}%` }} />
          </div>
        </div>
        <div className="stat">
          <span className="label">GOLD</span>
          <span className="value">{ui.yourGold}</span>
        </div>
        <div className="stat">
          <span className="label">WOOD</span>
          <span className="value wood">{ui.yourWood}</span>
        </div>
        <div className="stat">
          <span className="label">POP</span>
          <span className="value">
            {ui.peonCount}/{ui.peonCap}
          </span>
        </div>
        <div className="stat">
          <span className="label">WAVE</span>
          <span className="value">{ui.waveLabel}</span>
          <span className="phase-tag">{phaseLabel}</span>
        </div>
        <div className="stat">
          <span className="label">FOE HP</span>
          <span className="value">{ui.foeHp}</span>
        </div>
        <div className="stat intellect">
          <span className="label">FOE IQ</span>
          <span className="value">{ui.foeIntellect}</span>
          <span className="phase-tag muted">
            {ui.foeWins}W/{ui.foeGames}G · ε{explorePct}%
          </span>
        </div>
      </div>
      <div className="hud-xp-row">
        <div className="stat keep-xp-stat">
          <span className="label">KEEP LV {ui.keepLevel}</span>
          <div className="bar xp">
            <div className="fill" style={{ width: `${xpPct * 100}%` }} />
          </div>
        </div>
      </div>
      <div className="hud-controls">
        <button type="button" onClick={onPause}>
          {ui.paused ? "Resume" : "Pause"}
        </button>
        <button type="button" onClick={onSpeed}>
          {ui.speed}×
        </button>
        <button type="button" onClick={onSound}>
          Sound: {ui.soundOn ? "On" : "Off"}
        </button>
        <button type="button" className="rush-btn" onClick={onRush} disabled={!ui.canRush}>
          Rush wave +18g
        </button>
      </div>
    </div>
  );
}
