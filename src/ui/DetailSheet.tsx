import { buildingName } from "../game/sim";
import type { TrainKind, UiSnapshot } from "../game/types";

interface DetailSheetProps {
  ui: UiSnapshot;
  onUpgradeDamage: () => void;
  onUpgradeRate: () => void;
  onRaze: () => void;
  onClose: () => void;
  onEnqueue: (kind: TrainKind) => void;
  onCancelQueue: (index: number) => void;
  onEnqueuePeon: () => void;
  onCallHome: () => void;
  onGarrison: () => void;
  onUngarrison: () => void;
}

function costLabel(gold: number, wood: number) {
  const parts: string[] = [];
  if (gold > 0) parts.push(`${gold}g`);
  if (wood > 0) parts.push(`${wood}w`);
  return parts.join(" · ") || "0";
}

export function DetailSheet({
  ui,
  onUpgradeDamage,
  onUpgradeRate,
  onRaze,
  onClose,
  onEnqueue,
  onCancelQueue,
  onEnqueuePeon,
  onCallHome,
  onGarrison,
  onUngarrison,
}: DetailSheetProps) {
  const keepPanel = ui.selectedKeepTeam === "you";
  if (!keepPanel && (!ui.selectedBuildingId || !ui.selectedBuildingKind)) return null;

  if (keepPanel) {
    const canPay =
      ui.yourGold >= ui.peonTrainCost.gold && ui.yourWood >= ui.peonTrainCost.wood;
    return (
      <div className="detail sheet-float">
        <div className="detail-head">
          <div>
            <div className="detail-title">Your Keep</div>
            <div className="detail-sub">
              Peons {ui.peonCount}/{ui.peonCap} · Garrison {ui.keepGarrisoned}/{ui.keepGarrisonMax}
            </div>
          </div>
          <button type="button" className="ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <p className="detail-note">
          Queue peons here. Cap starts at 2 — build Houses on green pads behind the keep.
        </p>
        <div className="train-options">
          <button
            type="button"
            className="train-opt"
            disabled={!ui.canTrainPeon || !canPay}
            onClick={onEnqueuePeon}
          >
            <strong>Train Peon</strong>
            <small>{ui.canTrainPeon ? "Gather wood & gold" : "Pop cap reached — build a House"}</small>
            <em>{costLabel(ui.peonTrainCost.gold, ui.peonTrainCost.wood)}</em>
          </button>
          <button type="button" className="train-opt" onClick={onCallHome}>
            <strong>Call home</strong>
            <small>Recall peons to the keep</small>
            <em>—</em>
          </button>
          <button
            type="button"
            className="train-opt"
            onClick={onGarrison}
            disabled={ui.keepGarrisoned >= ui.keepGarrisonMax}
          >
            <strong>Garrison peons</strong>
            <small>Up to {ui.keepGarrisonMax}; occupants fire defensive arrows</small>
            <em>🏰</em>
          </button>
          <button
            type="button"
            className="train-opt"
            onClick={onUngarrison}
            disabled={ui.keepGarrisoned === 0}
          >
            <strong>Ungarrison all</strong>
            <small>Return occupants to work</small>
            <em>↗</em>
          </button>
        </div>
        <div className="queue-row">
          <span className="queue-label">Peon queue</span>
          <div className="queue-slots">
            {ui.peonQueue.length === 0 && <span className="queue-empty">Empty</span>}
            {ui.peonQueue.map((slot, i) => (
              <div key={`peon-${i}`} className="queue-chip">
                <i style={{ width: `${Math.round(slot.pct * 100)}%` }} />
                <span>{slot.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const isEnemy = ui.selectedBuildingTeam === "foe";
  const isBarracks = ui.selectedBuildingKind === "barracks";
  const isHouse = ui.selectedBuildingKind === "house";

  return (
    <div className="detail sheet-float">
      <div className="detail-head">
        <div>
          <div className="detail-title">{buildingName(ui.selectedBuildingKind!)}</div>
          <div className="detail-sub">{isEnemy ? "Enemy — inspect only" : "Your structure"}</div>
        </div>
        <button type="button" className="ghost" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      {isHouse && (
        <p className="detail-note">Raises peon population by +3. Eco pad only.</p>
      )}

      {!isBarracks && !isHouse && (
        <>
          <div className="rank-row">
            <span>Damage</span>
            <div className="pips">
              {[1, 2, 3].map((n) => (
                <i key={n} className={(ui.selectedRanks?.damage ?? 1) >= n ? "on" : ""} />
              ))}
            </div>
          </div>
          <div className="rank-row">
            <span>Fire rate</span>
            <div className="pips">
              {[1, 2, 3].map((n) => (
                <i key={n} className={(ui.selectedRanks?.rate ?? 1) >= n ? "on" : ""} />
              ))}
            </div>
          </div>
        </>
      )}

      {isBarracks && !isEnemy && (
        <>
          <p className="detail-note">
            Runners, Archers &amp; Rammers need wood. Archers fire at range but cannot damage barricades.
          </p>

          <div className="train-options">
            {ui.trainOptions.map((opt) => {
              const afford = ui.yourGold >= opt.cost && ui.yourWood >= opt.woodCost;
              return (
                <button
                  key={opt.kind}
                  type="button"
                  className={opt.unlocked ? "train-opt" : "train-opt locked"}
                  disabled={!opt.unlocked || !afford}
                  onClick={() => onEnqueue(opt.kind)}
                  title={opt.unlocked ? opt.blurb : opt.lockHint}
                >
                  <strong>{opt.label}</strong>
                  <small>{opt.unlocked ? opt.blurb : opt.lockHint}</small>
                  <em>{costLabel(opt.cost, opt.woodCost)}</em>
                </button>
              );
            })}
          </div>

          <div className="queue-row">
            <span className="queue-label">Queue</span>
            <div className="queue-slots">
              {ui.trainQueue.length === 0 && <span className="queue-empty">Empty — tap a unit above</span>}
              {ui.trainQueue.map((slot, i) => (
                <button
                  key={`${slot.kind}-${i}`}
                  type="button"
                  className="queue-chip"
                  onClick={() => onCancelQueue(i)}
                  title="Cancel (50% refund)"
                >
                  <i style={{ width: `${Math.round(slot.pct * 100)}%` }} />
                  <span>{slot.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="rank-row">
            <span>Troop power</span>
            <div className="pips">
              {[1, 2, 3].map((n) => (
                <i key={n} className={(ui.selectedRanks?.damage ?? 1) >= n ? "on" : ""} />
              ))}
            </div>
          </div>
          <div className="rank-row">
            <span>Train speed</span>
            <div className="pips">
              {[1, 2, 3].map((n) => (
                <i key={n} className={(ui.selectedRanks?.rate ?? 1) >= n ? "on" : ""} />
              ))}
            </div>
          </div>
        </>
      )}

      {!isEnemy && (
        <div className="detail-actions">
          {!isHouse && (
            <>
              <button type="button" onClick={onUpgradeDamage} disabled={!ui.selectedCanUpgradeDamage}>
                {isBarracks ? "Power" : "Damage"}
                <em>{ui.selectedCanUpgradeDamage ? `${ui.selectedUpgradeCost.damage}g` : "MAX"}</em>
              </button>
              <button type="button" onClick={onUpgradeRate} disabled={!ui.selectedCanUpgradeRate}>
                {isBarracks ? "Speed" : "Rate"}
                <em>{ui.selectedCanUpgradeRate ? `${ui.selectedUpgradeCost.rate}g` : "MAX"}</em>
              </button>
            </>
          )}
          <button type="button" className="danger-btn" onClick={onRaze} disabled={!ui.selectedCanRaze}>
            Raze
            <em>
              {ui.selectedRazeRefund > 0 || ui.selectedRazeRefundWood > 0
                ? `+${ui.selectedRazeRefund}g +${ui.selectedRazeRefundWood}w`
                : "0"}
            </em>
          </button>
        </div>
      )}
    </div>
  );
}
