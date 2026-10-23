import { useEffect, useState } from "react";
import { basiliskMap } from "../game/basiliskMap";
import type { Team, UiSnapshot } from "../game/types";
import { MapPreview } from "./MapPreview";

const DISCORD_INVITE = "https://discord.gg/FGbUfaxy8v";

function gameUrl() {
  return new URL(import.meta.env.BASE_URL, window.location.origin).href;
}

function copyWithSelection(text: string) {
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "0";
    area.style.left = "0";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.focus();
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

async function copyText(text: string) {
  // Selection copy runs during the click. The async clipboard API drops the
  // gesture when it rejects, which is common in an unfocused embedded browser.
  const legacy = copyWithSelection(text);
  try {
    if (navigator.clipboard?.writeText && document.hasFocus()) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* the selection copy already ran */
  }
  return legacy;
}

function openExternal(url: string) {
  const tab = window.open(url, "_blank", "noopener,noreferrer");
  if (tab) tab.opener = null;
}

interface OverlaysProps {
  ui: UiSnapshot;
  hideTitle?: boolean;
  skirmishLive?: boolean;
  onStart: (clan: Team) => void;
  onSkirmish: () => void;
  onCampaign: () => void;
  onRestart: () => void;
  onReturnToMap: () => void;
  onMarchAgain: () => void;
  onRerollMap: () => void;
  onPickJoinClan?: (team: Team) => void;
  onRejoin?: (team: Team) => void;
}

export function Overlays({
  ui,
  hideTitle,
  skirmishLive,
  onStart,
  onSkirmish,
  onRestart,
  onReturnToMap,
  onMarchAgain,
  onPickJoinClan,
  onRejoin,
}: OverlaysProps) {
  const [shareNote, setShareNote] = useState("");
  const [clan, setClan] = useState<Team>("you");
  const playerRecord = `Your record · ${ui.playerWins}W / ${ui.playerLosses}L`;

  useEffect(() => {
    if (!shareNote) return;
    const id = window.setTimeout(() => setShareNote(""), 2200);
    return () => window.clearTimeout(id);
  }, [shareNote]);

  const copyLink = async () => {
    const ok = await copyText(gameUrl());
    if (ok) setShareNote("Link copied");
  };

  return (
    <>
      {ui.phase === "title" && !hideTitle && (
        <div className="overlay title-overlay">
          <img className="menu-logo" src={`${import.meta.env.BASE_URL}icons/icon-512.png`} alt="" />
          <h1>Basilisk</h1>
          <p className="keep-lvl">Twin valleys · one life at a time</p>
          <p className="menu-lead">Most peons only haul. A few chosen can promote. An AI king already holds the keep.</p>
          <p className="phone-controls-tip">On a phone: left stick walks, drag the right side to look, Fire to strike.</p>
          <p className="foe-brain-tease">{playerRecord}</p>

          <div className="map-card selected map-brief">
            <strong>{basiliskMap().name}</strong>
            <span>{basiliskMap().tagline}</span>
            <MapPreview seed={basiliskMap().seed} />
          </div>

          <div className="clan-pick" role="group" aria-label="Clan">
            <button type="button" className={clan === "you" ? "cta" : "ghost"} onClick={() => setClan("you")}>
              Blue south
            </button>
            <button type="button" className={clan === "foe" ? "cta" : "ghost"} onClick={() => setClan("foe")}>
              Red north
            </button>
          </div>

          <ul className="tips">
            <li>Peons feed the coffer. Only chosen promote: Farm 5 → Levy · Deer 5 → Archer · Gold 5 → Ward · Wood 5 → Ram · Wood 10 → Treb · Farm+Gold 5 → Runner</li>
            <li>Chosen: dump 5 farm, hunt, or gold (or 10 wood) to promote and take the crown. Five kills also usurps. Then command in RTS.</li>
            <li>As king, command like Roadkeep: select peons or barracks troops, then tap a field, grove, mine, or the ground. Tables hides the labor strip. Possess a barracks soldier with Enter body.</li>
          </ul>

          <div className="title-actions">
            <button type="button" className="cta" onClick={() => onStart(clan)}>
              Enter the valley
            </button>
            <button type="button" className="ghost" onClick={onSkirmish}>
              Skirmish
            </button>
          </div>

          <div className="title-share" role="group" aria-label="Share this game">
            <button type="button" onClick={() => void copyLink()}>
              Copy link
            </button>
            <button type="button" onClick={() => openExternal(DISCORD_INVITE)}>
              Discord
            </button>
          </div>
          {shareNote ? (
            <p className="title-note" role="status">
              {shareNote}
            </p>
          ) : null}
          <a className="privacy-link" href={`${import.meta.env.BASE_URL}privacy.html`} target="_blank" rel="noopener noreferrer">
            Privacy
          </a>
        </div>
      )}

      {ui.phase === "running" &&
        ui.basilisk &&
        !ui.possessed &&
        !ui.basilisk.youAreKing &&
        (ui.basilisk.joinTimer > 0 || ui.basilisk.joinReady) && (
          <div className="overlay join-overlay" role="dialog" aria-label="Rejoin the valley">
            <h2>{ui.basilisk.joinReady ? "Enter the valley" : "Fallen"}</h2>
            <p>
              {ui.basilisk.joinReady
                ? ui.pvp
                  ? "Spawn as a peon on your keep."
                  : "Pick a clan, then spawn as a peon."
                : ui.pvp
                  ? `Respawn in ${Math.ceil(ui.basilisk.joinTimer)}s.`
                  : `Respawn in ${Math.ceil(ui.basilisk.joinTimer)}s. You can switch sides.`}
            </p>
            {!ui.pvp && (
            <div className="clan-pick" role="group" aria-label="Clan">
              <button
                type="button"
                className={ui.localTeam === "you" ? "cta" : "ghost"}
                onClick={() => onPickJoinClan?.("you")}
              >
                Blue south
              </button>
              <button
                type="button"
                className={ui.localTeam === "foe" ? "cta" : "ghost"}
                onClick={() => onPickJoinClan?.("foe")}
              >
                Red north
              </button>
            </div>
            )}
            <button
              type="button"
              className="cta"
              disabled={!ui.basilisk.joinReady}
              onClick={() => onRejoin?.(ui.localTeam)}
            >
              {ui.basilisk.joinReady ? "Spawn as peon" : `Wait ${Math.ceil(ui.basilisk.joinTimer)}s`}
            </button>
          </div>
        )}

      {ui.phase === "ended" && !skirmishLive && (
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
          {ui.missionId != null && ui.freshUnlock ? (
            <p className="xp-gain">{ui.freshUnlock} unlocked.</p>
          ) : null}
          <p className="keep-lvl">Keep Level {ui.keepLevel}</p>
          <p className="foe-brain-tease">{playerRecord}</p>
          {ui.missionId != null ? (
            <>
              <p className="map-next-hint">
                {ui.missionName} fields one unit. Held marches stay on the map.
              </p>
              {ui.endReason.startsWith("Victory") ? (
                <>
                  <button type="button" className="cta" onClick={onReturnToMap}>
                    The map
                  </button>
                  <button type="button" className="ghost" onClick={onMarchAgain}>
                    March again
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="cta" onClick={onMarchAgain}>
                    March again
                  </button>
                  <button type="button" className="ghost" onClick={onReturnToMap}>
                    The map
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              <p className="map-next-hint">Play again loads the map for your current keep level. The foe keeps learning.</p>
              <button type="button" className="cta" onClick={onRestart}>
                Play again
              </button>
            </>
          )}
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
