/**
 * ICE for skirmish.
 *
 * Metered's Open Relay page still names staticauth.openrelay.metered.ca,
 * but that name no longer serves TURN (it does not allocate). The masquerade
 * relay documents a free server, including turns on 443, and an allocation
 * against that TLS port succeeds:
 * https://github.com/evan-brass/masquerade
 */
const RELAY_USER = "guest";
const RELAY_CREDENTIAL = "password";

export const ATTEMPT_MS = 12_000;

const turn = (urls: string): RTCIceServer => ({
  urls,
  username: RELAY_USER,
  credential: RELAY_CREDENTIAL,
});

export function iceConfiguration(relayOnly: boolean): RTCConfiguration {
  const config: RTCConfiguration = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun.cloudflare.com:3478" },
      turn("turns:turn.evan-brass.net:443?transport=tcp"),
      turn("turn:turn.evan-brass.net?transport=tcp"),
      turn("turn:turn.evan-brass.net"),
    ],
    iceTransportPolicy: relayOnly ? "relay" : "all",
  };
  return config;
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
