import type { UiSnapshot } from "../game/types";

interface OverlaysProps {
  ui: UiSnapshot;
  onStart: () => void;
  onRestart: () => void;
  onRerollMap: () => void;
}

export function Overlays({ ui, onStart, onRestart, onRerollMap }: OverlaysProps) {
  return (
    <>
      {ui.phase === "title" && (
        <div className="overlay title-overlay">
          <h1>Roadkeep</h1>
          <p className="keep-lvl">
            Keep Level {ui.keepLevel} · XP {ui.keepXp}/{ui.keepXpNext}
          </p>
          <p>Every keep level forges a new battlefield. Infinite campaign maps.</p>

          <div className="map-card selected campaign-map">
            <strong>{ui.mapName}</strong>
            <span>{ui.mapTagline}</span>
            <span className="map-meta">
              Campaign Lv {ui.campaignLevel}
              {ui.scoutSalt > 0 ? ` · Scout ${ui.scoutSalt}` : ""} · seed {ui.mapSeed}
            </span>
          </div>

          <button type="button" className="ghost reroll-btn" onClick={onRerollMap}>
            Scout new terrain
          </button>

          <p className="foe-brain-tease">
            Foe intellect {ui.foeIntellect}
            {ui.foeGames > 0 ? ` · ${ui.foeWins}W / ${ui.foeGames} games learned` : " · virgin Q-table"}
          </p>

          <ul className="tips">
            <li>The foe Q-learns your builds across sessions</li>
            <li>Level up → brand-new map layout forever</li>
            <li>Scout new terrain → reroll pads &amp; resources at this level</li>
          </ul>

          <button type="button" className="cta" onClick={onStart}>
            Take the field — {ui.mapName}
          </button>
        </div>
      )}

      {ui.phase === "ended" && (
        <div className="overlay">
          <h2>{ui.endReason}</h2>
          <p>Slain: {ui.stats.slain}</p>
          <p>Gold earned: {ui.stats.goldEarned}</p>
          <p>
            Waves: {ui.stats.waves}/{ui.totalWaves}
          </p>
          <p>
            Your keep: {ui.stats.yourKeep} · Theirs: {ui.stats.foeKeep}
          </p>
          {ui.lastXpGain > 0 && <p className="xp-gain">+{ui.lastXpGain} Keep XP</p>}
          <p className="keep-lvl">Keep Level {ui.keepLevel}</p>
          <p className="foe-brain-tease">
            Foe intellect {ui.foeIntellect} · remembered {ui.foeGames} sieges
          </p>
          <p className="map-next-hint">Play again loads the map for your current keep level. The foe keeps learning.</p>
          <button type="button" className="cta" onClick={onRestart}>
            Play again
          </button>
        </div>
      )}

      {ui.phase === "running" && ui.toasts.length > 0 && (
        <div className="toasts">
          {ui.toasts.slice(-2).map((t, i) => (
            <div key={`${t}-${i}`} className="toast">
              {t}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
