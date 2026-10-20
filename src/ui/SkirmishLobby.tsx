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
  copied: boolean;
  canStart: boolean;
  onHost: () => void;
  onJoin: () => void;
  onCopy: () => void;
  onStart: () => void;
  onLeave: () => void;
}

function slotStatus(connected: boolean) {
  return connected ? "Connected" : "Waiting";
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
  copied,
  canStart,
  onHost,
  onJoin,
  onCopy,
  onStart,
  onLeave,
}: SkirmishLobbyProps) {
  return (
    <div className="overlay title-overlay skirmish-lobby">
      <h1>Skirmish</h1>
      <p>Two keeps. One invite link.</p>

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
            <span>{slotStatus(hostConnected)}</span>
          </div>
          <div className="slot-row">
            <span>{guestName || "Guest"}</span>
            <span>{slotStatus(guestConnected)}</span>
          </div>
        </div>
      )}

      {role === "host" && invite && (
        <>
          <input className="lobby-field" readOnly value={invite} onFocus={(ev) => ev.currentTarget.select()} />
          <button type="button" className="ghost" onClick={onCopy}>
            {copied ? "Copied" : "Copy invite link"}
          </button>
          <button type="button" className="cta" onClick={onStart} disabled={!canStart}>
            Start
          </button>
        </>
      )}

      {role === "guest" && <p>Waiting for host</p>}

      {status && <p className="lobby-status">{status}</p>}

      <button type="button" className="ghost" onClick={onLeave}>
        Leave lobby
      </button>
    </div>
  );
}
