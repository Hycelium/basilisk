import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { basiliskMap } from "../game/basiliskMap";
import { skirmishMap } from "../game/map";
import type { GameRenderer } from "../game/render3d";
import type { GameSim } from "../game/sim";
import { createRoomId, inviteLink, parseRoomInput, type NetMsg } from "./protocol";
import { emoteById, pushChatLine, sanitizeChatText, type ChatLine } from "./chat";
import { RELAY_STATUS } from "./ice";
import { ROOM_OPEN_STATUS, SkirmishLink } from "./skirmish";
import type { Team } from "../game/types";

const DEFAULT_MAP = basiliskMap().id;

const NAME_KEY = "roadkeep_name";
const PICTURE_REJECTED = "The match picture was rejected.";

export interface LobbyState {
  open: boolean;
  role: "idle" | "host" | "guest";
  live: boolean;
  roomId: string;
  invite: string;
  hostName: string;
  guestName: string;
  hostConnected: boolean;
  guestConnected: boolean;
  status: string;
  joinDraft: string;
  copied: boolean;
  pingMs: number | null;
  path: string;
  link: "off" | "connecting" | "open" | "failed" | "down";
  /** Map the host has chosen for the next rematch. */
  selectedMapId: string;
}

function loadName() {
  try {
    const saved = localStorage.getItem(NAME_KEY)?.trim();
    if (saved) return saved.slice(0, 24);
  } catch {
    /* private mode */
  }
  return "Player";
}

function saveName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name.trim() || "Player");
  } catch {
    /* private mode */
  }
}

const idleLobby = (): LobbyState => ({
  open: false,
  role: "idle",
  live: false,
  roomId: "",
  invite: "",
  hostName: "",
  guestName: "",
  hostConnected: false,
  guestConnected: false,
  status: "",
  joinDraft: "",
  copied: false,
  pingMs: null,
  path: "",
  link: "off",
  selectedMapId: DEFAULT_MAP,
});

