import { BROADCAST, broadcastAt, broadcastResult, broadcastTime, hash01, type Broadcast, type Goal, type Vec2 } from "@lagos-living/shared";

/**
 * The match on the viewing-centre screen, drawn like a TV feed from a raised camera on the halfway line. Every frame
 * comes from the wall clock and public seeds, so everyone in the hall sees the same pass, shot and goal.
 */
const LENGTH = 105;
const WIDTH = 68;

type Kit = { shirt: string; shorts: string; trim: string };
const KITS: Record<string, Kit> = {
  ars: { shirt: "#e0262b", shorts: "#ffffff", trim: "#ffffff" },
  mci: { shirt: "#8fc6ea", shorts: "#ffffff", trim: "#1c2c5b" },
  liv: { shirt: "#c8102e", shorts: "#c8102e", trim: "#f6eb61" },
  che: { shirt: "#1b4fb4", shorts: "#1b4fb4", trim: "#ffffff" },
  mun: { shirt: "#da291c", shorts: "#ffffff", trim: "#111111" },
  tot: { shirt: "#f4f4f4", shorts: "#132257", trim: "#132257" },
  new: { shirt: "#1a1a1a", shorts: "#1a1a1a", trim: "#ffffff" },
  avl: { shirt: "#7a1e3e", shorts: "#ffffff", trim: "#94bee5" },
  rma: { shirt: "#f7f7f7", shorts: "#f7f7f7", trim: "#d4af37" },
  bar: { shirt: "#a50044", shorts: "#004d98", trim: "#edbb00" },
  atm: { shirt: "#cb3524", shorts: "#1b3b8a", trim: "#ffffff" },
  bay: { shirt: "#dc052d", shorts: "#dc052d", trim: "#ffffff" },
  bvb: { shirt: "#fde100", shorts: "#111111", trim: "#111111" },
  psg: { shirt: "#004170", shorts: "#004170", trim: "#da291c" },
  int: { shirt: "#0a4fa3", shorts: "#111111", trim: "#111111" },
  juv: { shirt: "#f2f2f2", shorts: "#111111", trim: "#111111" },
  eny: { shirt: "#1d5fbf", shorts: "#ffffff", trim: "#ffffff" },
  rin: { shirt: "#d71920", shorts: "#ffffff", trim: "#ffffff" },
  rem: { shirt: "#6cc2ef", shorts: "#0d2a5c", trim: "#0d2a5c" },
  kan: { shirt: "#f4c20d", shorts: "#0b3d91", trim: "#0b3d91" },
};
const AWAY_ALT: Kit = { shirt: "#f5f5f5", shorts: "#222222", trim: "#222222" };
const AWAY_ALT_DARK: Kit = { shirt: "#1d1d26", shorts: "#1d1d26", trim: "#f2c94c" };

function rgb(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255] as const;
}

/** The away side changes strip when both shirts would read alike from the stands. */
export function kitsFor(home: string, away: string): { home: Kit; away: Kit } {
  const h = KITS[home] ?? AWAY_ALT;
  const a = KITS[away] ?? AWAY_ALT_DARK;
  const [r1, g1, b1] = rgb(h.shirt);
  const [r2, g2, b2] = rgb(a.shirt);
  if (Math.hypot(r1 - r2, g1 - g2, b1 - b2) > 140) return { home: h, away: a };
  const light = (r1 + g1 + b1) / 3 > 140;
  return { home: h, away: light ? AWAY_ALT_DARK : AWAY_ALT };
}

/** 4-4-2 in a side's own frame: x is metres from its own goal line. */
const SHAPE: Vec2[] = [[4, 34], [20, 10], [17, 26], [17, 42], [20, 58], [40, 12], [36, 28], [36, 40], [40, 56], [57, 27], [57, 41]];
const SQUAD_NUMBERS = [1, 2, 4, 5, 3, 7, 6, 8, 11, 9, 10];
const BEAT_MS = 1_150;

type Side = "home" | "away";
type Frame = { ball: { x: number; y: number; h: number }; players: Array<{ side: Side; x: number; y: number; no: number }> };

const firstHalfStart = BROADCAST.intro;
const secondHalfStart = BROADCAST.intro + BROADCAST.half + BROADCAST.interval;

