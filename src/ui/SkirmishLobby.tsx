interface SkirmishEndProps {
  result: string;
  role: "host" | "guest" | "idle";
  maps: { id: string; name: string; tagline: string; lanes: number }[];
  mapId: string;
  linkDown: boolean;
  canRematch: boolean;
  onPick: (mapId: string) => void;
  onRematch: () => void;
  onLeave: () => void;
}

function roadsLabel(lanes: number) {
  return lanes === 1 ? "1 road" : `${lanes} roads`;
}

export function SkirmishEnd({
  result,
  role,
  maps,
  mapId,
  linkDown,
  canRematch,
  onPick,
  onRematch,
  onLeave,
}: SkirmishEndProps) {
  const selected = maps.find((map) => map.id === mapId) ?? maps[0];
  return (
    <div className="skirmish-end" role="dialog" aria-label="Match over">
      <h2>{result}</h2>
      {role === "host" && maps.length > 1 && (
        <div className="map-picks" role="listbox" aria-label="Rematch map">
          {maps.map((map) => (
            <button
              key={map.id}
              type="button"
              role="option"
              aria-selected={map.id === selected?.id}
              onClick={() => onPick(map.id)}
            >
              {map.name} · {roadsLabel(map.lanes)}
            </button>
          ))}
        </div>
      )}
      {role !== "host" &&
        (linkDown ? (
          <p className="skirmish-end-down">Opponent disconnected.</p>
        ) : (
          <p>Waiting for host</p>
        ))}
      {selected && role === "host" && <p className="skirmish-end-map">{selected.tagline}</p>}
      {selected && role !== "host" && (
        <p className="skirmish-end-map">
          {selected.name} · {roadsLabel(selected.lanes)}
          <span>{selected.tagline}</span>
        </p>
      )}
      {role === "host" && linkDown && <p className="skirmish-end-down">Opponent disconnected.</p>}
      {role === "host" && (
        <button type="button" className="cta" onClick={onRematch} disabled={!canRematch}>
          Rematch
        </button>
      )}
      <button type="button" className="ghost" onClick={onLeave}>
        Leave match
      </button>
    </div>
  );
}

interface SkirmishLobbyProps {
  name: string;
  onName: (name: string) => void;
  role: "idle" | "host" | "guest";
  hostName: string;
  guestName: string;
  hostConnected: boolean;
  guestConnected: boolean;
  invite: string;
  joinDraft: string;
  onJoinDraft: (value: string) => void;
  status: string;
  link: "off" | "connecting" | "open" | "failed" | "down";
  copied: boolean;
  canStart: boolean;
  onHost: () => void;
  onJoin: () => void;
  onCopy: () => void;
  onShare: () => void;
  onStart: () => void;
  onLeave: () => void;
}

function slotStatus(connected: boolean, connecting: boolean) {
  if (connected) return "Connected";
  if (connecting) return "Connecting";
  return "Waiting";
}

export function SkirmishLobby({
  name,
  onName,
  role,
  hostName,
  guestName,
  hostConnected,
  guestConnected,
  invite,
  joinDraft,
  onJoinDraft,
  status,
  link,
  copied,
  canStart,
  onHost,
  onJoin,
  onCopy,
  onShare,
  onStart,
  onLeave,
}: SkirmishLobbyProps) {
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  return (
    <div className="overlay title-overlay skirmish-lobby">
      <h1>Skirmish</h1>
      <p>Two keeps on Twin Valleys. Walk a peon, take the crown. One invite link.</p>

      <label className="lobby-label">
        Your name
        <input
          className="lobby-field"
          value={name}
          maxLength={24}
          autoComplete="nickname"
          onChange={(ev) => onName(ev.target.value)}
        />
      </label>

      {role === "idle" && (
        <>
          <button type="button" className="cta" onClick={onHost}>
            Host match
          </button>
          <label className="lobby-label">
            Invite code or link
            <input
              className="lobby-field"
              value={joinDraft}
              placeholder="Paste a link or code"
              onChange={(ev) => onJoinDraft(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter") onJoin();
              }}
            />
          </label>
          <button type="button" className="ghost" onClick={onJoin} disabled={!joinDraft.trim()}>
            Join
          </button>
        </>
      )}

      {role !== "idle" && (
        <div className="lobby-slots">
          <div className="slot-row">
            <span>{hostName || "Host"}</span>
            <span>{slotStatus(hostConnected, link === "connecting" && role === "host")}</span>
          </div>
          <div className="slot-row">
            <span>{guestName || "Guest"}</span>
            <span>{slotStatus(guestConnected, link === "connecting" && role === "guest")}</span>
          </div>
        </div>
      )}

      {role === "host" && invite && (
        <>
          {!guestConnected && (
            <p className="lobby-stay">
              Share opens Messages without leaving the lobby. Send the link, then come back — they should open it once
              you are back on Basilisk.
            </p>
          )}
          <input className="lobby-field" readOnly value={invite} onFocus={(ev) => ev.currentTarget.select()} />
          {canShare && (
            <button type="button" className="cta" onClick={onShare}>
              Share via Messages
            </button>
          )}
          <button type="button" className="ghost" onClick={onCopy}>
            {copied ? "Copied" : "Copy invite link"}
          </button>
          <button type="button" className="cta" onClick={onStart} disabled={!canStart}>
            Start
          </button>
        </>
      )}

      {role === "guest" && link === "open" && <p>Waiting for host</p>}

      {status && <p className="lobby-status">{status}</p>}

      <button type="button" className="ghost" onClick={onLeave}>
        Leave lobby
      </button>
    </div>
  );
}