export function useSkirmish(sim: GameSim, rendererRef: RefObject<GameRenderer | null>) {
  const [name, setNameState] = useState(loadName);
  const [lobby, setLobby] = useState<LobbyState>(idleLobby);
  const [chatLines, setChatLines] = useState<ChatLine[]>([]);
  const nameRef = useRef(name);
  nameRef.current = name;
  const roleRef = useRef<"solo" | "host" | "guest">("solo");
  const liveRef = useRef(false);
  const linkRef = useRef<SkirmishLink | null>(null);
  const lobbyRef = useRef(lobby);
  lobbyRef.current = lobby;
  const pictureWarned = useRef(false);
  const chatIdRef = useRef(1);

  const setName = useCallback((value: string) => {
    const next = value.slice(0, 24);
    setNameState(next);
    saveName(next);
    if (linkRef.current && lobbyRef.current.link === "open") {
      linkRef.current.send({ t: "hello", name: next.trim() || "Player" });
    }
  }, []);

  const leave = useCallback(() => {
    linkRef.current?.close();
    linkRef.current = null;
    roleRef.current = "solo";
    liveRef.current = false;
    pictureWarned.current = false;
    sim.setOrderSink(null);
    sim.setRemoteNote(null);
    sim.setLinkDown(false);
    sim.setMatchMode("ai");
    sim.setLocalTeam("you");
    sim.reset();
    rendererRef.current?.setHomeSide("you");
    setChatLines([]);
    setLobby(idleLobby());
    const url = new URL(window.location.href);
    if (url.searchParams.has("room")) {
      url.searchParams.delete("room");
      const next = url.pathname + url.search + url.hash;
      window.history.replaceState({}, "", next);
    }
  }, [rendererRef, sim]);

  const beginGuest = useCallback(
    (map: Parameters<GameSim["adoptMap"]>[0]) => {
      sim.setMatchMode("pvp");
      sim.setLocalTeam("foe");
      sim.setRemoteNote(null);
      sim.setOrderSink((order) => linkRef.current?.send({ t: "order", order }));
      sim.adoptMap(map);
      sim.getState().phase = "running";
      sim.getState().paused = false;
      sim.getState().units = [];
      sim.getState().buildings = [];
      sim.getState().villagers = [];
      liveRef.current = true;
      roleRef.current = "guest";
      rendererRef.current?.setHomeSide("foe");
      setLobby((s) => ({ ...s, open: false, live: true, link: "open", status: "" }));
    },
    [rendererRef, sim],
  );

  const warnPicture = useCallback(() => {
    if (pictureWarned.current) return;
    pictureWarned.current = true;
    sim.pushToast(PICTURE_REJECTED);
    if (roleRef.current === "host") linkRef.current?.send({ t: "note", text: PICTURE_REJECTED });
  }, [sim]);

  const onMessage = useCallback(
    (msg: NetMsg) => {
      if (msg.t === "hello") {
        const who = msg.name.trim().slice(0, 24) || "Player";
        setLobby((s) =>
          s.role === "host" ? { ...s, guestName: who, guestConnected: true } : { ...s, hostName: who, hostConnected: true },
        );
        return;
      }
      if (msg.t === "start") {
        beginGuest(msg.map);
        return;
      }
      if (msg.t === "pick") {
        if (roleRef.current !== "guest" || (msg.mapId !== basiliskMap().id && !skirmishMap(msg.mapId))) return;
        setLobby((s) => ({ ...s, selectedMapId: msg.mapId }));
        return;
      }
      if (msg.t === "rematch") {
        if (roleRef.current !== "guest" || lobbyRef.current.link !== "open") return;
        if (!sim.applyRematch(msg.mapId, "guest")) return;
        rendererRef.current?.setHomeSide("foe");
        setChatLines([]);
        setLobby((s) => ({ ...s, selectedMapId: msg.mapId, live: true, open: false, link: "open" }));
        return;
      }
      if (msg.t === "order") {
        sim.applyRemoteOrder(msg.order);
        return;
      }
      if (msg.t === "snap") {
        if (!sim.applySnapshot(msg.snap)) warnPicture();
        return;
      }
      if (msg.t === "note") {
        if (msg.text === PICTURE_REJECTED) warnPicture();
        else sim.pushToast(msg.text);
        return;
      }
      if (msg.t === "chat") {
        const text = sanitizeChatText(msg.text);
        if (!text) return;
        if (roleRef.current === "host") linkRef.current?.send(msg);
        const localId = roleRef.current === "host" ? "host" : "guest";
        if (msg.playerId === localId) return;
        const id = chatIdRef.current++;
        setChatLines((lines) =>
          pushChatLine(
            lines,
            {
              playerId: msg.playerId,
              name: msg.name.trim().slice(0, 24) || "Player",
              team: msg.team,
              text,
              emote: msg.emote,
              at: Date.now(),
            },
            id,
          ),
        );
        return;
      }
      if (msg.t === "pong") {
        const ms = Math.max(0, Date.now() - msg.at);
        setLobby((s) => ({ ...s, pingMs: ms }));
      }
    },
    [beginGuest, sim, warnPicture],
  );

  const sendChatPayload = useCallback((text: string, emote?: string) => {
    const cleaned = sanitizeChatText(text);
    if (!cleaned || !liveRef.current || lobbyRef.current.link !== "open") return;
    const role = roleRef.current;
    if (role !== "host" && role !== "guest") return;
    const playerId = role;
    const team: Team = role === "host" ? "you" : "foe";
    const who = nameRef.current.trim().slice(0, 24) || "Player";
    const msg: NetMsg = { t: "chat", playerId, name: who, team, text: cleaned, emote };
    const id = chatIdRef.current++;
    setChatLines((lines) =>
      pushChatLine(lines, { playerId, name: who, team, text: cleaned, emote, at: Date.now() }, id),
    );
    linkRef.current?.send(msg);
  }, []);

  const sendChat = useCallback(
    (text: string) => {
      sendChatPayload(text);
    },
    [sendChatPayload],
  );

  const sendEmote = useCallback(
    (emoteId: string) => {
      const emote = emoteById(emoteId);
      if (!emote) return;
      sendChatPayload(emote.text, emote.id);
    },
    [sendChatPayload],
  );

  const openLink = useCallback(
    (role: "host" | "guest", roomId: string) => {
      linkRef.current?.close();
      pictureWarned.current = false;
      const link = new SkirmishLink({
        onReady: (id) => {
          setLobby((s) => ({
            ...s,
            roomId: id,
            invite: inviteLink(id),
            status:
              s.status === RELAY_STATUS || s.status === ROOM_OPEN_STATUS || s.status.startsWith("Reopening")
                ? s.status
                : "Connecting",
          }));
        },
        onConnected: () => {
          link.send({ t: "hello", name: nameRef.current.trim() || "Player" });
          setLobby((s) => ({
            ...s,
            hostConnected: true,
            guestConnected: true,
            link: "open",
            status: "Connected",
          }));
        },
        onMessage,
        onStatus: (text) => setLobby((s) => ({ ...s, status: text })),
        onDirectFail: (text) => setLobby((s) => ({ ...s, status: text, link: "failed" })),
        onPath: (kind) => {
          setLobby((s) => ({
            ...s,
            path: kind,
            status: s.live ? s.status : `Connected · ${kind}`,
          }));
        },
        onReject: warnPicture,
        onDown: (text) => {
          const wasLive = liveRef.current;
          if (wasLive) sim.setLinkDown(true);
          setLobby((s) => ({
            ...s,
            link: "down",
            guestConnected: s.role === "host" ? false : s.guestConnected,
            hostConnected: s.role === "guest" ? false : s.hostConnected,
            status: wasLive ? "Opponent disconnected." : text,
          }));
        },
      });
      linkRef.current = link;
      if (role === "host") link.host(roomId);
      else link.join(roomId);
    },
    [onMessage, sim, warnPicture],
  );

  const hostMatch = useCallback(() => {
    const id = createRoomId();
    const self = nameRef.current.trim() || "Player";
    roleRef.current = "host";
    liveRef.current = false;
    setLobby({
      open: true,
      role: "host",
      live: false,
      roomId: id,
      invite: "",
      hostName: self,
      guestName: "",
      hostConnected: false,
      guestConnected: false,
      status: "Connecting",
      joinDraft: "",
      copied: false,
      pingMs: null,
      path: "",
      link: "connecting",
      selectedMapId: DEFAULT_MAP,
    });
    openLink("host", id);
  }, [openLink]);

  const joinMatch = useCallback(
    (raw?: string) => {
      const roomId = parseRoomInput(raw ?? lobbyRef.current.joinDraft);
      if (!roomId) {
        setLobby((s) => ({ ...s, open: true, status: "Paste an invite link or code first." }));
        return;
      }
      const self = nameRef.current.trim() || "Player";
      roleRef.current = "guest";
      liveRef.current = false;
      setLobby({
        open: true,
        role: "guest",
        live: false,
        roomId,
        invite: "",
        hostName: "",
        guestName: self,
        hostConnected: false,
        guestConnected: false,
        status: "Connecting",
        joinDraft: roomId,
        copied: false,
        pingMs: null,
        path: "",
        link: "connecting",
        selectedMapId: DEFAULT_MAP,
      });
      openLink("guest", roomId);
    },
    [openLink],
  );

  const announceMap = useCallback(() => {
    if (roleRef.current !== "host" || lobbyRef.current.link !== "open") return;
    const mapId = lobbyRef.current.selectedMapId;
    if (mapId !== basiliskMap().id && !skirmishMap(mapId)) return;
    linkRef.current?.send({ t: "pick", mapId });
  }, []);

  const pickMap = useCallback((mapId: string) => {
    if (roleRef.current !== "host" || (mapId !== basiliskMap().id && !skirmishMap(mapId))) return;
    setLobby((s) => ({ ...s, selectedMapId: mapId }));
    if (lobbyRef.current.link === "open") linkRef.current?.send({ t: "pick", mapId });
  }, []);

  const rematch = useCallback(() => {
    if (roleRef.current !== "host" || !liveRef.current || lobbyRef.current.link !== "open") return;
    const mapId = basiliskMap().id;
    if (!sim.applyRematch(mapId, "host")) return;
    setChatLines([]);
    linkRef.current?.send({ t: "rematch", mapId });
    linkRef.current?.send({ t: "snap", snap: sim.exportSnapshot() });
    rendererRef.current?.setHomeSide("you");
  }, [rendererRef, sim]);

  const startSkirmish = useCallback(() => {
    if (roleRef.current !== "host" || !lobbyRef.current.guestConnected) return;
    sim.setMatchMode("pvp");
    sim.setLocalTeam("you");
    sim.setOrderSink(null);
    sim.setRemoteNote((text) => linkRef.current?.send({ t: "note", text }));
    sim.startBasilisk("you", "pvp");
    const map = sim.getActiveMap();
    linkRef.current?.send({ t: "start", map });
    linkRef.current?.send({ t: "snap", snap: sim.exportSnapshot() });
    liveRef.current = true;
    rendererRef.current?.setHomeSide("you");
    setChatLines([]);
    setLobby((s) => ({ ...s, open: false, live: true, link: "open", status: "" }));
  }, [rendererRef, sim]);

  const shareInvite = useCallback(async () => {
    const invite = lobbyRef.current.invite;
    if (!invite || !navigator.share) return;
    try {
      await navigator.share({ title: "Basilisk", text: "Join my Basilisk match", url: invite });
    } catch {
      /* the share sheet was dismissed */
    }
  }, []);

  const copyInvite = useCallback(async () => {
    const invite = lobbyRef.current.invite;
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite);
    } catch {
      /* the field stays selectable */
    }
    setLobby((s) => ({ ...s, copied: true }));
  }, []);

  const openLobby = useCallback(() => {
    setLobby((s) => ({ ...idleLobby(), open: true, joinDraft: s.joinDraft }));
  }, []);

  const setJoinDraft = useCallback((joinDraft: string) => {
    setLobby((s) => ({ ...s, open: true, joinDraft }));
  }, []);

  useEffect(() => {
    if (!lobby.open) return;
    let released = false;
    let sentinel: WakeLockSentinel | null = null;
    const hold = () => {
      const locks = navigator.wakeLock;
      if (!locks || sentinel || released) return;
      void locks
        .request("screen")
        .then((lock) => {
          if (released) void lock.release();
          else sentinel = lock;
        })
        .catch(() => {
          /* the browser refused the lock */
        });
    };
    hold();
    const onVis = () => {
      if (document.visibilityState !== "visible") {
        sentinel = null;
        return;
      }
      hold();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      released = true;
      document.removeEventListener("visibilitychange", onVis);
      void sentinel?.release();
    };
  }, [lobby.open]);

  useEffect(() => {
    const room = new URLSearchParams(window.location.search).get("room");
    if (room) joinMatch(room);
    return () => {
      linkRef.current?.close();
      linkRef.current = null;
    };
    // Join the invite once. StrictMode's remount closes the first peer and opens another.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    name,
    setName,
    lobby,
    chatLines,
    sendChat,
    sendEmote,
    roleRef,
    liveRef,
    linkRef,
    openLobby,
    setJoinDraft,
    hostMatch,
    joinMatch,
    startSkirmish,
    announceMap,
    pickMap,
    rematch,
    shareInvite,
    copyInvite,
    leave,
  };
}
