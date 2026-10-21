import { useEffect, useState } from "react";
import { UNIT_DEFS } from "../game/balance";
import {
  MISSIONS,
  loadCampaign,
  missionStatus,
  unitPlural,
  type MissionStatus,
} from "../game/campaign";

interface CampaignMapProps {
  onClose: () => void;
  onMarch: (id: number) => void;
  /** Set when the map opens on a march just held for the first time. */
  triumph: { id: number; unlock: string } | null;
  onTriumphDone: () => void;
}

/** Shared borders, same 0–100 space as the mission tokens. The ten marches tile the table. */
const TERRITORY: Record<number, string> = {
  1: "M0,0 L24,0 L28,12 L18,28 L8,34 L0,26 Z",
  2: "M24,0 L50,0 L54,16 L66,26 L42,30 L28,34 L18,28 L28,12 Z",
  3: "M50,0 L76,0 L80,14 L66,26 L54,16 Z",
  4: "M0,26 L8,34 L18,28 L28,34 L34,50 L38,62 L22,66 L6,68 L0,56 Z",
  5: "M66,26 L80,14 L90,34 L94,50 L78,58 L76,62 L60,58 L62,48 Z",
  6: "M0,56 L6,68 L22,66 L30,80 L16,100 L0,100 Z",
  7: "M22,66 L38,62 L60,58 L76,62 L84,76 L68,100 L16,100 L30,80 Z",
  8: "M90,34 L100,32 L100,100 L68,100 L84,76 L76,62 L78,58 L94,50 Z",
  9: "M28,34 L42,30 L66,26 L62,48 L60,58 L38,62 L34,50 Z",
  10: "M76,0 L100,0 L100,32 L90,34 L80,14 Z",
};

/** Seeded stands, kept off the medallions. Each entry is x, y, height. */
const WOODS: [number, number, number][] = (() => {
  const stands: [number, number, number][] = [
    [7, 10, 16],
    [33, 8, 12],
    [64, 7, 14],
    [6, 44, 11],
    [46, 40, 9],
    [90, 40, 12],
    [9, 80, 10],
    [38, 80, 12],
    [80, 84, 11],
  ];
  const trees: [number, number, number][] = [];
  let n = 11;
  for (const [cx, cy, count] of stands) {
    for (let i = 0; i < count; i++) {
      n = (n * 17 + 5) % 97;
      const angle = (n / 97) * Math.PI * 2;
      const reach = ((n * 3) % 11) / 2.4;
      trees.push([
        Math.round((cx + Math.cos(angle) * reach) * 10) / 10,
        Math.round((cy + Math.sin(angle) * reach * 0.62) * 10) / 10,
        0.85 + (n % 4) * 0.28,
      ]);
    }
  }
  return trees;
})();

const HAMLETS: [number, number][] = [
  [32, 20],
  [58, 10],
  [12, 46],
  [80, 42],
  [40, 72],
  [72, 74],
];

