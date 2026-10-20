import type { Team } from "./types";

/**
 * A structure is the viewer's when it belongs to the local team.
 * Host local team is `you`. Guest local team is `foe`.
 * The other team's buildings stay inspection-only.
 */
export function isOwnStructure(localTeam: Team, structureTeam: Team | null | undefined) {
  return structureTeam != null && structureTeam === localTeam;
}

export function isEnemyStructure(localTeam: Team, structureTeam: Team | null | undefined) {
  return structureTeam != null && structureTeam !== localTeam;
}
