import { useEffect, useRef, useState } from "react";
import { CHAT_EMOTES, CHAT_MAX_LEN, type ChatLine } from "../net/chat";
import type { Team } from "../game/types";

interface ChatLogProps {
  lines: ChatLine[];
  localTeam: Team;
}

/** Message feed for the right-side panel (middle of the command rail). */
export function ChatLog({ lines, localTeam }: ChatLogProps) {
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines]);

  const recent = lines.slice(-10);
  if (recent.length === 0) {
    return (
      <div className="chat-rail" aria-label="Match chat">
        <p className="chat-empty">Chat</p>
      </div>
    );
  }

  return (
    <div className="chat-rail" role="log" aria-label="Match chat">
      <div className="chat-log" ref={logRef}>
        {recent.map((line) => (
          <div
            key={line.id}
            className={`chat-line${line.team === localTeam ? " ally" : " foe"}${line.emote ? " emote" : ""}`}
          >
            <span className="chat-name">{line.name}</span>
            <span className="chat-text">{line.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface ChatControlsProps {
  onSend: (text: string) => void;
  onEmote: (emoteId: string) => void;
  /** Focus the type field when Commands opens. */
  active?: boolean;
}

/** Quick emotes + type field — lives inside the Commands banner stack. */
export function ChatControls({ onSend, onEmote, active }: ChatControlsProps) {
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (active && typing) inputRef.current?.focus();
  }, [active, typing]);

  useEffect(() => {
    if (!active) {
      setTyping(false);
      setDraft("");
    }
  }, [active]);

  const submit = () => {
    const text = draft.trim();
    if (!text) {
      setTyping(false);
      return;
    }
    onSend(text.slice(0, CHAT_MAX_LEN));
    setDraft("");
    setTyping(false);
  };

  return (
    <div className="chat-commands" onPointerDown={(ev) => ev.stopPropagation()}>
      <div className="chat-emotes" role="group" aria-label="Quick chat">
        {CHAT_EMOTES.map((e) => (
          <button key={e.id} type="button" className="chat-emote" onClick={() => onEmote(e.id)} title={e.text}>
            {e.label}
          </button>
        ))}
        <button
          type="button"
          className={`chat-emote chat-type${typing ? " on" : ""}`}
          onClick={() => setTyping((v) => !v)}
          title="Type a message"
          aria-pressed={typing}
        >
          …
        </button>
      </div>
      {typing && (
        <form
          className="chat-compose"
          onSubmit={(ev) => {
            ev.preventDefault();
            submit();
          }}
        >
          <input
            ref={inputRef}
            value={draft}
            maxLength={CHAT_MAX_LEN}
            placeholder="Say something…"
            onChange={(ev) => setDraft(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === "Escape") {
                ev.stopPropagation();
                setTyping(false);
                setDraft("");
              }
            }}
            aria-label="Chat message"
          />
          <button type="submit" className="chat-send">
            Send
          </button>
        </form>
      )}
    </div>
  );
}
