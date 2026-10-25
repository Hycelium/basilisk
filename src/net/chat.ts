import type { Team } from "../game/types";

export const CHAT_MAX_LEN = 80;
export const CHAT_LOG_CAP = 40;

export const CHAT_EMOTES = [
  { id: "yes", label: "Yes", text: "Yes!" },
  { id: "no", label: "No", text: "No." },
  { id: "attack", label: "Attack", text: "Attack!" },
  { id: "defend", label: "Hold", text: "Hold the line!" },
  { id: "help", label: "Help", text: "Need help!" },
  { id: "gg", label: "GG", text: "GG" },
] as const;

export type ChatEmoteId = (typeof CHAT_EMOTES)[number]["id"];

export interface ChatLine {
  id: number;
  playerId: string;
  name: string;
  team: Team;
  text: string;
  emote?: string;
  at: number;
}

export function emoteById(id: string) {
  return CHAT_EMOTES.find((e) => e.id === id) ?? null;
}

export function sanitizeChatText(raw: string) {
  return raw.replace(/\s+/g, " ").trim().slice(0, CHAT_MAX_LEN);
}

export function pushChatLine(lines: ChatLine[], line: Omit<ChatLine, "id">, nextId: number): ChatLine[] {
  const next = [...lines, { ...line, id: nextId }];
  return next.length > CHAT_LOG_CAP ? next.slice(next.length - CHAT_LOG_CAP) : next;
}
