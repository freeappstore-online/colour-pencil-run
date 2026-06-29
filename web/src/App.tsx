import { useEffect, useRef, useState, useCallback } from "react";
import { Shell } from "./components/Shell";

// ─── Constants ────────────────────────────────────────────────────────────────
const CW = 480;
const CH = 640;

const HORIZON_Y = CH * 0.42;          // where road meets sky
const ROAD_VANISH_W = 38;             // road width at horizon
const ROAD_BASE_W = CW * 0.92;        // road width at bottom
const PLAYER_Y = CH - 110;            // player pencil base Y
const LANE_COUNT = 3;                 // left / centre / right

const BASE_SPEED = 0.018;             // z-scroll speed (0→1 depth units/frame)
const SPEED_INC  = 0.000012;
const SEGMENT_DEPTH = 0.18;           // how many depth units per road stripe

const PENCIL_COLORS = ["#e74c3c","#e67e22","#f1c40f","#2ecc71","#3498db","#9b59b6","#e91e63","#00bcd4"];
const TRAIL_COLORS  = ["#ff6b6b","#ffa94d","#ffe066","#69db7c","#74c0fc","#da77f2","#f783ac","#66d9e8"];

// Sky gradient pairs [top, bottom]
const SKY_PALETTES = [
  ["#ffecd2","#fcb69f"],
  ["#a1c4fd","#c2e9fb"],
  ["#d4fc79","#96e6a1"],
  ["#f093fb","#f5576c"],
  ["#4facfe","#00f2fe"],
  ["#43e97b","#38f9d7"],
  ["#fa709a","#fee140"],
  ["#30cfd0","#667eea"],
];

type GameState = "idle" | "playing" | "dead";

interface Obstacle {
  z: number;          // depth 0=player, 1=horizon
  lane: number;       // 0,1,2
  color: string;
  colorIdx: number;
  passed: boolean;
  hit: boolean;
}

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number;
  color: string;
  size: number;
  rot: number; rotV: number;
}

interface TrailDot {
  x: number; y: number;
  color: string;
  alpha: number;
  size: number;
}

// ─── Maths helpers ────────────────────────────────────────────────────────────
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

/** Project a world lane+depth to canvas X,Y and scale */
function project(lane: number, z: number): { x: number; y: number; scale: number } {
  const t = clamp(z, 0.001, 1);
  const roadW = lerp(ROAD_BASE_W, ROAD_VANISH_W, t);
  const laneW = roadW / LANE_COUNT;
  const cx = CW / 2;
  const y = lerp(PLAYER_Y + 30, HORIZON_Y, t);
  const laneOffset = (lane - 1) * laneW;
  const x = cx + laneOffset;
  const scale = lerp(1.0, 0.08, t);
  return { x, y, scale };
}

/** Road X edges at a given depth */
function roadEdges(z: number): { left: number; right: number; y: number } {
  const t = clamp(z, 0, 1);
  const roadW = lerp(ROAD_BASE_W, ROAD_VANISH_W, t);
  const cx = CW / 2;
  const y = lerp(PLAYER_Y + 30, HORIZON_Y, t);
  return { left: cx - roadW / 2, right: cx + roadW / 2, y };
}

// ─── Drawing helpers ──────────────────────────────────────────────────────────
function lerpHex(c1: string, c2: string, t: number): string {
  const p = (h: string) => {
    const n = parseInt(h.replace("#",""), 16);
    return [(n>>16)&0xff,(n>>8)&0xff,n&0xff];
  };
  const [r1,g1,b1] = p(c1), [r2,g2,b2] = p(c2);
  return `rgb(${Math.round(lerp(r1,r2,t))},${Math.round(lerp(g1,g2,t))},${Math.round(lerp(b1,b2,t))})`;
}

