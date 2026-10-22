import { useEffect, useState } from "react";
import { JOB_LABEL } from "../game/basiliskMap";
import type { Job, Team, UiSnapshot } from "../game/types";

const ITCH_PAGE = "https://ka9krew.itch.io/roadkeep";
const DISCORD_INVITE = "https://discord.gg/FGbUfaxy8v";

function shareText(url: string) {
  return `Play Basilisk with me: ${url} — walk a job, promote, take the crown. Discord: ${DISCORD_INVITE}`;
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
  onStart: (clan: Team, job: Job) => void;
  onSkirmish: () => void;
  onCampaign: () => void;
  onRestart: () => void;
  onReturnToMap: () => void;
  onMarchAgain: () => void;
  onRerollMap: () => void;
}

export function Overlays({
  ui,
  hideTitle,
  skirmishLive,
  onStart,
  onRestart,
  onReturnToMap,
  onMarchAgain,
}: OverlaysProps) {
  const [shareNote, setShareNote] = useState("");
  const [clan, setClan] = useState<Team>("you");
  const [job, setJob] = useState<Job>("farmer");

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
          <img className="menu-logo" src={`${import.meta.env.BASE_URL}icons/icon-512.png`} alt="" />
          <h1>Basilisk</h1>
          <p className="keep-lvl">Twin valleys · one life at a time</p>
          <p>Walk your job. Promote on the fat tail. The highest XP wears the crown.</p>

          <div className="clan-pick" role="group" aria-label="Clan">
            <button type="button" className={clan === "you" ? "cta" : "ghost"} onClick={() => setClan("you")}>
              Blue south
            </button>
            <button type="button" className={clan === "foe" ? "cta" : "ghost"} onClick={() => setClan("foe")}>
              Red north
            </button>
          </div>
          <div className="job-pick" role="group" aria-label="Job">
            {(Object.keys(JOB_LABEL) as Job[]).map((id) => (
              <button
                key={id}
                type="button"
                className={job === id ? "cta" : "ghost"}
                onClick={() => setJob(id)}
              >
                {JOB_LABEL[id]}
              </button>
            ))}
          </div>

          <ul className="tips">
            <li>Farmer → Runner · Hunter → Archer · Blacksmith → Ward · Lumberjack → Ram</li>
            <li>Esc leaves the body gathering. Click it to take first person again.</li>
          </ul>

          <div className="title-actions">
            <button type="button" className="cta" onClick={() => onStart(clan, job)}>
              Enter the valley
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
          {ui.missionId != null && ui.freshUnlock ? (
            <p className="xp-gain">{ui.freshUnlock} unlocked.</p>
          ) : null}
          <p className="keep-lvl">Keep Level {ui.keepLevel}</p>
          <p className="foe-brain-tease">
            Foe intellect {ui.foeIntellect} · remembered {ui.foeGames} sieges
          </p>
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