/** +1 when `side` attacks the right-hand goal in the half being played at slot time `t`. */
const direction = (side: Side, t: number) => ((side === "home") === t < secondHalfStart ? 1 : -1);
const toPitch = (side: Side, t: number, x: number) => (direction(side, t) > 0 ? x : LENGTH - x);
const ease = (t: number) => t * t * (3 - 2 * t);
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Where the ball is played at beat `k` of the half: a side keeps it for a few beats and works it forward. */
function beatPoint(slot: number, half: number, k: number, homeShare: number, t: number) {
  const phase = Math.floor(k / 5);
  const key = `${slot}:${half}:${phase}`;
  const side: Side = hash01(`${key}:poss`) < homeShare ? "home" : "away";
  const start = 22 + hash01(`${key}:start`) * 34;
  const step = k % 5;
  let along = start;
  for (let index = 1; index <= step; index += 1) along += 3 + hash01(`${key}:adv:${index}`) * 11;
  const across = 8 + hash01(`${key}:${step}:y`) * (WIDTH - 16);
  return { side, x: toPitch(side, t, clamp(along, 6, 94)), y: across };
}

let cachedSlot = -1;
let cachedGoals: Array<Goal & { at: number }> = [];

/** Real ms of every goal in the match, scored or still to come, for the build-up and the celebration. */
function goalWindows(match: Broadcast) {
  if (cachedSlot !== match.slot) {
    cachedSlot = match.slot;
    cachedGoals = broadcastResult(match.slot).goals.map((goal) => ({ ...goal, at: broadcastTime(goal.minute) }));
  }
  return cachedGoals;
}

export function matchFrame(now: number, match: Broadcast = broadcastAt(now)): Frame {
  const t = now - match.startsAt;
  const homeShare = clamp(0.5 + (match.home.rating - match.away.rating) / 50, 0.3, 0.7);
  const playing = (t >= firstHalfStart && t < firstHalfStart + BROADCAST.half) || (t >= secondHalfStart && t < secondHalfStart + BROADCAST.half);
  let ball = { x: LENGTH / 2, y: WIDTH / 2, h: 0 };
  let carrier: Side | null = null;
  let celebrate: { side: Side; weight: number } | null = null;
  if (playing) {
    const half = t < secondHalfStart ? 0 : 1;
    const local = t - (half ? secondHalfStart : firstHalfStart);
    const k = Math.floor(local / BEAT_MS);
    const frac = ease((local % BEAT_MS) / BEAT_MS);
    const a = beatPoint(match.slot, half, k, homeShare, t);
    const b = beatPoint(match.slot, half, k + 1, homeShare, t);
    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    ball = { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac, h: distance > 20 ? Math.sin(Math.PI * frac) * distance * 0.12 : 0 };
    carrier = frac < 0.5 ? a.side : b.side;
    for (const goal of goalWindows(match)) {
      const into = t - goal.at;
      const shotSide = goal.side;
      const net = 105.6;
      const aim = 34 + (hash01(`${match.slot}:${goal.minute}:aim`) - 0.5) * 5.5;
      if (into > -3_400 && into <= 0) {
        // Build-up: worked into the box, then struck into the net.
        const lane = 34 + (hash01(`${match.slot}:${goal.minute}:lane`) - 0.5) * 30;
        const path: Array<[number, number, number]> = [[70, lane, 0], [84, lane * 0.6 + 34 * 0.4, 0], [92, 34 + (lane - 34) * 0.2, 0], [net, aim, 1.1]];
        const s = (into + 3_400) / 3_400;
        const seg = Math.min(path.length - 2, Math.floor(s * (path.length - 1)));
        const f = s * (path.length - 1) - seg;
        const [x0, y0] = path[seg]!;
        const [x1, y1, h1] = path[seg + 1]!;
        ball = { x: toPitch(shotSide, t, x0 + (x1 - x0) * f), y: y0 + (y1 - y0) * f, h: seg === path.length - 2 ? h1 * f : 0 };
        carrier = shotSide;
      } else if (into > 0 && into < 5_200) {
        const settle = Math.min(1, into / 500);
        ball = { x: toPitch(shotSide, t, net + 0.6 * settle), y: aim, h: 1.1 * (1 - settle) };
        celebrate = { side: shotSide, weight: Math.min(1, into / 1_200) * (into > 4_200 ? 1 - (into - 4_200) / 1_000 : 1) };
        carrier = null;
      } else if (into >= 5_200 && into < 6_200) {
        ball = { x: LENGTH / 2, y: WIDTH / 2, h: 0 };
        carrier = shotSide === "home" ? "away" : "home";
      }
    }
  }
  const players: Frame["players"] = [];
  for (const side of ["home", "away"] as const) {
    const dir = direction(side, t);
    const own = dir > 0 ? ball.x : LENGTH - ball.x;
    const shift = playing ? (own - 45) * 0.62 : 0;
    const squash = playing ? (ball.y - WIDTH / 2) * 0.3 : 0;
    let nearest = -1;
    let nearestDistance = Infinity;
    const placed = SHAPE.map(([bx, by], index) => {
      const wobble = playing ? Math.sin(now * 0.0011 + index * 1.7 + (side === "home" ? 0 : 3)) * 1.6 : 0;
      const x = index === 0 ? bx + Math.max(0, own - 55) * 0.1 : clamp(bx + shift, 8, 99) - (playing ? 0 : 6);
      const y = index === 0 ? WIDTH / 2 + (ball.y - WIDTH / 2) * 0.12 : by + squash + wobble;
      const pitchX = dir > 0 ? x : LENGTH - x;
      const distance = Math.hypot(pitchX - ball.x, y - ball.y);
      if (index > 0 && distance < nearestDistance) [nearest, nearestDistance] = [index, distance];
      return { x: pitchX, y };
    });
    placed.forEach((spot, index) => {
      let { x, y } = spot;
      if (index === nearest && playing && !celebrate) {
        // The nearest man to the ball is on it, or pressing whoever is.
        const off = carrier === side ? 0.7 : 2.1;
        const goalX = dir > 0 ? 0 : LENGTH;
        const back = Math.sign(goalX - ball.x) || 1;
        x = ball.x + back * off;
        y = ball.y + (carrier === side ? 0.2 : 0.8);
      }
      if (celebrate) {
        const corner: Vec2 = celebrate.side === side ? [toPitch(side, t, 97), 34 + ((index % 4) - 1.5) * 2.2] : [LENGTH / 2 + (dir > 0 ? -8 : 8) + (index % 3) * 2, 20 + index * 2.8];
        x += (corner[0] - x) * celebrate.weight;
        y += (corner[1] - y) * celebrate.weight;
      }
      players.push({ side, x, y, no: SQUAD_NUMBERS[index]! });
    });
  }
  return { ball, players };
}