function lighten(hex: string, a: number) {
  const n = parseInt(hex.replace("#",""), 16);
  return `rgb(${Math.min(255,(n>>16)+a)},${Math.min(255,((n>>8)&0xff)+a)},${Math.min(255,(n&0xff)+a)})`;
}
function darken(hex: string, a: number) {
  const n = parseInt(hex.replace("#",""), 16);
  return `rgb(${Math.max(0,(n>>16)-a)},${Math.max(0,((n>>8)&0xff)-a)},${Math.max(0,(n&0xff)-a)})`;
}

/** Draw a pencil standing vertically, pointing up, at canvas coords */
function drawPencil3D(
  ctx: CanvasRenderingContext2D,
  cx: number, baseY: number,
  scale: number, color: string,
  lean: number = 0,   // tilt in radians
  isPlayer = false
) {
  const W = (isPlayer ? 28 : 22) * scale;
  const H = (isPlayer ? 110 : 90) * scale;
  const tipH = 18 * scale;
  const eraserH = 10 * scale;
  const bandH = 6 * scale;

  ctx.save();
  ctx.translate(cx, baseY);
  ctx.rotate(lean);

  // Shadow (only for player)
  if (isPlayer) {
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(6 * scale, 4 * scale, W * 0.7, W * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Body gradient
  const grad = ctx.createLinearGradient(-W/2, 0, W/2, 0);
  grad.addColorStop(0, lighten(color, 55));
  grad.addColorStop(0.35, color);
  grad.addColorStop(0.65, color);
  grad.addColorStop(1, darken(color, 40));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(-W/2, -H, W, H - tipH - eraserH - bandH, 2);
  ctx.fill();

  // Shine stripe
  ctx.fillStyle = "rgba(255,255,255,0.28)";
  ctx.fillRect(-W/2 + 2*scale, -H + 2*scale, W*0.22, H - tipH - eraserH - bandH - 4*scale);

  // Metal band
  const bandY = -eraserH - bandH;
  const bandGrad = ctx.createLinearGradient(-W/2, 0, W/2, 0);
  bandGrad.addColorStop(0, "#aaa");
  bandGrad.addColorStop(0.5, "#eee");
  bandGrad.addColorStop(1, "#888");
  ctx.fillStyle = bandGrad;
  ctx.fillRect(-W/2, bandY, W, bandH);

  // Eraser
  ctx.fillStyle = "#f4a0a0";
  ctx.beginPath();
  ctx.roundRect(-W/2, -H, W, eraserH, [3, 3, 0, 0]);
  ctx.fill();

  // Wooden tip cone
  const woodGrad = ctx.createLinearGradient(-W/2, 0, W/2, 0);
  woodGrad.addColorStop(0, "#e8c97a");
  woodGrad.addColorStop(0.5, "#d4a96a");
  woodGrad.addColorStop(1, "#b8864e");
  ctx.fillStyle = woodGrad;
  ctx.beginPath();
  ctx.moveTo(-W/2, bandY - (H - tipH - eraserH - bandH));
  ctx.lineTo( W/2, bandY - (H - tipH - eraserH - bandH));
  ctx.lineTo(0, bandY - (H - tipH - eraserH - bandH) - tipH);
  ctx.closePath();
  ctx.fill();

  // Graphite tip
  ctx.fillStyle = "#2d2d2d";
  ctx.beginPath();
  const tipTop = bandY - (H - tipH - eraserH - bandH) - tipH;
  ctx.moveTo(-2*scale, tipTop + 6*scale);
  ctx.lineTo( 2*scale, tipTop + 6*scale);
  ctx.lineTo(0, tipTop);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

// ─── Road drawing ─────────────────────────────────────────────────────────────
function drawRoad(
  ctx: CanvasRenderingContext2D,
  scrollZ: number,
  skyPaletteIdx: number,
  nextSkyIdx: number,
  skyT: number,
  colorIdx: number
) {
  // ── Sky ──
  const [s1t, s1b] = SKY_PALETTES[skyPaletteIdx];
  const [s2t, s2b] = SKY_PALETTES[nextSkyIdx];
  const skyTop = lerpHex(s1t, s2t, skyT);
  const skyBot = lerpHex(s1b, s2b, skyT);
  const skyGrad = ctx.createLinearGradient(0, 0, 0, HORIZON_Y);
  skyGrad.addColorStop(0, skyTop);
  skyGrad.addColorStop(1, skyBot);
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, CW, HORIZON_Y);

  // ── Distant hills / glow ──
  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = lerpHex(s1b, "#ffffff", 0.5);
  ctx.beginPath();
  ctx.ellipse(CW/2, HORIZON_Y + 10, CW * 0.7, 40, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // ── Road surface ──
  ctx.beginPath();
  const { left: bl, right: br } = roadEdges(0);
  const { left: hl, right: hr } = roadEdges(1);
  ctx.moveTo(hl, HORIZON_Y);
  ctx.lineTo(hr, HORIZON_Y);
  ctx.lineTo(br, PLAYER_Y + 30);
  ctx.lineTo(bl, PLAYER_Y + 30);
  ctx.closePath();
  const roadGrad = ctx.createLinearGradient(0, HORIZON_Y, 0, PLAYER_Y + 30);
  roadGrad.addColorStop(0, "#6b7280");
  roadGrad.addColorStop(0.4, "#4b5563");
  roadGrad.addColorStop(1, "#374151");
  ctx.fillStyle = roadGrad;
  ctx.fill();

  // ── Road kerb stripes (left & right edges) ──
  const STRIPE_SEGS = 14;
  for (let i = 0; i < STRIPE_SEGS; i++) {
    const z0 = i / STRIPE_SEGS;
    const z1 = (i + 0.5) / STRIPE_SEGS;
    const scroll = (scrollZ % (1 / STRIPE_SEGS)) * STRIPE_SEGS;
    const za = (z0 + scroll / STRIPE_SEGS) % 1;
    const zb = (z1 + scroll / STRIPE_SEGS) % 1;
    if (za > 0.98 || zb > 0.98) continue;

    const e0 = roadEdges(za);
    const e1 = roadEdges(zb);
    const kerbW = lerp(18, 3, za);
    const isRed = i % 2 === 0;

    // Left kerb
    ctx.beginPath();
    ctx.moveTo(e0.left, e0.y);
    ctx.lineTo(e0.left - kerbW, e0.y);
    ctx.lineTo(e1.left - lerp(18,3,zb), e1.y);
    ctx.lineTo(e1.left, e1.y);
    ctx.closePath();
    ctx.fillStyle = isRed ? "#e74c3c" : "#f5f5f5";
    ctx.fill();

    // Right kerb
    ctx.beginPath();
    ctx.moveTo(e0.right, e0.y);
    ctx.lineTo(e0.right + kerbW, e0.y);
    ctx.lineTo(e1.right + lerp(18,3,zb), e1.y);
    ctx.lineTo(e1.right, e1.y);
    ctx.closePath();
    ctx.fillStyle = isRed ? "#e74c3c" : "#f5f5f5";
    ctx.fill();
  }

  // ── Centre dashes ──
  const DASH_SEGS = 20;
  for (let i = 0; i < DASH_SEGS; i++) {
    const rawZ0 = i / DASH_SEGS;
    const rawZ1 = (i + 0.4) / DASH_SEGS;
    const scroll = scrollZ % (1 / DASH_SEGS) * DASH_SEGS;
    const za = (rawZ0 + scroll / DASH_SEGS) % 1;
    const zb = (rawZ1 + scroll / DASH_SEGS) % 1;
    if (za > 0.97 || zb > 0.97) continue;

    const p0 = project(1, za);
    const p1 = project(1, zb);
    const dw = lerp(5, 0.8, za);
    ctx.beginPath();
    ctx.moveTo(p0.x - dw/2, p0.y);
    ctx.lineTo(p0.x + dw/2, p0.y);
    ctx.lineTo(p1.x + dw/2, p1.y);
    ctx.lineTo(p1.x - dw/2, p1.y);
    ctx.closePath();
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fill();
  }

  // ── Lane dividers ──
  for (const laneDiv of [0.33, 0.67]) {
    const LDASH = 18;
    for (let i = 0; i < LDASH; i++) {
      const rawZ0 = i / LDASH;
      const rawZ1 = (i + 0.35) / LDASH;
      const scroll = scrollZ % (1/LDASH) * LDASH;
      const za = (rawZ0 + scroll/LDASH) % 1;
      const zb = (rawZ1 + scroll/LDASH) % 1;
      if (za > 0.97 || zb > 0.97) continue;

      const e0 = roadEdges(za);
      const e1 = roadEdges(zb);
      const rx0 = e0.left + (e0.right - e0.left) * laneDiv;
      const rx1 = e1.left + (e1.right - e1.left) * laneDiv;
      const dw0 = lerp(3.5, 0.5, za);
      const dw1 = lerp(3.5, 0.5, zb);

      ctx.beginPath();
      ctx.moveTo(rx0 - dw0/2, e0.y);
      ctx.lineTo(rx0 + dw0/2, e0.y);
      ctx.lineTo(rx1 + dw1/2, e1.y);
      ctx.lineTo(rx1 - dw1/2, e1.y);
      ctx.closePath();
      ctx.fillStyle = "rgba(255,255,255,0.3)";
      ctx.fill();
    }
  }

  // ── Colour trail on road ──
  // (drawn by caller after road)

  // ── Foreground road extension (below player) ──
  ctx.fillStyle = "#374151";
  ctx.fillRect(0, PLAYER_Y + 30, CW, CH - PLAYER_Y - 30);

  // Grass sides
  const grassGrad = ctx.createLinearGradient(0, HORIZON_Y, 0, CH);
  grassGrad.addColorStop(0, "#4ade80");
  grassGrad.addColorStop(0.3, "#22c55e");
  grassGrad.addColorStop(1, "#16a34a");

  // Left grass
  ctx.beginPath();
  ctx.moveTo(0, HORIZON_Y);
  ctx.lineTo(hl, HORIZON_Y);
  ctx.lineTo(bl, PLAYER_Y + 30);
  ctx.lineTo(0, PLAYER_Y + 30);
  ctx.closePath();
  ctx.fillStyle = grassGrad;
  ctx.fill();

  // Right grass
  ctx.beginPath();
  ctx.moveTo(CW, HORIZON_Y);
  ctx.lineTo(hr, HORIZON_Y);
  ctx.lineTo(br, PLAYER_Y + 30);
  ctx.lineTo(CW, PLAYER_Y + 30);
  ctx.closePath();
  ctx.fillStyle = grassGrad;
  ctx.fill();

  // Foreground grass
  ctx.fillStyle = "#15803d";
  ctx.fillRect(0, PLAYER_Y + 30, bl, CH - PLAYER_Y - 30);
  ctx.fillRect(br, PLAYER_Y + 30, CW - br, CH - PLAYER_Y - 30);

  // Color streak on road surface (current pencil color tint)
  const streakColor = PENCIL_COLORS[colorIdx];
  const streakGrad = ctx.createLinearGradient(0, HORIZON_Y, 0, PLAYER_Y + 30);
  streakGrad.addColorStop(0, "transparent");
  streakGrad.addColorStop(1, streakColor + "33");
  ctx.fillStyle = streakGrad;
  ctx.beginPath();
  ctx.moveTo(hl, HORIZON_Y);
  ctx.lineTo(hr, HORIZON_Y);
  ctx.lineTo(br, PLAYER_Y + 30);
  ctx.lineTo(bl, PLAYER_Y + 30);
  ctx.closePath();
  ctx.fill();
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef  = useRef<GameState>("idle");
  const rafRef    = useRef<number>(0);

  // ── Game refs (live in the loop) ──────────────────────────────────────────
  const playerLane   = useRef(1);          // 0=left,1=centre,2=right
  const targetLane   = useRef(1);
  const laneAnim     = useRef(1.0);        // 0→1 transition
  const playerLean   = useRef(0);
  const scrollZ      = useRef(0);
  const speed        = useRef(BASE_SPEED);
  const frameCount   = useRef(0);
  const score        = useRef(0);
  const colorIdx     = useRef(0);
  const skyIdx       = useRef(0);
  const nextSkyIdx   = useRef(0);
  const skyT         = useRef(1.0);
  const obstacles    = useRef<Obstacle[]>([]);
  const particles    = useRef<Particle[]>([]);
  const trail        = useRef<TrailDot[]>([]);
  const dead         = useRef(false);
  const invincible   = useRef(0);          // frames of invincibility after hit

  // ── React state (UI layer) ────────────────────────────────────────────────
  const [uiScore,    setUiScore]    = useState(0);
  const [gameState,  setGameState]  = useState<GameState>("idle");
  const [curColor,   setCurColor]   = useState(PENCIL_COLORS[0]);
  const [bestScore,  setBestScore]  = useState(() =>
    parseInt(localStorage.getItem("pencilrun3d_best") || "0", 10)
  );

  // ── Particles ─────────────────────────────────────────────────────────────
  const spawnParticles = useCallback((x: number, y: number, color: string, n = 12) => {
    for (let i = 0; i < n; i++) {
      const angle = (Math.PI * 2 * i) / n + Math.random() * 0.6;
      const spd   = 2.5 + Math.random() * 5;
      particles.current.push({
        x, y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd - 2,
        life: 1.0,
        color,
        size: 5 + Math.random() * 8,
        rot: Math.random() * Math.PI * 2,
        rotV: (Math.random() - 0.5) * 0.3,
      });
    }
  }, []);

  // ── Reset ─────────────────────────────────────────────────────────────────
  const resetGame = useCallback(() => {
    playerLane.current  = 1;
    targetLane.current  = 1;
    laneAnim.current    = 1.0;
    playerLean.current  = 0;
    scrollZ.current     = 0;
    speed.current       = BASE_SPEED;
    frameCount.current  = 0;
    score.current       = 0;
    colorIdx.current    = 0;
    skyIdx.current      = 0;
    nextSkyIdx.current  = 0;
    skyT.current        = 1.0;
    obstacles.current   = [];
    particles.current   = [];
    trail.current       = [];
    dead.current        = false;
    invincible.current  = 0;
    setUiScore(0);
    setCurColor(PENCIL_COLORS[0]);
  }, []);

  // ── Lane movement ─────────────────────────────────────────────────────────
  const moveLeft = useCallback(() => {
    if (stateRef.current !== "playing") return;
    const t = Math.max(0, targetLane.current - 1);
    if (t !== targetLane.current) {
      targetLane.current = t;
      laneAnim.current   = 0;
      playerLean.current = -0.22;
    }
  }, []);

  const moveRight = useCallback(() => {
    if (stateRef.current !== "playing") return;
    const t = Math.min(2, targetLane.current + 1);
    if (t !== targetLane.current) {
      targetLane.current = t;
      laneAnim.current   = 0;
      playerLean.current = 0.22;
    }
  }, []);

  const startGame = useCallback(() => {
    if (stateRef.current === "idle") {
      stateRef.current = "playing";
      setGameState("playing");
    } else if (stateRef.current === "dead") {
      resetGame();
      stateRef.current = "playing";
      setGameState("playing");
    }
  }, [resetGame]);

  // ── Input ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "ArrowLeft"  || e.code === "KeyA") { e.preventDefault(); moveLeft();  }
      if (e.code === "ArrowRight" || e.code === "KeyD") { e.preventDefault(); moveRight(); }
      if (e.code === "Space" || e.code === "Enter")     { e.preventDefault(); startGame(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moveLeft, moveRight, startGame]);

  // Touch swipe
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let startX = 0;
    const onStart = (e: TouchEvent) => { startX = e.touches[0].clientX; };
    const onEnd   = (e: TouchEvent) => {
      const dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) < 20) { startGame(); return; }
      if (dx < 0) moveLeft(); else moveRight();
    };
    canvas.addEventListener("touchstart", onStart, { passive: true });
    canvas.addEventListener("touchend",   onEnd,   { passive: true });
    return () => {
      canvas.removeEventListener("touchstart", onStart);
      canvas.removeEventListener("touchend",   onEnd);
    };
  }, [moveLeft, moveRight, startGame]);

  // ── Game loop ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    function spawnObstacle() {
      const lane = Math.floor(Math.random() * LANE_COUNT);
      const ci   = Math.floor(Math.random() * PENCIL_COLORS.length);
      // Ensure at least one lane is free (don't spawn same lane as last 2)
      const recent = obstacles.current.filter(o => o.z > 0.85).map(o => o.lane);
      if (recent.length >= LANE_COUNT - 1) return; // all lanes occupied near horizon
      obstacles.current.push({
        z: 0.92,
        lane,
        color: PENCIL_COLORS[ci],
        colorIdx: ci,
        passed: false,
        hit: false,
      });
    }

    function update() {
      if (stateRef.current !== "playing") return;

      frameCount.current++;
      speed.current = BASE_SPEED + frameCount.current * SPEED_INC;

      // Scroll
      scrollZ.current = (scrollZ.current + speed.current) % 1;

      // Lane animation
      if (laneAnim.current < 1) {
        laneAnim.current = Math.min(1, laneAnim.current + 0.12);
        playerLane.current = lerp(playerLane.current, targetLane.current, 0.12);
      } else {
        playerLane.current = targetLane.current;
      }
      playerLean.current = lerp(playerLean.current, 0, 0.10);

      // Move obstacles toward player
      obstacles.current.forEach(o => { o.z -= speed.current; });
      obstacles.current = obstacles.current.filter(o => o.z > -0.05);

      // Spawn
      if (frameCount.current % 75 === 0) spawnObstacle();

      // Collision & scoring
      if (invincible.current > 0) invincible.current--;

      for (const obs of obstacles.current) {
        // Passed (behind player)
        if (!obs.passed && obs.z < 0.02) {
          obs.passed = true;
          score.current++;
          setUiScore(score.current);

          const next = (colorIdx.current + 1) % PENCIL_COLORS.length;
          colorIdx.current = next;
          setCurColor(PENCIL_COLORS[next]);

          // Sky transition
          skyIdx.current     = nextSkyIdx.current;
          nextSkyIdx.current = (skyIdx.current + 1) % SKY_PALETTES.length;
          skyT.current       = 0;

          const pp = project(playerLane.current, 0);
          spawnParticles(pp.x, PLAYER_Y - 40, TRAIL_COLORS[next], 16);
        }

        // Hit detection: obstacle near player (z close to 0) and same lane
        if (!obs.hit && !obs.passed && obs.z < 0.12 && obs.z > -0.02) {
          const laneDiff = Math.abs(playerLane.current - obs.lane);
          if (laneDiff < 0.45 && invincible.current === 0) {
            obs.hit = true;
            // Crash!
            dead.current       = true;
            stateRef.current   = "dead";
            setGameState("dead");
            const pp = project(playerLane.current, 0);
            spawnParticles(pp.x, PLAYER_Y - 50, PENCIL_COLORS[colorIdx.current], 28);
            const best = parseInt(localStorage.getItem("pencilrun3d_best") || "0", 10);
            if (score.current > best) {
              localStorage.setItem("pencilrun3d_best", String(score.current));
              setBestScore(score.current);
            }
          }
        }
      }

      // Sky lerp
      skyT.current = Math.min(1, skyT.current + 0.025);

      // Trail
      const pp = project(playerLane.current, 0.01);
      trail.current.push({
        x: pp.x,
        y: PLAYER_Y - 10,
        color: TRAIL_COLORS[colorIdx.current],
        alpha: 0.85,
        size: 7,
      });
      if (trail.current.length > 80) trail.current.shift();
      trail.current.forEach(d => { d.alpha *= 0.93; d.y += 0.5; });

      // Particles
      particles.current.forEach(p => {
        p.x += p.vx; p.y += p.vy;
        p.vy += 0.25;
        p.vx *= 0.96;
        p.life -= 0.022;
        p.rot  += p.rotV;
      });
      particles.current = particles.current.filter(p => p.life > 0);
    }

    function draw() {
      // Road + sky
      drawRoad(ctx, scrollZ.current, skyIdx.current, nextSkyIdx.current, skyT.current, colorIdx.current);

      // Trail dots on road
      trail.current.forEach((d, i) => {
        ctx.globalAlpha = d.alpha * (i / trail.current.length) * 0.7;
        ctx.fillStyle   = d.color;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.size * (i / trail.current.length), 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;

      // Obstacles (sorted back to front)
      const sorted = [...obstacles.current].sort((a, b) => b.z - a.z);
      for (const obs of sorted) {
        if (obs.z <= 0 || obs.z > 1) continue;
        const p = project(obs.lane, obs.z);
        if (obs.hit) {
          ctx.globalAlpha = Math.max(0, obs.z + 0.5);
        }
        drawPencil3D(ctx, p.x, p.y, p.scale, obs.color, 0, false);
        ctx.globalAlpha = 1;
      }

      // Player pencil
      if (!dead.current) {
        const pp = project(playerLane.current, 0);
        const flash = invincible.current > 0 && Math.floor(invincible.current / 4) % 2 === 0;
        if (!flash) {
          drawPencil3D(ctx, pp.x, PLAYER_Y, 1.0, PENCIL_COLORS[colorIdx.current], playerLean.current, true);
        }
      }

      // Particles
      particles.current.forEach(p => {
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        const s = p.size * Math.max(0.1, p.life);
        ctx.fillRect(-s/2, -s/2, s, s);
        ctx.restore();
      });
      ctx.globalAlpha = 1;

      // HUD: score
      ctx.save();
      ctx.font = "bold 30px Fraunces, serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.fillText(String(score.current), CW/2 + 2, 48);
      ctx.fillStyle = "#fff";
      ctx.shadowColor = "rgba(0,0,0,0.4)";
      ctx.shadowBlur  = 8;
      ctx.fillText(String(score.current), CW/2, 46);
      ctx.restore();

      // Lane arrows (HUD)
      if (stateRef.current === "playing") {
        const arrowY = CH - 30;
        const arrowAlpha = 0.35;
        ctx.globalAlpha = arrowAlpha;
        ctx.fillStyle = "#fff";
        ctx.font = "bold 22px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("◀", 40, arrowY);
        ctx.fillText("▶", CW - 40, arrowY);
        ctx.globalAlpha = 1;
      }

      // Idle overlay
      if (stateRef.current === "idle") {
        ctx.fillStyle = "rgba(0,0,0,0.38)";
        ctx.fillRect(0, 0, CW, CH);
        ctx.fillStyle = "#fff";
        ctx.font = "bold 36px Fraunces, serif";
        ctx.textAlign = "center";
        ctx.shadowColor = "rgba(0,0,0,0.5)";
        ctx.shadowBlur  = 12;
        ctx.fillText("Colour Pencil Run", CW/2, CH/2 - 50);
        ctx.shadowBlur = 0;
        ctx.font = "18px Manrope, sans-serif";
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.fillText("Swipe or ← → to change lane", CW/2, CH/2);
        ctx.fillText("Dodge the pencils!", CW/2, CH/2 + 30);
        ctx.font = "bold 15px Manrope, sans-serif";
        ctx.fillStyle = "#fff";
        ctx.fillText("Tap / Space to start", CW/2, CH/2 + 72);
      }

      // Dead overlay
      if (stateRef.current === "dead" && particles.current.length < 10) {
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(0, 0, CW, CH);
        ctx.textAlign = "center";
        ctx.shadowColor = "rgba(0,0,0,0.6)";
        ctx.shadowBlur  = 14;
        ctx.fillStyle = "#fff";
        ctx.font = "bold 34px Fraunces, serif";
        ctx.fillText("💥 Crashed!", CW/2, CH/2 - 65);
        ctx.shadowBlur = 0;
        ctx.font = "bold 56px Fraunces, serif";
        ctx.fillStyle = PENCIL_COLORS[colorIdx.current];
        ctx.fillText(String(score.current), CW/2, CH/2 - 4);
        ctx.font = "15px Manrope, sans-serif";
        ctx.fillStyle = "rgba(255,255,255,0.8)";
        ctx.fillText("score", CW/2, CH/2 + 22);
        const best = parseInt(localStorage.getItem("pencilrun3d_best")||"0",10);
        ctx.fillText(`Best: ${Math.max(score.current, best)}`, CW/2, CH/2 + 50);
        ctx.fillStyle = "#fff";
        ctx.font = "bold 16px Manrope, sans-serif";
        ctx.fillText("Tap / Space to try again", CW/2, CH/2 + 90);
      }
    }

    function loop() {
      update();
      draw();
      rafRef.current = requestAnimationFrame(loop);
    }

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [spawnParticles]);

  return (
    <Shell>
      <div className="flex flex-col items-center gap-3 select-none">

        {/* Colour dots + best score */}
        <div className="flex items-center gap-2 w-full max-w-xl">
          <div className="flex gap-1.5 items-center">
            {PENCIL_COLORS.map((c, i) => (
              <div
                key={i}
                className="rounded-full transition-all duration-300"
                style={{
                  width:  c === curColor ? 14 : 8,
                  height: c === curColor ? 14 : 8,
                  background: c,
                  opacity: c === curColor ? 1 : 0.35,
                  marginTop: c === curColor ? 0 : 3,
                  boxShadow: c === curColor ? `0 0 8px ${c}` : "none",
                }}
              />
            ))}
          </div>
          <div className="flex-1" />
          <div className="text-sm font-bold" style={{ color: "var(--muted)" }}>
            Best <span style={{ color: "var(--ink)" }}>{bestScore}</span>
          </div>
        </div>

        {/* Canvas */}
        <div
          className="relative rounded-2xl overflow-hidden cursor-pointer"
          style={{
            boxShadow: `0 8px 40px ${curColor}55, 0 2px 12px rgba(0,0,0,0.25)`,
            border: `3px solid ${curColor}`,
            transition: "border-color 0.4s, box-shadow 0.4s",
          }}
          onClick={startGame}
        >
          <canvas
            ref={canvasRef}
            width={CW}
            height={CH}
            style={{ display: "block", maxWidth: "100%", maxHeight: "calc(100dvh - 170px)" }}
          />
        </div>

        {/* Mobile lane buttons */}
        {gameState === "playing" && (
          <div className="flex gap-4 md:hidden">
            <button
              onTouchStart={(e) => { e.preventDefault(); moveLeft(); }}
              onClick={moveLeft}
              className="flex-1 py-3 rounded-xl font-bold text-xl active:scale-95 transition-transform"
              style={{ background: curColor, color: "#fff", minWidth: 90 }}
            >◀ Left</button>
            <button
              onTouchStart={(e) => { e.preventDefault(); moveRight(); }}
              onClick={moveRight}
              className="flex-1 py-3 rounded-xl font-bold text-xl active:scale-95 transition-transform"
              style={{ background: curColor, color: "#fff", minWidth: 90 }}
            >Right ▶</button>
          </div>
        )}

        {/* Hint */}
        <p className="text-xs text-center" style={{ color: "var(--muted)" }}>
          {gameState === "idle"    && "Tap / Space to start • ← → or swipe to change lane"}
          {gameState === "playing" && "← → / swipe to dodge • pass pencils to change colour"}
          {gameState === "dead"    && "Tap / Space to try again"}
        </p>
      </div>
    </Shell>
  );
}
