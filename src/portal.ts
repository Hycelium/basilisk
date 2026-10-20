/**
 * Web-portal hooks. The normal site, itch embeds, and Discord invite links
 * do not set ?portal=, so they stay ad-free and never load a portal SDK.
 * A failed SDK must not block play.
 */

const POKI_SRC = "https://game-cdn.poki.com/scripts/v2/poki-sdk.js";
const CRAZY_SRC = "https://sdk.crazygames.com/crazygames-sdk-v3.js";
const AD_WAIT_MS = 60_000;

type PortalId = "poki" | "crazygames";
type PortalEvent = "start" | "stop" | "break";

interface PokiSDKApi {
  init: () => Promise<void>;
  gameLoadingFinished: () => void;
  gameplayStart: () => void;
  gameplayStop: () => void;
  commercialBreak: (onStart?: () => void) => Promise<void>;
}

interface CrazyAdCallbacks {
  adStarted?: () => void;
  adFinished?: () => void;
  adError?: (error: unknown) => void;
}

interface CrazyGamesSDK {
  init: () => Promise<void>;
  game: {
    gameplayStart: () => void;
    gameplayStop: () => void;
  };
  ad: {
    requestAd: (type: "midgame" | "rewarded", callbacks?: CrazyAdCallbacks) => unknown;
  };
}

declare global {
  interface Window {
    PokiSDK?: PokiSDKApi;
    CrazyGames?: { SDK: CrazyGamesSDK };
  }
}

interface AudioGate {
  mute: () => void;
  restore: () => void;
}

let portal: PortalId | null = null;
let ready = false;
let failed = false;
let playing = false;
let audioGate: AudioGate | null = null;
let breakTask: Promise<void> = Promise.resolve();
const pending: PortalEvent[] = [];

export function bindPortalAudio(gate: AudioGate) {
  audioGate = gate;
}

export function bootPortal() {
  if (portal || failed) return;
  portal = portalFromLocation();
  if (!portal) return;
  void activate(portal);
}

export function onMatchStart() {
  if (!portal || failed || playing) return;
  playing = true;
  enqueue("start");
}

export function onReturnToTitle() {
  if (!portal || failed || !playing) return;
  playing = false;
  enqueue("stop");
}

/** Victory or defeat has returned to the menu. Ads stay between matches. */
export function onMatchEndToMenu() {
  if (!portal || failed) return;
  if (playing) {
    playing = false;
    enqueue("stop");
  }
  enqueue("break");
}

/** Runs immediately when no portal ad is in flight, so direct play is unchanged. */
export function afterPortalBreak(run: () => void) {
  if (!portal || failed) {
    run();
    return;
  }
  void withTimeout(breakTask, AD_WAIT_MS).then(run);
}

function portalFromLocation(): PortalId | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("portal");
  if (value === "poki" || value === "crazygames") return value;
  return null;
}

async function activate(kind: PortalId) {
  try {
    if (kind === "poki") {
      await loadScript(POKI_SRC);
      const sdk = window.PokiSDK;
      if (!sdk) throw new Error("sdk");
      await sdk.init();
      try {
        sdk.gameLoadingFinished();
      } catch {
        /* loading signal is optional if the SDK build lacks it */
      }
    } else {
      await loadScript(CRAZY_SRC);
      const sdk = window.CrazyGames?.SDK;
      if (!sdk) throw new Error("sdk");
      await sdk.init();
    }
    ready = true;
    flush();
  } catch {
    failed = true;
    ready = false;
    playing = false;
    pending.length = 0;
  }
}

function enqueue(event: PortalEvent) {
  if (!portal || failed) return;
  if (!ready) {
    pending.push(event);
    return;
  }
  dispatch(event);
}

function flush() {
  const queued = pending.splice(0, pending.length);
  for (const event of queued) dispatch(event);
}

function dispatch(event: PortalEvent) {
  if (event === "start") {
    const task = breakTask;
    void withTimeout(task, AD_WAIT_MS).then(() => {
      if (!playing) return;
      if (portal === "poki") safe(() => window.PokiSDK?.gameplayStart());
      else safe(() => window.CrazyGames?.SDK.game.gameplayStart());
    });
    return;
  }
  if (event === "stop") {
    if (portal === "poki") safe(() => window.PokiSDK?.gameplayStop());
    else safe(() => window.CrazyGames?.SDK.game.gameplayStop());
    return;
  }
  breakTask = runBreak();
}

async function runBreak() {
  try {
    if (portal === "poki") {
      const sdk = window.PokiSDK;
      if (!sdk) return;
      await withTimeout(
        sdk.commercialBreak(() => audioGate?.mute()).catch(() => undefined),
        AD_WAIT_MS,
      );
      return;
    }
    const sdk = window.CrazyGames?.SDK;
    if (!sdk) return;
    await withTimeout(requestCrazyMidgame(sdk), AD_WAIT_MS);
  } catch {
    /* an unfilled or blocked ad still returns the player to the menu */
  } finally {
    audioGate?.restore();
  }
}

function requestCrazyMidgame(sdk: CrazyGamesSDK) {
  return new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    try {
      const result = sdk.ad.requestAd("midgame", {
        adStarted: () => audioGate?.mute(),
        adFinished: () => {
          audioGate?.restore();
          done();
        },
        adError: () => {
          audioGate?.restore();
          done();
        },
      });
      if (isThenable(result)) {
        void Promise.resolve(result).then(done, done);
      }
    } catch {
      done();
    }
  });
}

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const found = document.querySelector(`script[src="${src}"]`);
    if (found) {
      if (found.getAttribute("data-loaded") === "1") {
        resolve();
        return;
      }
      found.addEventListener("load", () => resolve(), { once: true });
      found.addEventListener("error", () => reject(new Error("sdk")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.setAttribute("data-loaded", "1");
      resolve();
    };
    script.onerror = () => reject(new Error("sdk"));
    document.head.appendChild(script);
  });
}

function withTimeout(task: Promise<unknown>, ms: number) {
  return new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, ms);
    task.then(
      () => {
        window.clearTimeout(timer);
        resolve();
      },
      () => {
        window.clearTimeout(timer);
        resolve();
      },
    );
  });
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function";
}

function safe(fn: () => void) {
  try {
    fn();
  } catch {
    /* play anyway */
  }
}