function WarTable({
  statusOf,
  triumphId,
}: {
  statusOf: (id: number) => MissionStatus;
  triumphId: number | null;
}) {
  const open = MISSIONS.find((mission) => statusOf(mission.id) === "open");
  const previous = open && open.id > 1 ? MISSIONS[open.id - 2] : null;
  const paintOrder = [...MISSIONS].sort((a, b) => {
    const rank = { locked: 0, open: 1, held: 2 };
    return rank[statusOf(a.id)] - rank[statusOf(b.id)];
  });

  return (
    <svg className="campaign-terrain" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="march-land" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8d9460" />
          <stop offset="0.45" stopColor="#6d8448" />
          <stop offset="1" stopColor="#4e6236" />
        </linearGradient>
        <linearGradient id="march-rock" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e4e7ea" />
          <stop offset="0.28" stopColor="#9aa1a6" />
          <stop offset="1" stopColor="#3c4448" />
        </linearGradient>
        <radialGradient id="march-vignette" cx="50%" cy="46%" r="68%">
          <stop offset="0.55" stopColor="rgba(0,0,0,0)" />
          <stop offset="1" stopColor="rgba(12,10,8,0.55)" />
        </radialGradient>
        <filter id="march-grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" result="n" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
      </defs>
      <rect width="100" height="100" fill="url(#march-land)" />
      <ellipse cx="30" cy="22" rx="14" ry="8" fill="#7d8a52" opacity="0.45" />
      <ellipse cx="62" cy="70" rx="18" ry="10" fill="#617844" opacity="0.4" />
      <ellipse cx="78" cy="18" rx="12" ry="7" fill="#8a9160" opacity="0.35" />
      <path d="M0,0 L14,2 L8,14 L16,22 L6,34 L0,30 Z" fill="url(#march-rock)" />
      <path d="M0,0 L9,3 L4,8 Z" fill="#f4f7f8" opacity="0.9" />
      <path d="M0,38 L10,34 L16,48 L8,62 L0,58 Z" fill="#5c6568" />
      <path d="M0,72 L8,68 L12,82 L4,96 L0,94 Z" fill="url(#march-rock)" opacity="0.8" />
      <path d="M86,0 L100,0 L100,18 L92,12 L84,4 Z" fill="url(#march-rock)" />
      <path d="M92,0 L100,0 L100,8 L96,4 Z" fill="#f4f7f8" opacity="0.85" />
      <path d="M70,78 L84,72 L96,84 L88,98 L68,96 Z" fill="#6a6048" opacity="0.85" />
      <path
        d="M0,48 C16,44 22,52 34,50 C48,48 52,40 66,44 C78,48 86,62 100,70"
        fill="none"
        stroke="#5f86a0"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
      <path
        d="M2,47 C18,43 24,51 36,49 C50,47 54,39 68,43 C80,47 88,61 100,69"
        fill="none"
        stroke="#d5e8ef"
        strokeWidth="0.28"
        opacity="0.7"
      />
      <ellipse cx="7" cy="11" rx="8" ry="5" fill="#24381e" opacity="0.55" />
      <ellipse cx="64" cy="8" rx="8" ry="4.5" fill="#24381e" opacity="0.5" />
      <ellipse cx="90" cy="42" rx="7" ry="4" fill="#24381e" opacity="0.45" />
      <ellipse cx="38" cy="82" rx="8" ry="4" fill="#24381e" opacity="0.4" />
      <ellipse cx="36" cy="18" rx="4.2" ry="2.2" fill="#6d92a4" opacity="0.8" />
      <ellipse cx="36" cy="18" rx="2.4" ry="1.1" fill="#c5dde6" opacity="0.45" />
      {WOODS.map(([x, y, h], i) => (
        <path
          key={`${x}-${y}-${i}`}
          d={`M${x},${y - h} L${x - h * 0.55},${y + h * 0.45} L${x + h * 0.55},${y + h * 0.45} Z`}
          fill={i % 3 === 0 ? "#1a301c" : "#345432"}
        />
      ))}
      {HAMLETS.map(([x, y]) => (
        <g key={`${x}-${y}`} transform={`translate(${x} ${y})`}>
          <path d="M-1.2,0.2 L0,-1 L1.2,0.2 Z" fill="#3a2a1c" />
          <rect x="-0.8" y="0.15" width="1.6" height="1.05" fill="#6a5340" />
        </g>
      ))}
      {paintOrder.map((mission) => (
        <path
          key={mission.id}
          d={TERRITORY[mission.id]}
          className={`territory ${statusOf(mission.id)}${triumphId === mission.id ? " claiming" : ""}`}
        />
      ))}
      <rect width="100" height="100" fill="url(#march-vignette)" />
      <rect width="100" height="100" filter="url(#march-grain)" opacity="0.08" style={{ mixBlendMode: "multiply" }} />
      {previous && open ? (
        <line className="march-next" x1={previous.x} y1={previous.y} x2={open.x} y2={open.y} />
      ) : null}
    </svg>
  );
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
        <div className="table-candle left" aria-hidden="true" />
        <div className="table-candle right" aria-hidden="true" />
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
          <WarTable statusOf={(id) => missionStatus(id, progress)} triumphId={triumph?.id ?? null} />
          <div className="table-compass" aria-hidden="true">
            <span>N</span>
          </div>
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
            <span className="orders-kicker">Field orders · {heldCount} of 10 held</span>
            <strong>{selected.nation}</strong>
            <span className="orders-meta">
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
