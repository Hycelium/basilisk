import { KEEP_MARGIN, WORLD_H } from "./balance";
import type { Team } from "./types";

/**
 * Oblique RTS frame for one side.
 * South (`you`) looks north from behind their keep. North (`foe`) looks south
 * from behind theirs. The battlefield geometry is not mirrored.
 */
export function homeCameraFrame(team: Team) {
  const north = team === "foe";
  // Keep world-Z (sim Y centered on 0). Camera sits further back via pitch/dist
  // so the peon house pads between the lens and the keep stay on screen.
  const keepZ = WORLD_H / 2 - KEEP_MARGIN;
  // Aim a little toward the field so the keep sits mid-frame and the eco yard
  // fills the near ground behind it.
  const lookDepth = keepZ - 70;
  return {
    yaw: north ? Math.PI - 0.12 : 0.12,
    pitch: 1.08,
    dist: 480,
    lookX: 0,
    lookY: 14,
    lookZ: north ? -lookDepth : lookDepth,
  };
}

/** Camera sits on the home side of the keep: +Z is south, −Z is north. */
export function homeCameraZ(team: Team) {
  const frame = homeCameraFrame(team);
  return frame.lookZ + frame.dist * Math.sin(frame.pitch) * Math.cos(frame.yaw);
}
