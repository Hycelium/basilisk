import { useMemo } from "react";
import { WORLD_H } from "../game/balance";
import {
  buildPads,
  generateMap,
  keepPos,
  mapBounds,
  mapLanes,
  riverLayers,
  riverYAt,
  roadCenterX,
  type RiverBand,
} from "../game/map";
import type { Lane, Team } from "../game/types";

const ROAD_SAMPLES = 96;
const RIVER_SAMPLES = 48;

/** Same centerline the battlefield ribbon uses: pinned at both gates, bent in between. */
function roadPath(seed: number, lane: Lane) {
  const y0 = 48;
  const y1 = WORLD_H - 48;
  let d = "";
  for (let i = 0; i <= ROAD_SAMPLES; i++) {
    const y = y0 + ((y1 - y0) * i) / ROAD_SAMPLES;
    const x = roadCenterX(seed, lane, y);
    d += `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }
  return d;
}

function riverPath(seed: number, river: RiverBand) {
  const { minX, width } = mapBounds(seed);
  let d = "";
  for (let i = 0; i <= RIVER_SAMPLES; i++) {
    const x = minX + (width * i) / RIVER_SAMPLES;
    const y = riverYAt(river, x);
    d += `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }
  return { d, width: river.width, id: river.id };
}

function KeepGlyph({ x, y, team }: { x: number; y: number; team: Team }) {
  const w = 40;
  const h = 36;
  const gateY = team === "you" ? y - h / 2 - 7 : y + h / 2 - 1;
  return (
    <g>
      <rect x={x - w / 2} y={y - h / 2} width={w} height={h} fill="#c4b8a4" stroke="#2c241c" strokeWidth={2.5} />
      <rect x={x - 7} y={gateY} width={14} height={8} fill="#24180f" />
      <rect x={x - 6} y={y - 5} width={12} height={10} fill={team === "you" ? "#6ea0d0" : "#c45a62"} />
    </g>
  );
}

/** Top-down drawing of the map this seed will play. South (blue keep) is at the bottom. */
export function MapPreview({ seed }: { seed: number }) {
  const drawing = useMemo(() => {
    const map = generateMap(seed);
    const bounds = mapBounds(seed);
    const marginX = 28;
    const marginY = 44;
    return {
      view: `${bounds.minX - marginX} ${-marginY} ${bounds.width + marginX * 2} ${WORLD_H + marginY * 2}`,
      field: bounds,
      rivers: riverLayers(seed).map((river) => riverPath(seed, river)),
      roads: mapLanes(seed).map((lane) => ({ lane, d: roadPath(seed, lane) })),
      pads: buildPads(map),
      you: keepPos("you"),
      foe: keepPos("foe"),
    };
  }, [seed]);

  return (
    <div className="map-seed-preview">
      <svg viewBox={drawing.view} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Top-down map of this battlefield">
        <rect x={drawing.field.minX} y={-12} width={drawing.field.width} height={WORLD_H + 24} fill="#4d6438" />
        {drawing.rivers.map((river) => (
          <path
            key={river.id}
            d={river.d}
            fill="none"
            stroke="#3f91b0"
            strokeWidth={river.width}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {drawing.roads.map((road) => (
          <path
            key={road.lane}
            d={road.d}
            fill="none"
            stroke="#c4b49c"
            strokeWidth={22}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {drawing.pads.map((pad) => (
          <circle
            key={pad.id}
            cx={pad.pos.x}
            cy={pad.pos.y}
            r={pad.zone === "eco" ? 11 : 13}
            fill="none"
            stroke={pad.zone === "eco" ? "#c6f06a" : pad.team === "you" ? "#7fd4ff" : "#ff6a78"}
            strokeWidth={3.5}
          />
        ))}
        <KeepGlyph x={drawing.foe.x} y={drawing.foe.y} team="foe" />
        <KeepGlyph x={drawing.you.x} y={drawing.you.y} team="you" />
      </svg>
    </div>
  );
}
