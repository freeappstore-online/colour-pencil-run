import { useEffect, useRef, useState, useCallback } from "react";
import { Shell } from "./components/Shell";

// ─── Constants ────────────────────────────────────────────────────────────────
const CANVAS_W = 480;
const CANVAS_H = 640;
const PENCIL_W = 18;
const PENCIL_H = 54;
const PENCIL_X = 80;
const GRAVITY = 0.45;
const JUMP_VEL = -9.5;
const BASE_SPEED = 3.5;
const SPEED_INC = 0.0008;
const OBSTACLE_GAP = 180;
const OBSTACLE_WIDTH = 28;
const PENCIL_COLORS = ["#e74c3c","#e67e22","#f1c40f","#2ecc71","#3498db","#9b59b6","#e91e63","#00bcd4"];
const TRAIL_COLORS  = ["#ff6b6b","#ffa94d","#ffe066","#69db7c","#74c0fc","#da77f2","#f783ac","#66d9e8"];
const BG_COLORS     = ["#fff5f5","#fff4e6","#fff9db","#ebfbee","#e7f5ff","#f3f0ff","#fff0f6","#e3fafc"];

interface Obstacle {
  x: number;
  topH: number;
  botH: number;
  color: string;
  passed: boolean;
}

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  color: string; size: number;
}

interface TrailDot {
  x: number; y: number;
  color: string; alpha: number;
}

type GameState = "idle" | "playing" | "dead";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

function drawPencil(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, wobble: number) {
  ctx.save();
  ctx.translate(x + PENCIL_W / 2, y + PENCIL_H / 2);
  ctx.rotate(wobble);
  const hw = PENCIL_W / 2;
  const hh = PENCIL_H / 2;

  // Eraser (top)
  ctx.fillStyle = "#f8c8c8";
  ctx.beginPath();
  ctx.roundRect(-hw, -hh, PENCIL_W, 10, 3);
  ctx.fill();

  // Metal band
  ctx.fillStyle = "#c0c0c0";
  ctx.fillRect(-hw, -hh + 10, PENCIL_W, 5);

  // Body
  const grad = ctx.createLinearGradient(-hw, 0, hw, 0);
  grad.addColorStop(0, lighten(color, 40));
  grad.addColorStop(0.5, color);
  grad.addColorStop(1, darken(color, 30));
  ctx.fillStyle = grad;
  ctx.fillRect(-hw, -hh + 15, PENCIL_W, hh * 2 - 15 - 12);

  // Tip (hexagonal cone)
  const tipY = hh - 12;
  ctx.fillStyle = "#d4a96a";
  ctx.beginPath();
  ctx.moveTo(-hw, tipY);
  ctx.lineTo(hw, tipY);
  ctx.lineTo(0, hh);
  ctx.closePath();
  ctx.fill();

  // Lead tip
  ctx.fillStyle = "#333";
  ctx.beginPath();
  ctx.moveTo(-3, hh - 5);
  ctx.lineTo(3, hh - 5);
  ctx.lineTo(0, hh);
  ctx.closePath();
  ctx.fill();

  // Shine
  ctx.fillStyle = "rgba(255,255,255,0.3)";
  ctx.fillRect(-hw + 2, -hh + 15, 4, hh * 2 - 27);

  ctx.restore();
}

function lighten(hex: string, amt: number): string {
  const num = parseInt(hex.slice(1), 16);
  const r = Math.min(255, (num >> 16) + amt);
  const g = Math.min(255, ((num >> 8) & 0xff) + amt);
  const b = Math.min(255, (num & 0xff) + amt);
  return `rgb(${r},${g},${b})`;
}
function darken(hex: string, amt: number): string {
  const num = parseInt(hex.slice(1), 16);
  const r = Math.max(0, (num >> 16) - amt);
  const g = Math.max(0, ((num >> 8) & 0xff) - amt);
  const b = Math.max(0, (num & 0xff) - amt);
  return `rgb(${r},${g},${b})`;
}

function drawObstacle(ctx: CanvasRenderingContext2D, obs: Obstacle) {
  const color = obs.color;
  // Top bar
  drawBar(ctx, obs.x, 0, OBSTACLE_WIDTH, obs.topH, color);
  // Bottom bar
  drawBar(ctx, obs.x, CANVAS_H - obs.botH, OBSTACLE_WIDTH, obs.botH, color);
}

