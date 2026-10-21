import { useEffect, useState } from "react";
import { UNIT_DEFS } from "../game/balance";
import {
  MISSIONS,
  loadCampaign,
  missionStatus,
  unitPlural,
  type CampaignMission,
  type MissionStatus,
} from "../game/campaign";

interface CampaignMapProps {
  onClose: () => void;
  onMarch: (id: number) => void;
  /** Set when the map opens on a march just held for the first time. */
  triumph: { id: number; unlock: string } | null;
  onTriumphDone: () => void;
}

function Coin() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <ellipse cx="16" cy="22" rx="8" ry="5" fill="#c4922a" />
      <ellipse cx="16" cy="18" rx="8" ry="5" fill="#e2b23a" />
      <ellipse cx="16" cy="14" rx="8" ry="5" fill="#ffe08a" />
      <ellipse cx="16" cy="14" rx="3.5" ry="2" fill="#a87420" />
    </svg>
  );
}

function Hammer() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M8 20 L18 10" stroke="#d7d2c8" strokeWidth="3" strokeLinecap="round" />
      <rect x="14" y="6" width="12" height="7" rx="1.5" transform="rotate(40 20 9)" fill="#c0c4cc" />
      <rect x="16" y="8" width="8" height="3" rx="0.5" transform="rotate(40 20 9)" fill="#8d929c" />
    </svg>
  );
}

