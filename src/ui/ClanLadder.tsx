import type { UiSnapshot } from "../game/types";

interface ClanLadderProps {
  ui: UiSnapshot;
  open: boolean;
}

export function ClanLadder({ ui, open }: ClanLadderProps) {
  const realm = ui.basilisk;
  if (!realm || ui.phase !== "running") return null;
  const moment = realm.moment && realm.moment.life > 0 ? realm.moment : null;
  return (
    <>
      {open && (
      <aside className="clan-ladder" aria-label="Clan XP ranking">
        <header>
          <strong>Clan XP</strong>
          <span>
            You #{realm.xpRank}/{Math.max(1, realm.clanSize)} · {realm.xp} XP
          </span>
        </header>
        <p className="clan-king-line">
          {realm.youAreKing ? "You wear the crown" : `King ${realm.kingName}`} · {realm.kingXp} XP
        </p>
        <ol>
          {realm.ranks.map((row) => (
            <li key={row.id} className={`${row.you ? "you" : ""}${row.king ? " king" : ""}`}>
              <em>
                {row.king ? "♔ " : ""}
                {row.name}
              </em>
              <span className="clan-xp">{row.xp}</span>
              <div className="clan-bar">
                <i style={{ width: `${Math.max(4, row.pct * 100)}%` }} />
              </div>
              <small>{row.nextLabel}</small>
            </li>
          ))}
        </ol>
        {realm.promotionNeed > 0 && (
          <div className="clan-promote">
            <span>
              Your path · {realm.promotionLabel} {realm.promotionHave}/{realm.promotionNeed}
            </span>
            <div className="clan-bar">
              <i style={{ width: `${realm.promotionPct * 100}%` }} />
            </div>
          </div>
        )}
        <p className="clan-skim">
          {realm.lastSkim ?? realm.skimLine}
        </p>
        <p className="clan-hint">{realm.crownHint}</p>
      </aside>
      )}
      {moment && (
        <div className={`clan-moment ${moment.kind}`} role="status">
          <strong>{moment.title}</strong>
          <span>{moment.detail}</span>
        </div>
      )}
    </>
  );
}
