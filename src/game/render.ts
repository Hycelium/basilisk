import { BUILD_RANGE, ROAD_X, ROAD_Y_MAX, ROAD_Y_MIN, STARTER_GUARD_RANGE, WORLD_H, WORLD_W } from "./balance";
import { buildingName } from "./sim";
import type { Building, GameState, Team, Unit, Villager } from "./types";

export interface ViewTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

function teamAccent(team: Team) {
  if (team === "you") return "#7ec0ff";
  if (team === "east") return "#e0a040";
  return "#ef6a7a";
}

function teamDeep(team: Team) {
  if (team === "you") return "#255a96";
  if (team === "east") return "#8a5a18";
  return "#8e2436";
}

function hash(n: number) {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

/** Faux-3D classic RTS dusk battlefield — original procedural art only. */
export class GameRenderer {
  private ctx: CanvasRenderingContext2D;
  private transform: ViewTransform = { scale: 1, offsetX: 0, offsetY: 0 };
  private stars: { x: number; y: number; r: number; a: number }[] = [];
  private groundSpecks: { x: number; y: number; s: number; c: string }[] = [];
  private dust: { x: number; y: number; vx: number; life: number }[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas2D missing");
    this.ctx = ctx;
    for (let i = 0; i < 56; i++) {
      this.stars.push({
        x: hash(i * 3.1) * WORLD_W,
        y: hash(i * 7.7) * 200,
        r: 0.4 + hash(i * 1.9) * 1.5,
        a: 0.2 + hash(i * 4.2) * 0.6,
      });
    }
    for (let i = 0; i < 220; i++) {
      const warm = hash(i) > 0.5;
      this.groundSpecks.push({
        x: hash(i * 9.1) * WORLD_W,
        y: 270 + hash(i * 4.4) * (WORLD_H - 280),
        s: 0.8 + hash(i * 2.1) * 2.2,
        c: warm ? "rgba(90,140,100,0.18)" : "rgba(40,55,40,0.22)",
      });
    }
    for (let i = 0; i < 18; i++) {
      this.dust.push({
        x: hash(i * 6) * WORLD_W,
        y: 300 + hash(i * 8) * 350,
        vx: 4 + hash(i) * 10,
        life: hash(i * 3),
      });
    }
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.floor(rect.width * dpr);
    this.canvas.height = Math.floor(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const scale = Math.min(rect.width / WORLD_W, rect.height / WORLD_H);
    this.transform = {
      scale,
      offsetX: (rect.width - WORLD_W * scale) / 2,
      offsetY: (rect.height - WORLD_H * scale) / 2,
    };
  }

  screenToWorld(screenX: number, screenY: number) {
    return {
      x: (screenX - this.transform.offsetX) / this.transform.scale,
      y: (screenY - this.transform.offsetY) / this.transform.scale,
    };
  }

  draw(state: GameState) {
    const ctx = this.ctx;
    const { scale, offsetX, offsetY } = this.transform;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    ctx.clearRect(0, 0, this.canvas.width / dpr + 4, this.canvas.height / dpr + 4);

    const shakeX = state.shake > 0 ? (Math.random() - 0.5) * 5 : 0;
    const shakeY = state.shake > 0 ? (Math.random() - 0.5) * 4 : 0;
    ctx.save();
    ctx.translate(offsetX + shakeX, offsetY + shakeY);
    ctx.scale(scale, scale);

    this.drawSky(ctx, state.time);
    this.drawDistantRidges(ctx);
    this.drawValleyFloor(ctx);
    this.drawRoads3d(ctx);
    this.drawYards(ctx);
    this.drawAmbientDust(ctx, state.time);

    // Depth-sorted world props + actors
    type Layer = { y: number; z: number; draw: () => void };
    const layers: Layer[] = [];

    for (const n of state.nodes) {
      layers.push({
        y: n.pos.y,
        z: 0,
        draw: () => {
          if (n.kind === "pine") this.drawPine3d(ctx, n.pos.x, n.pos.y, n.loadsLeft <= 0, state);
          else this.drawCopper3d(ctx, n.pos.x, n.pos.y, n.loadsLeft <= 0);
        },
      });
    }
    for (const p of state.pads) {
      if (state.buildings.some((b) => b.padId === p.id)) continue;
      layers.push({ y: p.pos.y, z: 1, draw: () => this.drawPad3d(ctx, p.pos.x, p.pos.y, p.team, state) });
    }
    for (const b of state.buildings) {
      layers.push({
        y: b.pos.y,
        z: 2,
        draw: () => this.drawBuilding3d(ctx, b, state),
      });
    }
    layers.push({
      y: state.keeps.foe.pos.y,
      z: 3,
      draw: () => this.drawKeep3d(ctx, state.keeps.foe.pos.x, state.keeps.foe.pos.y, "foe", "FOE", state),
    });
    layers.push({
      y: state.keeps.you.pos.y,
      z: 3,
      draw: () => this.drawKeep3d(ctx, state.keeps.you.pos.x, state.keeps.you.pos.y, "you", "YOU", state),
    });
    for (const v of state.villagers) {
      layers.push({ y: v.pos.y, z: 4, draw: () => this.drawPeon3d(ctx, v) });
    }
    for (const u of state.units) {
      layers.push({ y: u.pos.y, z: 5, draw: () => this.drawUnit3d(ctx, u) });
    }

    layers.sort((a, b) => a.y - b.y || a.z - b.z);
    for (const L of layers) L.draw();

    this.drawPlacementGhosts(ctx, state);
    this.drawFloating(ctx, state);
    this.drawVignette(ctx);

    if (state.redFlash > 0) {
      ctx.fillStyle = `rgba(190, 28, 40, ${0.16 * Math.min(1, state.redFlash * 5)})`;
      ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    }
    ctx.restore();
  }

  private shadow(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, a = 0.35) {
    ctx.fillStyle = `rgba(0,0,0,${a})`;
    ctx.beginPath();
    ctx.ellipse(x, y + 2, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawSky(ctx: CanvasRenderingContext2D, time: number) {
    const sky = ctx.createLinearGradient(0, 0, 0, 310);
    sky.addColorStop(0, "#07060f");
    sky.addColorStop(0.28, "#1a1228");
    sky.addColorStop(0.55, "#4a2742");
    sky.addColorStop(0.78, "#c46a48");
    sky.addColorStop(1, "#e8b06a");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, WORLD_W, 310);

    const sun = ctx.createRadialGradient(210, 255, 4, 200, 268, 170);
    sun.addColorStop(0, "rgba(255,210,140,0.7)");
    sun.addColorStop(0.35, "rgba(220,110,70,0.25)");
    sun.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = sun;
    ctx.fillRect(0, 150, WORLD_W, 170);

    for (const s of this.stars) {
      const tw = 0.55 + 0.45 * Math.sin(time * 2.1 + s.x);
      ctx.fillStyle = `rgba(255,240,220,${s.a * tw})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawDistantRidges(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = "#141c28";
    ctx.beginPath();
    ctx.moveTo(0, 255);
    ctx.quadraticCurveTo(80, 200, 160, 240);
    ctx.quadraticCurveTo(240, 275, 320, 215);
    ctx.quadraticCurveTo(370, 190, 400, 230);
    ctx.lineTo(400, 310);
    ctx.lineTo(0, 310);
    ctx.fill();

    const mid = ctx.createLinearGradient(0, 230, 0, 310);
    mid.addColorStop(0, "#1a2a28");
    mid.addColorStop(1, "#13241e");
    ctx.fillStyle = mid;
    ctx.beginPath();
    ctx.moveTo(0, 275);
    ctx.quadraticCurveTo(120, 245, 220, 270);
    ctx.quadraticCurveTo(320, 295, 400, 260);
    ctx.lineTo(400, 320);
    ctx.lineTo(0, 320);
    ctx.fill();
  }

  private drawValleyFloor(ctx: CanvasRenderingContext2D) {
    const grass = ctx.createLinearGradient(0, 280, 0, WORLD_H);
    grass.addColorStop(0, "#234836");
    grass.addColorStop(0.4, "#183528");
    grass.addColorStop(1, "#0e221a");
    ctx.fillStyle = grass;
    ctx.fillRect(0, 280, WORLD_W, WORLD_H - 280);

    // Team washes
    const south = ctx.createLinearGradient(0, 420, 0, WORLD_H);
    south.addColorStop(0, "rgba(70,140,220,0)");
    south.addColorStop(1, "rgba(70,140,220,0.12)");
    ctx.fillStyle = south;
    ctx.fillRect(0, 420, WORLD_W, WORLD_H - 420);
    const north = ctx.createLinearGradient(0, 0, 0, 360);
    north.addColorStop(0, "rgba(180,50,70,0.14)");
    north.addColorStop(1, "rgba(180,50,70,0)");
    ctx.fillStyle = north;
    ctx.fillRect(0, 0, WORLD_W, 360);

    for (const g of this.groundSpecks) {
      ctx.fillStyle = g.c;
      ctx.fillRect(g.x, g.y, g.s, g.s * 0.6);
    }
  }

  private drawRoads3d(ctx: CanvasRenderingContext2D) {
    for (let i = 0; i < 2; i++) {
      const x = ROAD_X[i];
      const warm = i === 1;
      // Recessed trench
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.beginPath();
      ctx.moveTo(x - 24, ROAD_Y_MIN);
      ctx.lineTo(x + 24, ROAD_Y_MIN);
      ctx.lineTo(x + 22, ROAD_Y_MAX);
      ctx.lineTo(x - 22, ROAD_Y_MAX);
      ctx.closePath();
      ctx.fill();

      const bed = ctx.createLinearGradient(x - 20, 0, x + 20, 0);
      if (warm) {
        bed.addColorStop(0, "#3a281c");
        bed.addColorStop(0.5, "#7a5740");
        bed.addColorStop(1, "#3a281c");
      } else {
        bed.addColorStop(0, "#2e241c");
        bed.addColorStop(0.5, "#5a4535");
        bed.addColorStop(1, "#2e241c");
      }
      ctx.fillStyle = bed;
      ctx.beginPath();
      ctx.moveTo(x - 18, ROAD_Y_MIN + 2);
      ctx.lineTo(x + 18, ROAD_Y_MIN + 2);
      ctx.lineTo(x + 16, ROAD_Y_MAX - 2);
      ctx.lineTo(x - 16, ROAD_Y_MAX - 2);
      ctx.closePath();
      ctx.fill();

      // Edge bevel highlights
      ctx.strokeStyle = warm ? "rgba(210,160,110,0.2)" : "rgba(160,150,140,0.18)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x - 17, ROAD_Y_MIN + 4);
      ctx.lineTo(x - 15, ROAD_Y_MAX - 4);
      ctx.stroke();

      ctx.strokeStyle = "rgba(230, 200, 150, 0.1)";
      ctx.setLineDash([6, 16]);
      ctx.beginPath();
      ctx.moveTo(x, ROAD_Y_MIN + 10);
      ctx.lineTo(x, ROAD_Y_MAX - 10);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Center cairn 3/4
    this.shadow(ctx, 200, 368, 16, 6, 0.4);
    this.box3d(ctx, 200, 358, 18, 12, 14, "#8a7660", "#6a5848", "#a99078");
  }

  private drawYards(ctx: CanvasRenderingContext2D) {
    for (const y of [96, 628]) {
      this.shadow(ctx, 200, y + 18, 82, 22, 0.3);
      const g = ctx.createRadialGradient(200, y + 16, 8, 200, y + 16, 90);
      g.addColorStop(0, "#6b5340");
      g.addColorStop(1, "#3a2c22");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(200, y + 16, 78, 26, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawAmbientDust(ctx: CanvasRenderingContext2D, time: number) {
    for (const d of this.dust) {
      const x = (d.x + time * d.vx) % WORLD_W;
      const y = d.y + Math.sin(time + d.life * 8) * 6;
      ctx.fillStyle = `rgba(220,180,120,${0.08 + d.life * 0.06})`;
      ctx.beginPath();
      ctx.arc(x, y, 1.2 + d.life, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Axonometric-ish box: width, depth, height in world px */
  private box3d(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    d: number,
    h: number,
    left: string,
    right: string,
    top: string,
  ) {
    const ox = w * 0.45;
    const oy = d * 0.35;
    // right face
    ctx.fillStyle = right;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + ox, y - oy);
    ctx.lineTo(x + ox, y - oy - h);
    ctx.lineTo(x, y - h);
    ctx.closePath();
    ctx.fill();
    // left face
    ctx.fillStyle = left;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - ox, y - oy);
    ctx.lineTo(x - ox, y - oy - h);
    ctx.lineTo(x, y - h);
    ctx.closePath();
    ctx.fill();
    // top
    ctx.fillStyle = top;
    ctx.beginPath();
    ctx.moveTo(x, y - h);
    ctx.lineTo(x + ox, y - oy - h);
    ctx.lineTo(x, y - oy * 2 - h);
    ctx.lineTo(x - ox, y - oy - h);
    ctx.closePath();
    ctx.fill();
  }

  private drawPad3d(ctx: CanvasRenderingContext2D, x: number, y: number, team: Team, state: GameState) {
    const placing = state.buildSelection && team === "you";
    const pulse = placing ? 0.55 + Math.sin(state.time * 5) * 0.25 : 0.3;
    this.shadow(ctx, x, y + 4, 14, 5, 0.25);
    ctx.strokeStyle = team === "you" ? `rgba(126,192,255,${pulse})` : "rgba(180,70,85,0.3)";
    ctx.lineWidth = placing ? 2.5 : 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.ellipse(x, y, 16, 8, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    if (team === "you") {
      ctx.fillStyle = `rgba(126,192,255,${placing ? 0.9 : 0.55})`;
      ctx.fillRect(x - 1.5, y - 7, 3, 12);
      ctx.fillRect(x - 6, y - 1.5, 12, 3);
    }
    if (placing && state.buildSelection && state.buildSelection !== "barracks") {
      ctx.strokeStyle = "rgba(126,192,255,0.14)";
      ctx.beginPath();
      ctx.arc(x, y, BUILD_RANGE[state.buildSelection], 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawPine3d(ctx: CanvasRenderingContext2D, x: number, y: number, dead: boolean, state: GameState) {
    this.shadow(ctx, x, y + 6, 14, 5, 0.35);
    if (dead) {
      this.box3d(ctx, x, y + 2, 8, 6, 8, "#4a3428", "#3a281c", "#5a4030");
      ctx.fillStyle = "#3a7a48";
      ctx.beginPath();
      ctx.moveTo(x, y - 12);
      ctx.lineTo(x - 5, y - 2);
      ctx.lineTo(x + 5, y - 2);
      ctx.fill();
      return;
    }
    // Trunk
    ctx.fillStyle = "#4a3220";
    ctx.fillRect(x - 3, y - 8, 6, 14);
    const layers = [
      { yo: -10, w: 18, c0: "#145030", c1: "#1e6a40" },
      { yo: -20, w: 14, c0: "#1a6040", c1: "#2a8050" },
      { yo: -28, w: 10, c0: "#228050", c1: "#3a9860" },
    ];
    for (const L of layers) {
      const g = ctx.createLinearGradient(x - L.w, y + L.yo, x + L.w, y + L.yo + 16);
      g.addColorStop(0, L.c0);
      g.addColorStop(0.5, L.c1);
      g.addColorStop(1, L.c0);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x, y + L.yo - 12);
      ctx.lineTo(x - L.w, y + L.yo + 8);
      ctx.lineTo(x + L.w, y + L.yo + 8);
      ctx.closePath();
      ctx.fill();
      // lit edge
      ctx.strokeStyle = "rgba(180,255,180,0.2)";
      ctx.beginPath();
      ctx.moveTo(x, y + L.yo - 12);
      ctx.lineTo(x + L.w * 0.3, y + L.yo + 4);
      ctx.stroke();
    }
    const pulse =
      state.phase === "running" &&
      !state.firstVillagerAssigned &&
      state.time < state.pulseNodeUntil &&
      Math.abs(x - 36) < 5;
    if (pulse) {
      ctx.strokeStyle = `rgba(126,192,255,${0.45 + Math.sin(state.time * 6) * 0.25})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(x, y, 18 + Math.sin(state.time * 6) * 4, 9, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawCopper3d(ctx: CanvasRenderingContext2D, x: number, y: number, dry: boolean) {
    this.shadow(ctx, x, y + 8, 16, 6, 0.4);
    this.box3d(ctx, x, y + 4, 22, 16, 16, "#5a6068", "#3a4048", "#7a8088");
    if (!dry) {
      const seam = ctx.createLinearGradient(x - 2, y - 14, x + 4, y + 4);
      seam.addColorStop(0, "#ffe09a");
      seam.addColorStop(0.5, "#d4a040");
      seam.addColorStop(1, "#8a6020");
      ctx.fillStyle = seam;
      ctx.beginPath();
      ctx.moveTo(x - 2, y - 12);
      ctx.lineTo(x + 4, y - 8);
      ctx.lineTo(x + 2, y + 2);
      ctx.lineTo(x - 4, y - 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(255,230,150,0.7)";
      ctx.beginPath();
      ctx.arc(x, y - 6, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawBanner(ctx: CanvasRenderingContext2D, x: number, y: number, team: Team, time: number) {
    const sway = Math.sin(time * 3.4) * 3.5;
    ctx.strokeStyle = "#d0b890";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - 24);
    ctx.stroke();
    ctx.fillStyle = teamAccent(team);
    ctx.beginPath();
    ctx.moveTo(x, y - 24);
    ctx.lineTo(x + 15 + sway, y - 17);
    ctx.lineTo(x, y - 10);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = teamDeep(team);
    ctx.beginPath();
    ctx.moveTo(x, y - 22);
    ctx.lineTo(x + 8 + sway * 0.5, y - 17);
    ctx.lineTo(x, y - 13);
    ctx.closePath();
    ctx.fill();
  }

  private drawTorch(ctx: CanvasRenderingContext2D, x: number, y: number, time: number) {
    const flick = 0.65 + Math.sin(time * 14 + x) * 0.35;
    const bloom = ctx.createRadialGradient(x, y - 6, 0, x, y - 6, 14);
    bloom.addColorStop(0, `rgba(255,200,90,${0.85 * flick})`);
    bloom.addColorStop(0.4, `rgba(255,100,40,${0.35 * flick})`);
    bloom.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = bloom;
    ctx.beginPath();
    ctx.arc(x, y - 6, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#5a4030";
    ctx.fillRect(x - 1.5, y - 2, 3, 8);
  }

  private drawKeep3d(ctx: CanvasRenderingContext2D, x: number, y: number, team: Team, label: string, state: GameState) {
    const flash = state.keeps[team]?.hitFlash ?? 0;
    const stoneL = flash > 0 ? "#8a5050" : "#6a6674";
    const stoneR = flash > 0 ? "#5a3030" : "#3a3844";
    const stoneT = flash > 0 ? "#9a7070" : "#8a8694";
    this.shadow(ctx, x, y + 12, 42, 14, 0.45);

    // Side turrets
    this.box3d(ctx, x - 30, y + 2, 16, 14, 28, stoneL, stoneR, stoneT);
    this.box3d(ctx, x + 30, y + 2, 16, 14, 28, stoneL, stoneR, stoneT);
    // Main hall
    this.box3d(ctx, x, y + 6, 34, 22, 26, stoneL, stoneR, stoneT);

    // Crenellations
    ctx.fillStyle = stoneT;
    for (const sx of [-34, -26, 22, 30]) {
      ctx.fillRect(x + sx, y - 30, 6, 5);
    }

    // Gate arch
    ctx.fillStyle = "#120e14";
    ctx.beginPath();
    ctx.moveTo(x - 10, y + 4);
    ctx.lineTo(x - 10, y - 6);
    ctx.quadraticCurveTo(x, y - 16, x + 10, y - 6);
    ctx.lineTo(x + 10, y + 4);
    ctx.fill();
    ctx.strokeStyle = teamAccent(team);
    ctx.lineWidth = 1.5;
    ctx.stroke();

    this.drawTorch(ctx, x - 18, y - 4, state.time);
    this.drawTorch(ctx, x + 18, y - 4, state.time);
    this.drawBanner(ctx, x + 34, y - 10, team, state.time);

    ctx.fillStyle = "#f3e2c0";
    ctx.font = "bold 11px Georgia, Palatino, serif";
    ctx.textAlign = "center";
    ctx.shadowColor = "rgba(0,0,0,0.7)";
    ctx.shadowBlur = 4;
    ctx.fillText(label, x, y - 42);
    ctx.shadowBlur = 0;
  }

  private drawBuilding3d(ctx: CanvasRenderingContext2D, b: Building, state: GameState) {
    const { x, y } = b.pos;
    const team = b.team;
    const selected = b.id === state.selectedBuildingId;
    const isStarter = !b.canRefund && b.kind === "watchtower";
    this.shadow(ctx, x, y + 8, 16, 6, 0.4);

    if (b.kind === "watchtower") {
      this.box3d(ctx, x, y + 4, 12, 10, 26, "#6a4a30", "#3a2818", "#8a6a48");
      // Roof pyramid
      ctx.fillStyle = teamDeep(team);
      ctx.beginPath();
      ctx.moveTo(x - 14, y - 24);
      ctx.lineTo(x + 14, y - 24);
      ctx.lineTo(x, y - 42);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = teamAccent(team);
      ctx.beginPath();
      ctx.moveTo(x, y - 42);
      ctx.lineTo(x + 14, y - 24);
      ctx.lineTo(x + 4, y - 24);
      ctx.closePath();
      ctx.fill();
      this.drawBanner(ctx, x + 8, y - 20, team, state.time);
    } else if (b.kind === "ballista") {
      this.box3d(ctx, x, y + 4, 24, 14, 8, "#5a4030", "#3a2818", "#7a5a40");
      ctx.strokeStyle = "#d0b080";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(x, y - 10, 13, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
      ctx.fillStyle = teamAccent(team);
      ctx.fillRect(x - 2, y - 8, 16, 3);
    } else if (b.kind === "catapult") {
      const kick = b.animKick > 0 ? -12 * (b.animKick / 0.15) : 0;
      this.box3d(ctx, x, y + 4, 22, 14, 10, "#4a3428", "#2a1c14", "#6a4a30");
      ctx.strokeStyle = "#d0a878";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, y - 8);
      ctx.lineTo(x + kick * 0.25, y - 28 + kick * 0.35);
      ctx.stroke();
      ctx.fillStyle = "#c8a070";
      ctx.beginPath();
      ctx.arc(x + kick * 0.25, y - 28 + kick * 0.35, 5, 0, Math.PI * 2);
      ctx.fill();
      if (b.animKick > 0) {
        const spark = ctx.createRadialGradient(x, y - 20, 0, x, y - 20, 16);
        spark.addColorStop(0, "rgba(255,220,140,0.7)");
        spark.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = spark;
        ctx.beginPath();
        ctx.arc(x, y - 20, 16, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // Barracks longhouse
      this.box3d(ctx, x, y + 4, 28, 16, 14, "#6a4a34", "#3a281c", "#8a6a48");
      ctx.fillStyle = "#1a1412";
      ctx.beginPath();
      ctx.moveTo(x - 22, y - 12);
      ctx.lineTo(x + 22, y - 12);
      ctx.lineTo(x, y - 28);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = teamAccent(team);
      ctx.fillRect(x - 5, y - 2, 10, 8);
      // Train ring
      if (b.queue.length > 0) {
        const job = b.queue[0];
        const pct = 1 - job.timeLeft / Math.max(0.01, job.totalTime);
        ctx.strokeStyle = "rgba(0,0,0,0.45)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y + 16, 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = teamAccent(team);
        ctx.beginPath();
        ctx.arc(x, y + 16, 8, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2);
        ctx.stroke();
      }
    }

    if (isStarter && b.team === "you") {
      ctx.strokeStyle = "rgba(120,190,255,0.12)";
      ctx.beginPath();
      ctx.arc(x, y, STARTER_GUARD_RANGE, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (selected) {
      ctx.strokeStyle = "rgba(255,220,140,0.9)";
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.ellipse(x, y + 2, 22, 10, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      if (b.kind !== "barracks") {
        const range = isStarter ? STARTER_GUARD_RANGE : BUILD_RANGE[b.kind];
        ctx.strokeStyle = "rgba(255,220,150,0.28)";
        ctx.beginPath();
        ctx.arc(x, y, range, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "#f8e0a7";
        ctx.font = "10px Georgia, serif";
        ctx.textAlign = "center";
        ctx.fillText(isStarter ? "Keep Guard" : buildingName(b.kind), x, y - 48);
      }
    }
    // Rank gems
    for (let i = 0; i < b.damageRank; i++) {
      ctx.fillStyle = "#ff9a5a";
      ctx.beginPath();
      ctx.arc(x - 8 + i * 6, y + 18, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < b.rateRank; i++) {
      ctx.fillStyle = "#7ad0ff";
      ctx.beginPath();
      ctx.arc(x - 8 + i * 6, y + 22, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawPeon3d(ctx: CanvasRenderingContext2D, v: Villager) {
    const { x, y } = v.pos;
    const defending = v.state === "defend";
    this.shadow(ctx, x, y + 4, 7, 3, 0.35);
    // Legs
    ctx.fillStyle = defending ? "#8a5030" : v.team === "you" ? "#3a6088" : "#703040";
    ctx.fillRect(x - 3, y, 2, 5);
    ctx.fillRect(x + 1, y, 2, 5);
    // Body
    const body = ctx.createLinearGradient(x, y - 10, x, y);
    body.addColorStop(0, defending ? "#ffe08a" : v.team === "you" ? "#b0dcff" : "#f0a8b0");
    body.addColorStop(1, defending ? "#c87830" : v.team === "you" ? "#4a88c0" : "#a04858");
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(x, y - 3, 5, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    // Head
    ctx.fillStyle = "#f0d8b8";
    ctx.beginPath();
    ctx.arc(x, y - 11, 3.6, 0, Math.PI * 2);
    ctx.fill();
    if (defending) {
      ctx.strokeStyle = "#e8d0a0";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x + 4, y - 4);
      ctx.lineTo(x + 12, y - 12);
      ctx.stroke();
    }
    if (v.carryingGold > 0) {
      ctx.fillStyle = "#f0c050";
      ctx.beginPath();
      ctx.arc(x + 6, y - 2, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawUnit3d(ctx: CanvasRenderingContext2D, u: Unit) {
    const { x, y } = u.pos;
    const accent = teamAccent(u.team);
    const deep = teamDeep(u.team);
    this.shadow(ctx, x, y + 5, 8, 3.2, 0.4);

    const head = () => {
      ctx.fillStyle = "#f0d8b8";
      ctx.beginPath();
      ctx.arc(x, y - 12, 3.3, 0, Math.PI * 2);
      ctx.fill();
    };

    if (u.kind === "raider" || u.kind === "runner") {
      ctx.fillStyle = deep;
      ctx.fillRect(x - 3, y - 2, 2.5, 6);
      ctx.fillRect(x + 1, y - 2, 2.5, 6);
      const g = ctx.createLinearGradient(x, y - 10, x, y);
      g.addColorStop(0, u.kind === "runner" ? "#9dffc0" : accent);
      g.addColorStop(1, deep);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y - 5, 5, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      head();
      ctx.strokeStyle = "#e8d0a0";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + (u.team === "you" ? 4 : -4), y - 6);
      ctx.lineTo(x + (u.team === "you" ? 12 : -12), y - 14);
      ctx.stroke();
    } else if (u.kind === "soldier" || u.kind === "levy") {
      ctx.fillStyle = deep;
      ctx.fillRect(x - 3.5, y - 1, 3, 6);
      ctx.fillRect(x + 0.5, y - 1, 3, 6);
      ctx.fillStyle = deep;
      ctx.beginPath();
      ctx.ellipse(x, y - 5, 5.5, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = accent;
      ctx.fillRect(x - 5, y - 10, 10, 4);
      head();
      if (u.kind === "levy") {
        ctx.fillStyle = "#e0b060";
        ctx.beginPath();
        ctx.arc(x, y - 14, 4, Math.PI, 0);
        ctx.fill();
      } else {
        ctx.fillStyle = "#d8dce8";
        ctx.beginPath();
        ctx.ellipse(x + (u.team === "you" ? -7 : 7), y - 4, 3.5, 5.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (u.kind === "ward") {
      const g = ctx.createRadialGradient(x - 2, y - 6, 2, x, y - 2, 12);
      g.addColorStop(0, accent);
      g.addColorStop(1, deep);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y - 3, 8, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#d0e0f0";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x + (u.team === "you" ? -5 : 5), y - 3, 8, -0.5, Math.PI + 0.5);
      ctx.stroke();
      head();
    } else if (u.kind === "rammer") {
      ctx.fillStyle = deep;
      ctx.beginPath();
      ctx.ellipse(x, y - 3, 7, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#8a7050";
      ctx.fillRect(x - 2, y - 16, 4, 12);
      ctx.fillStyle = "#d0b080";
      ctx.beginPath();
      ctx.arc(x, y - 18, 5, 0, Math.PI * 2);
      ctx.fill();
      head();
    } else {
      // brute
      const g = ctx.createRadialGradient(x - 2, y - 4, 2, x, y, 12);
      g.addColorStop(0, accent);
      g.addColorStop(1, deep);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y - 2, 9, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      head();
      ctx.strokeStyle = "#6a4428";
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(x + (u.team === "you" ? 6 : -6), y - 4);
      ctx.lineTo(x + (u.team === "you" ? 13 : -13), y - 14);
      ctx.stroke();
    }

    if (u.towerResist >= 0.4) {
      ctx.strokeStyle = "rgba(180,220,255,0.45)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(x, y - 4, 12, 14, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    const hpW = 16;
    ctx.fillStyle = "rgba(12,8,10,0.75)";
    ctx.fillRect(x - hpW / 2, y - 22, hpW, 3);
    const hp = Math.max(0, u.hp / u.maxHp);
    ctx.fillStyle = hp > 0.4 ? "#7dcf6a" : "#e06050";
    ctx.fillRect(x - hpW / 2, y - 22, hpW * hp, 3);
  }

  private drawPlacementGhosts(ctx: CanvasRenderingContext2D, state: GameState) {
    // kept in pad / building drawers
    void state;
    void ctx;
  }

  private drawFloating(ctx: CanvasRenderingContext2D, state: GameState) {
    ctx.font = "bold 12px Georgia, Palatino, serif";
    ctx.textAlign = "center";
    for (const f of state.floatingTexts) {
      ctx.globalAlpha = Math.max(0, Math.min(1, f.life * 1.2));
      ctx.fillStyle = f.color;
      ctx.shadowColor = "rgba(0,0,0,0.55)";
      ctx.shadowBlur = 3;
      ctx.fillText(f.text, f.pos.x, f.pos.y - f.rise);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
  }

  private drawVignette(ctx: CanvasRenderingContext2D) {
    const v = ctx.createRadialGradient(WORLD_W / 2, WORLD_H / 2, WORLD_H * 0.25, WORLD_W / 2, WORLD_H / 2, WORLD_H * 0.72);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(0,0,0,0.38)");
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  }

  getTransform() {
    return this.transform;
  }
}