const mmss = (ms: number) => {
  const seconds = Math.max(0, Math.ceil(ms / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Draws the broadcast at `now` onto a 16:9 canvas. */
export function drawBroadcast(ctx: CanvasRenderingContext2D, W: number, H: number, now: number) {
  const match = broadcastAt(now);
  const frame = matchFrame(now, match);
  const kits = kitsFor(match.home.id, match.away.id);
  // The camera follows the ball along the touchline, eased over the last second and a half.
  let follow = 0;
  for (let index = 0; index < 5; index += 1) follow += matchFrame(now - index * 350, match).ball.x;
  const cx = clamp(follow / 5, 30, LENGTH - 30);
  const far = H * 0.27;
  const near = H * 0.98;
  const project = (x: number, y: number, h = 0) => {
    const v = y / WIDTH;
    const k = (W / 44) * (1 - v) + (W / 74) * v;
    return { x: W / 2 + (x - cx) * k, y: near - (near - far) * v - h * k, k };
  };

  // Stands and crowd behind the far touchline.
  const stand = ctx.createLinearGradient(0, 0, 0, far);
  stand.addColorStop(0, "#0d1118");
  stand.addColorStop(1, "#262c38");
  ctx.fillStyle = stand;
  ctx.fillRect(0, 0, W, far + 2);
  for (let index = 0; index < 900; index += 1) {
    const wx = (hash01(`crowd:${index}:x`) * 220 - 57.5);
    const row = hash01(`crowd:${index}:y`);
    const px = W / 2 + (wx - cx) * (W / 80);
    if (px < -4 || px > W + 4) continue;
    const bob = Math.sin(now * 0.004 + index) * (match.lastGoal && match.lastGoal.ago < 5_000 ? 2.2 : 0.5);
    const shade = hash01(`crowd:${index}:c`);
    ctx.fillStyle = shade < 0.2 ? kits.home.shirt : shade < 0.36 ? kits.away.shirt : shade < 0.7 ? "#3a3f4b" : "#6b6f7a";
    ctx.fillRect(px, 8 + row * (far - 26) + bob, 3, 3);
  }
  // Advertising boards.
  ctx.fillStyle = "#0f3d8a";
  ctx.fillRect(0, far - 12, W, 12);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 9px sans-serif";
  for (let x = -((cx * 9) % 160); x < W; x += 160) ctx.fillText("LAGOS LIVING  ·  EKO BET  ·  ", x, far - 3);

  // Grass in mown stripes.
  for (let stripe = 0; stripe < 14; stripe += 1) {
    const x0 = stripe * 7.5;
    const x1 = x0 + 7.5;
    const a = project(x0, 0);
    const b = project(x1, 0);
    const c = project(x1, WIDTH);
    const d = project(x0, WIDTH);
    ctx.fillStyle = stripe % 2 ? "#2f8a3a" : "#37994a";
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.closePath();
    ctx.fill();
  }
  const runOff = (side: number) => {
    const edge = side < 0 ? 0 : LENGTH;
    const out = edge + side * 8;
    const a = project(edge, 0);
    const b = project(out, 0);
    const c = project(out, WIDTH);
    const d = project(edge, WIDTH);
    ctx.fillStyle = "#2a7c34";
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.fill();
  };
  runOff(-1);
  runOff(1);

  // Markings.
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 1.6;
  const line = (points: Array<[number, number]>, close = false) => {
    ctx.beginPath();
    points.forEach(([x, y], index) => {
      const p = project(x, y);
      if (index) ctx.lineTo(p.x, p.y);
      else ctx.moveTo(p.x, p.y);
    });
    if (close) ctx.closePath();
    ctx.stroke();
  };
  line([[0, 0], [LENGTH, 0], [LENGTH, WIDTH], [0, WIDTH]], true);
  line([[LENGTH / 2, 0], [LENGTH / 2, WIDTH]]);
  line(Array.from({ length: 33 }, (_, index) => [LENGTH / 2 + Math.cos((index / 32) * Math.PI * 2) * 9.15, WIDTH / 2 + Math.sin((index / 32) * Math.PI * 2) * 9.15] as [number, number]));
  for (const end of [0, LENGTH]) {
    const s = end ? -1 : 1;
    line([[end, 13.85], [end + s * 16.5, 13.85], [end + s * 16.5, 54.15], [end, 54.15]]);
    line([[end, 24.85], [end + s * 5.5, 24.85], [end + s * 5.5, 43.15], [end, 43.15]]);
  }

  // Goals: posts and crossbar, net behind.
  const goal = (end: number) => {
    const s = end ? 1 : -1;
    const posts = [30.34, 37.66];
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1;
    for (let index = 0; index <= 6; index += 1) {
      const y = posts[0]! + ((posts[1]! - posts[0]!) * index) / 6;
      const a = project(end, y, 2.44);
      const b = project(end + s * 2, y, 0);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2.2;
    const [l, r] = posts.map((y) => [project(end, y, 0), project(end, y, 2.44)] as const);
    ctx.beginPath();
    ctx.moveTo(l![0].x, l![0].y);
    ctx.lineTo(l![1].x, l![1].y);
    ctx.lineTo(r![1].x, r![1].y);
    ctx.lineTo(r![0].x, r![0].y);
    ctx.stroke();
  };
  goal(0);
  goal(LENGTH);

  // Players and ball, far side first.
  type Sprite = { y: number; draw: () => void };
  const sprites: Sprite[] = frame.players.map((player) => ({
    y: player.y,
    draw: () => {
      const p = project(player.x, player.y);
      const kit = kits[player.side];
      const h = 1.85 * p.k;
      const stride = Math.sin(now * 0.016 + player.no * 2.1) * h * 0.12;
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, h * 0.28, h * 0.08, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#2b1d14";
      ctx.lineWidth = Math.max(1.2, h * 0.09);
      ctx.beginPath();
      ctx.moveTo(p.x - h * 0.06, p.y - h * 0.42);
      ctx.lineTo(p.x - h * 0.06 + stride, p.y);
      ctx.moveTo(p.x + h * 0.06, p.y - h * 0.42);
      ctx.lineTo(p.x + h * 0.06 - stride, p.y);
      ctx.stroke();
      ctx.fillStyle = kit.shorts;
      ctx.fillRect(p.x - h * 0.13, p.y - h * 0.55, h * 0.26, h * 0.16);
      ctx.fillStyle = kit.shirt;
      ctx.fillRect(p.x - h * 0.15, p.y - h * 0.86, h * 0.3, h * 0.33);
      ctx.fillStyle = kit.trim;
      ctx.fillRect(p.x - h * 0.15, p.y - h * 0.86, h * 0.3, h * 0.04);
      ctx.fillStyle = "#4a3022";
      ctx.beginPath();
      ctx.arc(p.x, p.y - h * 0.94, h * 0.09, 0, Math.PI * 2);
      ctx.fill();
    },
  }));
  sprites.push({
    y: frame.ball.y,
    draw: () => {
      const ground = project(frame.ball.x, frame.ball.y);
      const air = project(frame.ball.x, frame.ball.y, frame.ball.h + 0.11);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath();
      ctx.ellipse(ground.x, ground.y, 0.25 * ground.k, 0.08 * ground.k, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "rgba(20,20,20,0.8)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(air.x, air.y, Math.max(2.8, 0.2 * air.k), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    },
  });
  sprites.sort((a, b) => b.y - a.y);
  for (const sprite of sprites) sprite.draw();

  // Score bug, top left.
  const minute = match.phase === "half" ? "HT" : match.phase === "full" ? "FT" : match.phase === "pre" ? "0'" : `${Math.min(90, Math.floor(match.minute) + 1)}'`;
  roundRect(ctx, 14, 12, 250, 30, 6);
  ctx.fillStyle = "rgba(10,14,24,0.88)";
  ctx.fill();
  ctx.fillStyle = kits.home.shirt;
  ctx.fillRect(20, 18, 6, 18);
  ctx.fillStyle = kits.away.shirt;
  ctx.fillRect(164, 18, 6, 18);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 16px sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText(match.home.short, 32, 27);
  ctx.fillText(match.away.short, 176, 27);
  ctx.fillStyle = "#f2c94c";
  ctx.fillRect(84, 15, 70, 24);
  ctx.fillStyle = "#111111";
  ctx.textAlign = "center";
  ctx.fillText(`${match.score.home} - ${match.score.away}`, 119, 27);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 13px sans-serif";
  ctx.fillText(minute, 238, 27);
  ctx.textAlign = "left";

  // Live tag and competition, top right.
  roundRect(ctx, W - 170, 12, 156, 30, 6);
  ctx.fillStyle = "rgba(10,14,24,0.88)";
  ctx.fill();
  ctx.fillStyle = "#e5322d";
  roundRect(ctx, W - 164, 18, 40, 18, 3);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 11px sans-serif";
  ctx.fillText("LIVE", W - 157, 27);
  ctx.font = "12px sans-serif";
  ctx.fillText(match.league, W - 116, 27);

  // Ticker along the bottom.
  ctx.fillStyle = "rgba(10,14,24,0.82)";
  ctx.fillRect(0, H - 24, W, 24);
  ctx.fillStyle = "#f2c94c";
  ctx.font = "bold 12px sans-serif";
  ctx.fillText("UP NEXT", 12, H - 12);
  ctx.fillStyle = "#ffffff";
  ctx.font = "12px sans-serif";
  ctx.fillText(`${match.next.home.name} v ${match.next.away.name} · ${match.next.league} · kick-off in ${mmss(match.endsAt - now)}`, 76, H - 12);

  // Full-screen cards: walk-out, goal, half-time and full-time.
  const card = (title: string, lines: string[], accent: string) => {
    const w = Math.min(W - 80, 420);
    const h = 56 + lines.length * 22;
    const x = (W - w) / 2;
    const y = H * 0.36 - h / 2;
    roundRect(ctx, x, y, w, h, 10);
    ctx.fillStyle = "rgba(8,12,22,0.9)";
    ctx.fill();
    ctx.fillStyle = accent;
    ctx.fillRect(x, y, w, 5);
    ctx.textAlign = "center";
    ctx.fillStyle = accent;
    ctx.font = "bold 26px sans-serif";
    ctx.fillText(title, W / 2, y + 32);
    ctx.fillStyle = "#ffffff";
    ctx.font = "15px sans-serif";
    lines.forEach((text, index) => ctx.fillText(text, W / 2, y + 62 + index * 22));
    ctx.textAlign = "left";
  };
  const t = now - match.startsAt;
  const result = `${match.home.name} ${match.score.home} - ${match.score.away} ${match.away.name}`;
  if (match.phase === "pre") card("KICK-OFF", [`${match.home.name} v ${match.away.name}`, match.league], "#f2c94c");
  else if (match.phase === "half") card("HALF-TIME", [result], "#8fd3ff");
  else if (match.phase === "full") card("FULL-TIME", [result, `Next: ${match.next.home.short} v ${match.next.away.short} in ${mmss(match.endsAt - now)}`], "#8fd3ff");
  else if (match.lastGoal && match.lastGoal.ago < 4_200) {
    const scorer = match.lastGoal.side === "home" ? match.home : match.away;
    const flash = t % 400 < 200 ? "#f2c94c" : "#ffffff";
    card("GOAL!", [`${scorer.name} · ${match.lastGoal.minute}'`, result], flash);
  }
}