function drawBar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  const grad = ctx.createLinearGradient(x, 0, x + w, 0);
  grad.addColorStop(0, lighten(color, 30));
  grad.addColorStop(0.5, color);
  grad.addColorStop(1, darken(color, 20));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, [0, 0, 6, 6]);
  ctx.fill();

  // pencil tip at bottom of top bar
  if (y === 0) {
    ctx.fillStyle = "#d4a96a";
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + w / 2, y + h + 14);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#333";
    ctx.beginPath();
    ctx.moveTo(x + w / 2 - 3, y + h + 10);
    ctx.lineTo(x + w / 2 + 3, y + h + 10);
    ctx.lineTo(x + w / 2, y + h + 14);
    ctx.closePath();
    ctx.fill();
  }
  // pencil tip at top of bottom bar
  if (y > 0) {
    ctx.fillStyle = "#d4a96a";
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w / 2, y - 14);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#333";
    ctx.beginPath();
    ctx.moveTo(x + w / 2 - 3, y - 10);
    ctx.lineTo(x + w / 2 + 3, y - 10);
    ctx.lineTo(x + w / 2, y - 14);
    ctx.closePath();
    ctx.fill();
  }
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<GameState>("idle");
  const rafRef = useRef<number>(0);

  // Game state (refs for the game loop, mirrored to React state for UI)
  const pencilY = useRef(CANVAS_H / 2 - PENCIL_H / 2);
  const velY = useRef(0);
  const speed = useRef(BASE_SPEED);
  const colorIdx = useRef(0);
  const obstacles = useRef<Obstacle[]>([]);
  const particles = useRef<Particle[]>([]);
  const trail = useRef<TrailDot[]>([]);
  const score = useRef(0);
  const frameCount = useRef(0);
  const wobble = useRef(0);
  const bgColorT = useRef(0);
  const bgColorFrom = useRef(0);
  const bgColorTo = useRef(0);
  const dead = useRef(false);

  const [uiScore, setUiScore] = useState(0);
  const [gameState, setGameState] = useState<GameState>("idle");
  const [bestScore, setBestScore] = useState(() => {
    return parseInt(localStorage.getItem("pencilrun_best") || "0", 10);
  });
  const [currentColor, setCurrentColor] = useState(PENCIL_COLORS[0]);

  // ── Spawn particles ──────────────────────────────────────────────────────
  const spawnParticles = useCallback((x: number, y: number, color: string, count = 10) => {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
      const spd = 2 + Math.random() * 4;
      particles.current.push({
        x, y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        life: 1, maxLife: 1,
        color,
        size: 4 + Math.random() * 6,
      });
    }
  }, []);

  // ── Reset game ───────────────────────────────────────────────────────────
  const resetGame = useCallback(() => {
    pencilY.current = CANVAS_H / 2 - PENCIL_H / 2;
    velY.current = 0;
    speed.current = BASE_SPEED;
    colorIdx.current = 0;
    obstacles.current = [];
    particles.current = [];
    trail.current = [];
    score.current = 0;
    frameCount.current = 0;
    wobble.current = 0;
    bgColorT.current = 1;
    bgColorFrom.current = 0;
    bgColorTo.current = 0;
    dead.current = false;
    setUiScore(0);
    setCurrentColor(PENCIL_COLORS[0]);
  }, []);

  // ── Jump ─────────────────────────────────────────────────────────────────
  const jump = useCallback(() => {
    if (stateRef.current === "idle") {
      stateRef.current = "playing";
      setGameState("playing");
      velY.current = JUMP_VEL;
      return;
    }
    if (stateRef.current === "dead") {
      resetGame();
      stateRef.current = "playing";
      setGameState("playing");
      return;
    }
    if (stateRef.current === "playing") {
      velY.current = JUMP_VEL;
      wobble.current = -0.25;
      spawnParticles(
        PENCIL_X + PENCIL_W / 2,
        pencilY.current + PENCIL_H / 2,
        TRAIL_COLORS[colorIdx.current],
        5
      );
    }
  }, [resetGame, spawnParticles]);

  // ── Input handlers ───────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowUp") { e.preventDefault(); jump(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [jump]);

  // ── Game loop ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    function spawnObstacle() {
      const minH = 60;
      const maxH = CANVAS_H - OBSTACLE_GAP - minH;
      const topH = minH + Math.random() * (maxH - minH);
      const botH = CANVAS_H - topH - OBSTACLE_GAP;
      const ci = Math.floor(Math.random() * PENCIL_COLORS.length);
      obstacles.current.push({
        x: CANVAS_W + OBSTACLE_WIDTH,
        topH,
        botH,
        color: PENCIL_COLORS[ci],
        passed: false,
      });
    }

    function checkCollision(): boolean {
      const px = PENCIL_X + 4;
      const py = pencilY.current + 4;
      const pw = PENCIL_W - 8;
      const ph = PENCIL_H - 8;

      if (py < 0 || py + ph > CANVAS_H) return true;

      for (const obs of obstacles.current) {
        const ox = obs.x;
        const ow = OBSTACLE_WIDTH;
        if (px + pw > ox && px < ox + ow) {
          if (py < obs.topH + 14 || py + ph > CANVAS_H - obs.botH - 14) return true;
        }
      }
      return false;
    }

    function update() {
      if (stateRef.current !== "playing") return;

      frameCount.current++;
      speed.current = BASE_SPEED + frameCount.current * SPEED_INC;

      // Physics
      velY.current += GRAVITY;
      pencilY.current += velY.current;

      // Wobble decay
      wobble.current = lerp(wobble.current, 0, 0.12);

      // Trail
      trail.current.push({
        x: PENCIL_X + PENCIL_W / 2,
        y: pencilY.current + PENCIL_H,
        color: TRAIL_COLORS[colorIdx.current],
        alpha: 0.7,
      });
      if (trail.current.length > 120) trail.current.shift();
      trail.current.forEach(d => { d.alpha *= 0.97; });

      // Obstacles
      if (frameCount.current % 90 === 0) spawnObstacle();
      obstacles.current.forEach(o => { o.x -= speed.current; });
      obstacles.current = obstacles.current.filter(o => o.x > -OBSTACLE_WIDTH - 20);

      // Score & color change
      for (const obs of obstacles.current) {
        if (!obs.passed && obs.x + OBSTACLE_WIDTH < PENCIL_X) {
          obs.passed = true;
          score.current++;
          setUiScore(score.current);

          // Change pencil color on pass
          const next = (colorIdx.current + 1) % PENCIL_COLORS.length;
          colorIdx.current = next;
          setCurrentColor(PENCIL_COLORS[next]);
          bgColorFrom.current = bgColorTo.current;
          bgColorTo.current = next;
          bgColorT.current = 0;

          spawnParticles(
            PENCIL_X + PENCIL_W / 2,
            pencilY.current + PENCIL_H / 2,
            TRAIL_COLORS[next],
            14
          );
        }
      }

      bgColorT.current = Math.min(1, bgColorT.current + 0.04);

      // Particles
      particles.current.forEach(p => {
        p.x += p.vx; p.y += p.vy;
        p.vy += 0.1;
        p.life -= 0.025;
      });
      particles.current = particles.current.filter(p => p.life > 0);

      // Collision
      if (checkCollision()) {
        dead.current = true;
        stateRef.current = "dead";
        setGameState("dead");
        spawnParticles(PENCIL_X + PENCIL_W / 2, pencilY.current + PENCIL_H / 2, PENCIL_COLORS[colorIdx.current], 24);
        const best = parseInt(localStorage.getItem("pencilrun_best") || "0", 10);
        if (score.current > best) {
          localStorage.setItem("pencilrun_best", String(score.current));
          setBestScore(score.current);
        }
      }
    }

    function lerpColor(c1: string, c2: string, t: number): string {
      const hex = (h: string) => {
        const n = parseInt(h.slice(1), 16);
        return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
      };
      const [r1,g1,b1] = hex(c1);
      const [r2,g2,b2] = hex(c2);
      return `rgb(${Math.round(lerp(r1,r2,t))},${Math.round(lerp(g1,g2,t))},${Math.round(lerp(b1,b2,t))})`;
    }

    function draw() {
      // Background
      const bgFrom = BG_COLORS[bgColorFrom.current] || BG_COLORS[0];
      const bgTo   = BG_COLORS[bgColorTo.current]   || BG_COLORS[0];
      const bg = lerpColor(bgFrom, bgTo, bgColorT.current);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      // Subtle grid lines
      ctx.strokeStyle = "rgba(0,0,0,0.04)";
      ctx.lineWidth = 1;
      for (let y = 0; y < CANVAS_H; y += 40) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CANVAS_W, y); ctx.stroke();
      }

      // Trail
      trail.current.forEach((d, i) => {
        const size = 4 + (i / trail.current.length) * 6;
        ctx.globalAlpha = d.alpha * (i / trail.current.length);
        ctx.fillStyle = d.color;
        ctx.beginPath();
        ctx.arc(d.x, d.y, size / 2, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;

      // Obstacles
      obstacles.current.forEach(o => drawObstacle(ctx, o));

      // Pencil
      if (!dead.current) {
        drawPencil(ctx, PENCIL_X, pencilY.current, PENCIL_COLORS[colorIdx.current], wobble.current);
      }

      // Particles
      particles.current.forEach(p => {
        ctx.globalAlpha = p.life / p.maxLife;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (p.life / p.maxLife), 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;

      // Score HUD
      ctx.fillStyle = "rgba(0,0,0,0.12)";
      ctx.font = "bold 28px Fraunces, serif";
      ctx.textAlign = "center";
      ctx.fillText(String(score.current), CANVAS_W / 2, 44);
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.fillText(String(score.current), CANVAS_W / 2, 42);

      // Idle screen
      if (stateRef.current === "idle") {
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        ctx.fillStyle = "#fff";
        ctx.font = "bold 38px Fraunces, serif";
        ctx.textAlign = "center";
        ctx.fillText("Colour Pencil Run", CANVAS_W / 2, CANVAS_H / 2 - 40);
        ctx.font = "18px Manrope, sans-serif";
        ctx.fillText("Tap / Space to start", CANVAS_W / 2, CANVAS_H / 2 + 10);
        ctx.font = "14px Manrope, sans-serif";
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.fillText("Dodge the pencil bars & change colour!", CANVAS_W / 2, CANVAS_H / 2 + 40);
      }

      // Dead screen
      if (stateRef.current === "dead" && particles.current.length < 8) {
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        ctx.fillStyle = "#fff";
        ctx.font = "bold 36px Fraunces, serif";
        ctx.textAlign = "center";
        ctx.fillText("Oops! 💥", CANVAS_W / 2, CANVAS_H / 2 - 55);
        ctx.font = "bold 48px Fraunces, serif";
        ctx.fillStyle = PENCIL_COLORS[colorIdx.current];
        ctx.fillText(String(score.current), CANVAS_W / 2, CANVAS_H / 2 - 5);
        ctx.font = "16px Manrope, sans-serif";
        ctx.fillStyle = "#fff";
        ctx.fillText("score", CANVAS_W / 2, CANVAS_H / 2 + 22);
        ctx.font = "14px Manrope, sans-serif";
        ctx.fillStyle = "rgba(255,255,255,0.75)";
        ctx.fillText(`Best: ${Math.max(score.current, parseInt(localStorage.getItem("pencilrun_best")||"0",10))}`, CANVAS_W / 2, CANVAS_H / 2 + 50);
        ctx.fillStyle = "#fff";
        ctx.font = "bold 16px Manrope, sans-serif";
        ctx.fillText("Tap / Space to try again", CANVAS_W / 2, CANVAS_H / 2 + 86);
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
      <div className="flex flex-col items-center gap-4 select-none">
        {/* Header */}
        <div className="flex items-center gap-3 w-full max-w-xl">
          <div className="flex gap-1.5">
            {PENCIL_COLORS.map((c, i) => (
              <div
                key={i}
                className="rounded-full transition-all duration-300"
                style={{
                  width: c === currentColor ? 14 : 8,
                  height: c === currentColor ? 14 : 8,
                  background: c,
                  opacity: c === currentColor ? 1 : 0.4,
                  marginTop: c === currentColor ? 0 : 3,
                }}
              />
            ))}
          </div>
          <div className="flex-1" />
          <div className="text-sm font-bold" style={{ color: "var(--muted)" }}>
            Best: <span style={{ color: "var(--ink)" }}>{bestScore}</span>
          </div>
        </div>

        {/* Canvas */}
        <div
          className="relative rounded-2xl overflow-hidden shadow-2xl cursor-pointer"
          style={{ border: `3px solid ${currentColor}`, transition: "border-color 0.4s" }}
          onClick={jump}
          onTouchStart={(e) => { e.preventDefault(); jump(); }}
        >
          <canvas
            ref={canvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            style={{ display: "block", maxWidth: "100%", maxHeight: "calc(100dvh - 160px)" }}
          />
        </div>

        {/* Controls hint */}
        {gameState === "playing" && (
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            Tap / Space to flap • Pass bars to change colour
          </p>
        )}
        {gameState === "idle" && (
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            Tap the canvas or press Space to start
          </p>
        )}
      </div>
    </Shell>
  );
}
