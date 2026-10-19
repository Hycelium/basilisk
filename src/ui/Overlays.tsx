import { useEffect, useState } from "react";
import { formatIntellect, veryHard } from "../game/learningAi";
import type { MapSize, SeatControl, SkirmishSetup, UiSnapshot } from "../game/types";

interface OverlaysProps {
  ui: UiSnapshot;
  onStart: (setup: SkirmishSetup) => void;
  onRestart: () => void;
  onRerollMap: () => void;
}

const SETUP_KEY = "roadkeep.skirmish";

function loadSetup(): SkirmishSetup {
  try {
    const raw = localStorage.getItem(SETUP_KEY);
    if (!raw) return { mapSize: "small", players: 2 };
    const data = JSON.parse(raw) as Partial<SkirmishSetup>;
    const mapSize: MapSize = data.mapSize === "large" ? "large" : "small";
    const players = mapSize === "large" || data.players === 3 ? 3 : 2;
    return { mapSize: players === 3 ? "large" : "small", players: players === 3 ? 3 : 2 };
  } catch {
    return { mapSize: "small", players: 2 };
  }
}

/**
 * Skirmish slots are the future lobby roster.
 * A later host can reuse this same list as Local / AI / Open.
 * "Human — room code later" is the Open seat. It stays disabled:
 * GitHub Pages cannot host a realtime room, so this build never joins one.
 * When that host exists, a room code fills an Open seat without a new menu.
 */
const SEAT_OPTIONS: { id: SeatControl; label: string; enabled: boolean }[] = [
  { id: "ai", label: "AI", enabled: true },
  { id: "open", label: "Human — room code later", enabled: false },
];

export function Overlays({ ui, onStart, onRestart, onRerollMap }: OverlaysProps) {
  const [setup, setSetup] = useState<SkirmishSetup>(loadSetup);

  useEffect(() => {
    try {
      localStorage.setItem(SETUP_KEY, JSON.stringify(setup));
    } catch {
      /* private mode */
    }
  }, [setup]);

  const chooseMap = (mapSize: MapSize) => {
    setSetup({ mapSize, players: mapSize === "large" ? 3 : 2 });
  };
  const choosePlayers = (players: 2 | 3) => {
    setSetup({ players, mapSize: players === 3 ? "large" : "small" });
  };

  const slots: { name: string; control: SeatControl; fixed?: boolean }[] = [
    { name: "You", control: "local", fixed: true },
    { name: setup.players === 3 ? "North" : "Foe", control: "ai" },
  ];
  if (setup.players === 3) slots.push({ name: "East", control: "ai" });

  return (
    <>
      {ui.phase === "title" && (
        <div className="overlay title-overlay skirmish-setup">
          <h1>Skirmish</h1>
          <p className="keep-lvl">
            Keep Level {ui.keepLevel} · XP {ui.keepXp}/{ui.keepXpNext}
          </p>
          <p className="skirmish-lead">Set the field, then start. One button begins the match.</p>

          <fieldset className="skirmish-field">
            <legend>Map</legend>
            <div className="seg" role="group" aria-label="Map size">
              <button type="button" className={setup.mapSize === "small" ? "on" : ""} onClick={() => chooseMap("small")}>
                Small
                <small>1v1</small>
              </button>
              <button type="button" className={setup.mapSize === "large" ? "on" : ""} onClick={() => chooseMap("large")}>
                Large
                <small>3 keeps</small>
              </button>
            </div>
          </fieldset>

          <fieldset className="skirmish-field">
            <legend>Players</legend>
            <div className="seg" role="group" aria-label="Player count">
              <button type="button" className={setup.players === 2 ? "on" : ""} onClick={() => choosePlayers(2)}>
                2
              </button>
              <button type="button" className={setup.players === 3 ? "on" : ""} onClick={() => choosePlayers(3)}>
                3
              </button>
            </div>
          </fieldset>

          <div className="slot-list" role="list" aria-label="Player slots">
            {slots.map((slot, index) => (
              <div className="slot-row" role="listitem" key={`${slot.name}-${index}`}>
                <span className="slot-idx">{index + 1}</span>
                <span className="slot-name">{slot.name}</span>
                {slot.fixed ? (
                  <select aria-label={`${slot.name} control`} value="local" disabled>
                    <option value="local">Local</option>
                  </select>
                ) : (
                  <select aria-label={`${slot.name} control`} value="ai" onChange={() => undefined}>
                    {SEAT_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id} disabled={!opt.enabled}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ))}
          </div>

          <div className="map-card selected campaign-map">
            <strong>{setup.mapSize === "large" ? "Three-keep field" : ui.mapName}</strong>
            <span>
              {setup.mapSize === "large"
                ? "You hold the south. North and East each bring their own economy."
                : ui.mapTagline}
            </span>
            {setup.mapSize === "small" && (
              <span className="map-meta">
                Campaign Lv {ui.campaignLevel}
                {ui.scoutSalt > 0 ? ` · Scout ${ui.scoutSalt}` : ""} · seed {ui.mapSeed}
              </span>
            )}
          </div>

          {setup.mapSize === "small" && (
            <button type="button" className="ghost reroll-btn" onClick={onRerollMap}>
              Scout new terrain
            </button>
          )}

          <p className="foe-brain-tease">
            Foe intellect {formatIntellect(ui.foeIntellect)}
            {veryHard(ui.foeIntellect) ? " · very hard" : ""}
            {ui.foeGames > 0 ? ` · ${ui.foeWins}W / ${ui.foeGames} games learned` : " · virgin Q-table"}
          </p>

          <button type="button" className="cta" onClick={() => onStart(setup)}>
            Start Skirmish
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
            Your keep: {ui.stats.yourKeep}
            {ui.enemyKeeps.length > 1
              ? ui.enemyKeeps.map((k) => ` · ${k.name}: ${k.hp}`).join("")
              : ` · Theirs: ${ui.stats.foeKeep}`}
          </p>
          {ui.lastXpGain > 0 && <p className="xp-gain">+{ui.lastXpGain} Keep XP</p>}
          <p className="keep-lvl">Keep Level {ui.keepLevel}</p>
          <p className="foe-brain-tease">
            Foe intellect {formatIntellect(ui.foeIntellect)}
            {veryHard(ui.foeIntellect) ? " · very hard" : ""} · remembered {ui.foeGames} sieges
          </p>
          <div className="foe-iq-meter" title="Progress to the next intellect level">
            <div className="bar iq">
              <div className="fill" style={{ width: `${ui.foeIntellectPct * 100}%` }} />
            </div>
          </div>
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
