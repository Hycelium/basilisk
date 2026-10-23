/**
 * ICE for skirmish.
 *
 * A PC can usually connect straight through a home router. Two phones on cell
 * data cannot: each carrier NAT refuses the direct path, so the match has to
 * pass through TURN. Credentials come from our worker, which asks Cloudflare
 * for a short-lived username and password. Nothing long-lived is shipped in
 * the page. The free relay below is only a fallback when that mint is down.
 */
const FALLBACK_USER = "guest";
const FALLBACK_CREDENTIAL = "password";

export const ATTEMPT_MS = 12_000;
/** Phones skip the long direct wait. Carrier NAT will not open it. */
export const PHONE_ATTEMPT_MS = 2_500;
export const RELAY_STATUS = "Trying relay…";

const MINT_URL = (import.meta.env.VITE_TURN_MINT ?? "").trim();

const turn = (urls: string): RTCIceServer => ({
  urls,
  username: FALLBACK_USER,
  credential: FALLBACK_CREDENTIAL,
});

const PORT_53 = /:53(?:\?|$)/;

export function relayConfigured() {
  return MINT_URL.length > 0;
}

/** How long the direct attempt may run before the relay attempt. */
export function directAttemptMs() {
  if (typeof navigator === "undefined") return ATTEMPT_MS;
  const ua = navigator.userAgent || "";
  const coarse = typeof window !== "undefined" && (window.matchMedia?.("(pointer: coarse)").matches ?? false);
  const phone =
    coarse ||
    (navigator.maxTouchPoints ?? 0) > 0 ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return phone ? PHONE_ATTEMPT_MS : ATTEMPT_MS;
}

/** `turns` on 443 first. Cell networks allow that port and block the usual TURN ports. */
export function orderRelayUrls(urls: string | string[]): string[] {
  const list = (Array.isArray(urls) ? urls : [urls]).filter((url) => typeof url === "string" && !PORT_53.test(url));
  const rank = (url: string) => {
    if (url.startsWith("turns:") && url.includes(":443")) return 0;
    if (url.startsWith("turn:") && url.includes(":443")) return 1;
    if (url.startsWith("turns:")) return 2;
    if (url.includes(":80")) return 3;
    return 4;
  };
  return [...list].sort((a, b) => rank(a) - rank(b));
}

function fallbackRelays(): RTCIceServer[] {
  return [
    turn("turns:turn.evan-brass.net:443?transport=tcp"),
    turn("turn:turn.evan-brass.net?transport=tcp"),
    turn("turn:turn.evan-brass.net"),
  ];
}

function isRelayUrl(url: string) {
  return url.startsWith("turn:") || url.startsWith("turns:");
}

function normalizeMinted(servers: RTCIceServer[]): RTCIceServer[] {
  const out: RTCIceServer[] = [];
  for (const server of servers) {
    const raw = Array.isArray(server.urls) ? server.urls : [server.urls];
    const urls = orderRelayUrls(raw.filter((url): url is string => typeof url === "string")).filter(isRelayUrl);
    if (!urls.length) continue;
    const next: RTCIceServer = { urls };
    if (typeof server.username === "string") next.username = server.username;
    if (typeof server.credential === "string") next.credential = server.credential;
    out.push(next);
  }
  return out;
}

export function iceConfiguration(relayOnly: boolean, minted?: RTCIceServer[] | null): RTCConfiguration {
  const relays = minted && minted.length ? normalizeMinted(minted) : fallbackRelays();
  const stun: RTCIceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
  ];
  return {
    iceServers: relayOnly ? relays : [...stun, ...relays],
    iceTransportPolicy: relayOnly ? "relay" : "all",
  };
}

/**
 * Ask the worker for a short-lived Cloudflare username and password.
 * Returns null when the worker URL is unset or the mint fails.
 */
export async function mintRelay(): Promise<RTCIceServer[] | null> {
  if (!MINT_URL) return null;
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 4_000);
  try {
    const res = await fetch(MINT_URL, { method: "POST", signal: ctrl.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { iceServers?: unknown };
    if (!Array.isArray(body.iceServers)) return null;
    const servers = normalizeMinted(body.iceServers as RTCIceServer[]);
    return servers.length ? servers : null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

/** Relay-only starts after the direct attempt's window, and only once. */
export function nextLinkStep(
  clock: { opened: boolean; attempt: 0 | 1; elapsedMs: number },
  attemptMs = ATTEMPT_MS,
): "stay" | "relay" | "fail" {
  if (clock.opened) return "stay";
  if (clock.elapsedMs + 250 < attemptMs) return "stay";
  return clock.attempt === 0 ? "relay" : "fail";
}
