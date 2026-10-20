import type { Team } from "./types";

/**
 * Oblique RTS frame for one side.
 * South (`you`) looks north from below their keep. North (`foe`) looks south
 * from above theirs. The battlefield geometry is not mirrored.
 */
export function homeCameraFrame(team: Team) {
  const north = team === "foe";
  return {
    yaw: north ? Math.PI - 0.12 : 0.12,
    pitch: 1.12,
    dist: 520,
    lookX: 0,
    lookY: 14,
    lookZ: north ? -55 : 55,
  };
}

/** Camera sits on the home side of the keep: +Z is south, −Z is north. */
export function homeCameraZ(team: Team) {
  const frame = homeCameraFrame(team);
  return frame.lookZ + frame.dist * Math.sin(frame.pitch) * Math.cos(frame.yaw);
}
