import { useEffect, useState } from "react";
import { laneCount } from "../game/map";
import type { UiSnapshot } from "../game/types";

const ITCH_PAGE = "https://ka9krew.itch.io/roadkeep";
const DISCORD_INVITE = "https://discord.gg/FGbUfaxy8v";

function shareText(url: string) {
  return `Play Roadkeep with me: ${url} — versus AI, or Skirmish and I'll send an invite link. Discord: ${DISCORD_INVITE}`;
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
  onStart: () => void;
  onSkirmish: () => void;
  onRestart: () => void;
  onRerollMap: () => void;
}

export function Overlays({ ui, hideTitle, skirmishLive, onStart, onSkirmish, onRestart, onRerollMap }: OverlaysProps) {
  const [shareNote, setShareNote] = useState("");
  const roads = laneCount(ui.mapSeed);

  useEffect(() => {
    if (!shareNote) return;
    const id = window.setTimeout(() => setShareNote(""), 2200);
    return () => window.clearTimeout(id);
  }, [shareNote]);

  const copyLink = async () => {
    const ok = await copyText(ITCH_PAGE);
    if (ok) setShareNote("Link copied");
  };

  const shareOnX = () => {
    const intent = new URL("https://twitter.com/intent/tweet");
    intent.searchParams.set("text", shareText(ITCH_PAGE));
    intent.searchParams.set("url", ITCH_PAGE);
    openExternal(intent.href);
  };

  return (
    <>
      {ui.phase === "title" && !hideTitle && (
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
              {ui.scoutSalt > 0 ? ` · Scout ${ui.scoutSalt}` : ""} · {roads === 1 ? "1 road" : `${roads} roads`} · seed{" "}
              {ui.mapSeed}
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

          <div className="title-actions">
            <button type="button" className="cta" onClick={onStart}>
              Take the field — {ui.mapName}
            </button>
            <button type="button" className="ghost" onClick={onSkirmish}>
              Skirmish
            </button>
          </div>

          <div className="title-share" role="group" aria-label="Share this game">
            <button type="button" onClick={() => void copyLink()}>
              Copy link
            </button>
            <button type="button" onClick={() => openExternal(ITCH_PAGE)}>
              itch.io
            </button>
            <button type="button" onClick={() => openExternal(DISCORD_INVITE)}>
              Discord
            </button>
            <button type="button" onClick={shareOnX}>
              X
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