export function CampaignMap({ onClose, onMarch, triumph, onTriumphDone }: CampaignMapProps) {
  const progress = loadCampaign();
  const firstOpen = MISSIONS.find((m) => missionStatus(m.id, progress) === "open") ?? MISSIONS[0];
  const [selectedId, setSelectedId] = useState(triumph?.id ?? firstOpen.id);
  const [pennant, setPennant] = useState(false);
  const [triumphReady, setTriumphReady] = useState(false);
  const selected = MISSIONS.find((m) => m.id === selectedId) ?? firstOpen;
  const status = missionStatus(selected.id, progress);
  const label = UNIT_DEFS[selected.unit].label;
  const plural = unitPlural(selected.unit);
  const heldCount = progress.cleared.length;
  const claimed = triumph ? MISSIONS.find((m) => m.id === triumph.id) ?? null : null;

  useEffect(() => {
    if (!triumph) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const delay = reduce ? 0 : triumph.unlock ? 680 : 900;
    const id = window.setTimeout(() => {
      setTriumphReady(true);
      if (triumph.unlock) setPennant(true);
    }, delay);
    return () => window.clearTimeout(id);
  }, [triumph]);

  return (
    <div className="campaign-screen">
      <div className="campaign-frame">
        <button type="button" className="campaign-back" onClick={onClose}>
          Back
        </button>
        <div className="campaign-banner">The Ten Marches</div>
        <div
          className="campaign-map"
          aria-label="Campaign missions"
          onClick={() => {
            if (triumph && triumphReady) onTriumphDone();
          }}
        >
          <div className="campaign-fit">
          <svg className="campaign-terrain" viewBox="0 0 1000 620" preserveAspectRatio="xMidYMid meet">
            <defs>
              <linearGradient id="march-land" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#8a9460" />
                <stop offset="0.45" stopColor="#6e8a48" />
                <stop offset="1" stopColor="#4e6a38" />
              </linearGradient>
              <linearGradient id="march-rock" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#d5d8dc" />
                <stop offset="0.35" stopColor="#8d9398" />
                <stop offset="1" stopColor="#3e4548" />
              </linearGradient>
            </defs>
            <rect width="1000" height="620" fill="url(#march-land)" />
            <path d="M0 80 L180 40 L260 160 L140 280 L40 240 Z" fill="url(#march-rock)" opacity="0.95" />
            <path d="M0 300 L120 260 L200 420 L80 520 L0 480 Z" fill="#5c6568" />
            <path d="M720 430 L900 380 L1000 460 L1000 620 L640 620 Z" fill="#5a6240" />
            <path d="M760 80 L920 20 L1000 90 L1000 220 L820 180 Z" fill="url(#march-rock)" opacity="0.8" />
            <path
              d="M120 40 C 260 120, 300 80, 420 160 C 560 250, 540 300, 700 280 C 860 260, 900 340, 980 400"
              fill="none"
              stroke="#6d92a4"
              strokeWidth="16"
              opacity="0.55"
            />
            <circle cx="300" cy="150" r="46" fill="#2f4a2c" opacity="0.85" />
            <circle cx="250" cy="190" r="28" fill="#243c22" />
            <circle cx="520" cy="120" r="36" fill="#2c4628" />
            <circle cx="610" cy="200" r="40" fill="#243e22" />
            <circle cx="180" cy="430" r="34" fill="#2a4426" />
            <circle cx="430" cy="480" r="42" fill="#2c4828" />
            <circle cx="760" cy="300" r="30" fill="#314c2c" />
            <path
              d="M160 90 C 280 70, 340 150, 300 240 C 250 340, 360 420, 300 520 C 250 600, 420 600, 480 520 C 560 410, 500 300, 620 240 C 760 170, 700 80, 820 70"
              fill="none"
              stroke="rgba(255,255,255,0.55)"
              strokeWidth="3"
            />
            <path
              d="M80 200 C 180 180, 220 260, 160 340 C 110 420, 200 500, 140 580"
              fill="none"
              stroke="rgba(255,255,255,0.35)"
              strokeWidth="2"
            />
          </svg>
          {MISSIONS.map((mission) => (
            <Province
              key={mission.id}
              mission={mission}
              status={missionStatus(mission.id, progress)}
              claiming={triumph?.id === mission.id}
            />
          ))}
          {MISSIONS.map((mission) => {
            const nodeStatus = missionStatus(mission.id, progress);
            const picked = mission.id === selected.id;
            const claiming = triumph?.id === mission.id;
            return (
              <button
                key={mission.id}
                type="button"
                className={`campaign-node ${nodeStatus}${picked ? " picked" : ""}${claiming ? " claiming" : ""}`}
                style={{ left: `${mission.x}%`, top: `${mission.y}%` }}
                aria-pressed={picked}
                aria-label={`${mission.nation}, ${nodeStatus}`}
                onClick={() => setSelectedId(mission.id)}
              >
                {mission.mode === "onslaught" ? <Hammer /> : <Coin />}
                <span>{mission.id}</span>
              </button>
            );
          })}
          {pennant && claimed && triumph?.unlock ? (
            <div
              className={`oath-pennant${claimed.x > 58 ? " flip" : ""}`}
              style={{ left: `${claimed.x}%`, top: `${claimed.y}%` }}
              role="status"
            >
              <p>
                The <em>{triumph.unlock.toLowerCase()}</em> of {claimed.nation} are yours.
              </p>
            </div>
          ) : null}
          </div>
        </div>
        <footer className="campaign-dossier">
          <div>
            <strong>{selected.nation}</strong>
            <span>
              {selected.mode === "onslaught" ? "Onslaught" : "March"} {selected.id} of 10 · {plural} only
              {heldCount > 0 ? ` · ${heldCount} held` : ""}
            </span>
            <p className="campaign-blurb">{selected.blurb}</p>
            <p className="campaign-stake">
              {status === "held" && selected.mode === "march" && `${plural} are already yours.`}
              {status === "held" && selected.mode === "onslaught" && "This flood has been turned."}
              {status === "open" && selected.mode === "march" && `Victory unlocks the ${label}.`}
              {status === "open" && selected.mode === "onslaught" && `Waves of ${plural}, on a wider field.`}
              {status === "locked" && "Sealed until the march before it is held."}
            </p>
          </div>
          <button type="button" className="cta" disabled={status === "locked"} onClick={() => onMarch(selected.id)}>
            {status === "held" ? "March again" : status === "open" ? "March" : "Sealed"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Province({
  mission,
  status,
  claiming,
}: {
  mission: CampaignMission;
  status: MissionStatus;
  claiming: boolean;
}) {
  return (
    <div
      className={`campaign-province ${status}${claiming ? " claiming" : ""}`}
      style={{ left: `${mission.x}%`, top: `${mission.y}%` }}
    />
  );
}
