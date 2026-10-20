import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { GameRenderer } from "../game/render3d";
import type { GameSim } from "../game/sim";
import { createRoomId, inviteLink, parseRoomInput, type NetMsg } from "./protocol";
import { SkirmishLink } from "./skirmish";

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
  link: "off" | "connecting" | "open" | "failed" | "down";
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
  link: "off",
});

export function useSkirmish(sim: GameSim, rendererRef: RefObject<GameRenderer | null>) {
  const [name, setNameState] = useState(loadName);
  const [lobby, setLobby] = useState<LobbyState>(idleLobby);
  const nameRef = useRef(name);
  nameRef.current = name;
  const roleRef = useRef<"solo" | "host" | "guest">("solo");
  const liveRef = useRef(false);
  const linkRef = useRef<SkirmishLink | null>(null);
  const lobbyRef = useRef(lobby);
  lobbyRef.current = lobby;
  const pictureWarned = useRef(false);

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
      if (msg.t === "pong") {
        const ms = Math.max(0, Date.now() - msg.at);
        setLobby((s) => ({ ...s, pingMs: ms }));
      }
    },
    [beginGuest, sim, warnPicture],
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
            hostConnected: true,
            status: "Send the invite link. Start stays locked until your friend connects.",
          }));
        },
        onConnected: () => {
          link.send({ t: "hello", name: nameRef.current.trim() || "Player" });
          setLobby((s) => {
            if (s.role === "host") {
              return { ...s, guestConnected: true, link: "open", status: "Friend connected. Press Start when you are ready." };
            }
            return {
              ...s,
              hostConnected: true,
              guestConnected: true,
              link: "open",
              status: "",
            };
          });
        },
        onMessage,
        onStatus: (text) => setLobby((s) => ({ ...s, status: text })),
        onDirectFail: (text) => setLobby((s) => ({ ...s, status: text, link: "failed" })),
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
      status: "Opening a match…",
      joinDraft: "",
      copied: false,
      pingMs: null,
      link: "connecting",
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
        status: "Joining…",
        joinDraft: roomId,
        copied: false,
        pingMs: null,
        link: "connecting",
      });
      openLink("guest", roomId);
    },
    [openLink],
  );

  const startSkirmish = useCallback(() => {
    if (roleRef.current !== "host" || !lobbyRef.current.guestConnected) return;
    sim.setMatchMode("pvp");
    sim.setLocalTeam("you");
    sim.setOrderSink(null);
    sim.setRemoteNote((text) => linkRef.current?.send({ t: "note", text }));
    sim.startMatch();
    const map = sim.getActiveMap();
    linkRef.current?.send({ t: "start", map });
    linkRef.current?.send({ t: "snap", snap: sim.exportSnapshot() });
    liveRef.current = true;
    rendererRef.current?.setHomeSide("you");
    setLobby((s) => ({ ...s, open: false, live: true, link: "open", status: "" }));
  }, [rendererRef, sim]);

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
    roleRef,
    liveRef,
    linkRef,
    openLobby,
    setJoinDraft,
    hostMatch,
    joinMatch,
    startSkirmish,
    copyInvite,
    leave,
  };
}
