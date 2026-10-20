import Peer, { type DataConnection, type PeerError } from "peerjs";
import { createRoomId, asNetMsg, splitWire, WireReassembly, type NetMsg } from "./protocol";

const ICE: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

const HOST_WAIT =
  "No one has connected after 15 seconds. Check that your friend opened the invite link. A direct connection can also be blocked by the network.";
const GUEST_WAIT =
  "Could not connect after 15 seconds. Check the invite link. If it is right, this network is blocking a direct connection.";
const DIRECT_FAIL =
  "No direct path between these two networks. Roadkeep does not use a relay, so the match cannot connect.";

export interface SkirmishEvents {
  onReady: (id: string) => void;
  onConnected: () => void;
  onMessage: (msg: NetMsg) => void;
  onStatus: (text: string) => void;
  onDirectFail: (text: string) => void;
  onDown: (text: string) => void;
  onReject: () => void;
}

export class SkirmishLink {
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private role: "host" | "guest" = "host";
  private opened = false;
  private iceOk = false;
  private closed = false;
  private retriedId = false;
  private waitTimer = 0;
  private pingTimer = 0;
  private pingN = 0;
  private partId = 1;
  private parts = new WireReassembly();
  private rejected = false;

  constructor(private events: SkirmishEvents) {}

  host(roomId: string) {
    this.role = "host";
    this.retriedId = false;
    const peer = this.makePeer(roomId);
    peer.on("open", (id) => {
      if (this.closed) return;
      this.events.onReady(id);
      this.armTimeout(HOST_WAIT);
    });
    peer.on("connection", (conn) => this.accept(conn));
  }

  join(roomId: string) {
    this.role = "guest";
    const peer = this.makePeer();
    peer.on("open", () => {
      if (this.closed) return;
      const conn = peer.connect(roomId, { reliable: true, serialization: "json" });
      this.bind(conn);
      this.armTimeout(GUEST_WAIT);
    });
  }

  send(msg: NetMsg) {
    const conn = this.conn;
    if (!conn?.open) return;
    let pieces: NetMsg[];
    try {
      pieces = splitWire(msg, this.partId);
      this.partId += 1;
    } catch {
      this.rejectOnce();
      return;
    }
    if (pieces.length === 0) {
      this.rejectOnce();
      return;
    }
    for (const piece of pieces) {
      try {
        conn.send(piece);
      } catch {
        /* channel is closing */
        return;
      }
    }
  }

  close() {
    this.closed = true;
    this.clearTimers();
    try {
      this.conn?.close();
    } catch {
      /* already gone */
    }
    try {
      this.peer?.destroy();
    } catch {
      /* already gone */
    }
    this.conn = null;
    this.peer = null;
  }

  private makePeer(id?: string) {
    this.clearTimers();
    try {
      this.peer?.destroy();
    } catch {
      /* replacing a failed peer */
    }
    const peer = id
      ? new Peer(id, {
          host: "0.peerjs.com",
          port: 443,
          path: "/",
          secure: true,
          debug: 0,
          config: ICE,
        })
      : new Peer({
          host: "0.peerjs.com",
          port: 443,
          path: "/",
          secure: true,
          debug: 0,
          config: ICE,
        });
    this.peer = peer;
    this.closed = false;
    peer.on("error", (err) => this.onPeerError(err));
    return peer;
  }

  private accept(conn: DataConnection) {
    if (this.conn && (this.conn.open || this.opened)) {
      conn.on("open", () => {
        try {
          conn.send({ t: "full" });
        } catch {
          /* ignore */
        }
        conn.close();
      });
      return;
    }
    this.bind(conn);
  }

  private bind(conn: DataConnection) {
    this.conn = conn;
    this.opened = false;
    this.iceOk = false;
    conn.on("open", () => {
      if (this.closed || this.conn !== conn) return;
      this.opened = true;
      window.clearTimeout(this.waitTimer);
      this.waitTimer = 0;
      this.events.onConnected();
      this.pingTimer = window.setInterval(() => this.ping(), 2000);
    });
    conn.on("data", (data) => {
      const msg = asNetMsg(data);
      if (!msg) {
        const kind = data && typeof data === "object" ? (data as { t?: unknown }).t : undefined;
        if (kind === "snap" || kind === "part") this.rejectOnce();
        return;
      }
      if (msg.t === "part") {
        const done = this.parts.take(msg);
        if (done === "bad") this.rejectOnce();
        else if (done) this.dispatch(done);
        return;
      }
      this.dispatch(msg);
    });
    conn.on("iceStateChanged", (state) => {
      if (state === "connected" || state === "completed") this.iceOk = true;
      if (state === "failed" && !this.iceOk) this.events.onDirectFail(DIRECT_FAIL);
    });
    conn.on("error", (err) => {
      const kind = (err as { type?: string } | undefined)?.type;
      if (kind === "message-too-big") {
        this.rejectOnce();
        return;
      }
      if (!this.iceOk && !this.opened) this.events.onDirectFail(DIRECT_FAIL);
    });
    conn.on("close", () => {
      if (this.closed || this.conn !== conn) return;
      this.clearTimers();
      if (!this.opened) return;
      this.events.onDown("Opponent disconnected.");
    });
  }

  private dispatch(msg: NetMsg) {
    if (msg.t === "part") return;
    if (msg.t === "ping") {
      this.send({ t: "pong", n: msg.n, at: msg.at });
      return;
    }
    if (msg.t === "pong") {
      this.events.onMessage(msg);
      return;
    }
    if (msg.t === "full") {
      this.events.onStatus("This match already has two players.");
      return;
    }
    this.events.onMessage(msg);
  }

  private rejectOnce() {
    if (this.rejected) return;
    this.rejected = true;
    this.events.onReject();
  }

  private ping() {
    this.pingN += 1;
    this.send({ t: "ping", n: this.pingN, at: Date.now() });
  }

  private onPeerError(err: PeerError<string>) {
    if (this.closed) return;
    if (err.type === "unavailable-id" && this.role === "host" && !this.retriedId) {
      this.retriedId = true;
      this.host(createRoomId());
      return;
    }
    if (err.type === "peer-unavailable") {
      this.events.onStatus("That match is not open. Ask the host for a new invite.");
      return;
    }
    if (err.type === "network" || err.type === "server-error" || err.type === "socket-error" || err.type === "disconnected") {
      this.events.onStatus("The match broker did not answer. Try again in a moment.");
      return;
    }
    if (err.type === "webrtc" || err.type === "browser-incompatible") {
      this.events.onDirectFail(
        err.type === "browser-incompatible"
          ? "This browser cannot open a direct match."
          : DIRECT_FAIL,
      );
      return;
    }
    this.events.onStatus("Could not open the match connection.");
  }

  private armTimeout(message: string) {
    window.clearTimeout(this.waitTimer);
    this.waitTimer = window.setTimeout(() => {
      if (this.closed || this.opened) return;
      this.events.onStatus(message);
    }, 15000);
  }

  private clearTimers() {
    window.clearTimeout(this.waitTimer);
    window.clearInterval(this.pingTimer);
    this.waitTimer = 0;
    this.pingTimer = 0;
  }
}
