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
    // Just in front of the home keep, so the keep and the house pads behind it
    // sit in the lower half instead of falling off the bottom of the screen.
    lookZ: north ? -240 : 240,
  };
}

/** Camera sits on the home side of the keep: +Z is south, −Z is north. */
export function homeCameraZ(team: Team) {
  const frame = homeCameraFrame(team);
  return frame.lookZ + frame.dist * Math.sin(frame.pitch) * Math.cos(frame.yaw);
}
