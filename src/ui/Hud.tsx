import type { QualityInfo, QualitySetting } from "../game/render3d";
import type { UiSnapshot } from "../game/types";

interface HudProps {
  ui: UiSnapshot;
  /** Phone top-bar density: icon controls, single stat row. */
  compact: boolean;
  quality: QualityInfo;
  onQuality: (setting: QualitySetting) => void;
  onPause: () => void;
  onSpeed: () => void;
  onSound: () => void;
  onRush: () => void;
}

export function Hud({ ui, compact, quality, onQuality, onPause, onSpeed, onSound, onRush }: HudProps) {
  const hpPct = Math.max(0, Math.min(1, ui.yourHp / ui.yourMaxHp));
  const xpPct = ui.keepXpPct;
  const phaseLabel =
    ui.wavePhase === "build"
      ? `Build ${Math.ceil(ui.buildTimer)}s`
      : ui.wavePhase === "spawning"
        ? "Spawning"
        : "Fighting";
  const explorePct = Math.round(ui.foeExplore * 100);
  const qualityLabel =
    quality.setting === "auto" ? `Auto · ${quality.tier}` : quality.setting[0].toUpperCase() + quality.setting.slice(1);

  return (
    <div className={compact ? "hud compact" : "hud"}>
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
        <button type="button" onClick={onPause} aria-label={ui.paused ? "Resume" : "Pause"} title="Space">
          <span className="full">{ui.paused ? "Resume" : "Pause"}</span>
          <span className="short" aria-hidden>
            {ui.paused ? "▶" : "❚❚"}
          </span>
        </button>
        <button type="button" onClick={onSpeed} aria-label={`Game speed ${ui.speed}x`}>
          {ui.speed}×
        </button>
        <button type="button" onClick={onSound} aria-label={ui.soundOn ? "Sound on" : "Sound off"} aria-pressed={ui.soundOn}>
          <span className="full">Sound: {ui.soundOn ? "On" : "Off"}</span>
          <span className="short" aria-hidden>
            {ui.soundOn ? "🔊" : "🔇"}
          </span>
        </button>
        <label className="quality-pick" title={`Graphics quality · ${quality.fps} fps`}>
          <span className="full">Quality</span>
          <span className="short" aria-hidden>
            ✦
          </span>
          <select
            value={quality.setting}
            onChange={(ev) => onQuality(ev.currentTarget.value as QualitySetting)}
            aria-label={`Graphics quality, currently ${qualityLabel}`}
          >
            <option value="auto">Auto ({quality.tier})</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
        <button type="button" className="rush-btn" onClick={onRush} disabled={!ui.canRush}>
          <span className="full">Rush wave +18g</span>
          <span className="short" aria-hidden>
            Rush +18g
          </span>
        </button>
      </div>
    </div>
  );
}
