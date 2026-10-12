import { useEffect, useRef, useState } from "react";
import { H, POCKETS, R, W, computerShot, groupOf, moving, rack, settle, step, strike, target, type PoolState, type ShotResult } from "./pool";

const NAMES: [string, string] = ["You", "Computer"];
const COLOURS = ["#fff", "#f2c230", "#2f5fd0", "#d83a2e", "#6b3fa0", "#f07f22", "#1f8a4c", "#7a2230", "#111"];
const colourOf = (id: number) => COLOURS[id > 8 ? id - 8 : id]!;
const RAIL = 9;

/** Eight-ball against the computer on the phone. Just for fun: no game naira is staked. */
export function PoolGame() {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const game = useRef<PoolState>(rack());
  const shot = useRef<ShotResult | null>(null);
  const [view, setView] = useState(() => ({ ...game.current }));
  const [aim, setAim] = useState(0);
  const [power, setPower] = useState(0.6);
  const [rolling, setRolling] = useState(false);
  const state = view;
  const yourTurn = state.turn === 0 && state.winner === null && !rolling;

  const draw = (aimAngle: number | null) => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    const scale = element.width / (W + RAIL * 2);
    context.setTransform(scale, 0, 0, scale, RAIL * scale, RAIL * scale);
    context.fillStyle = "#5a3418";
    context.fillRect(-RAIL, -RAIL, W + RAIL * 2, H + RAIL * 2);
    context.fillStyle = "#0f7a43";
    context.fillRect(0, 0, W, H);
    context.strokeStyle = "rgba(255,255,255,0.18)";
    context.lineWidth = 0.4;
    context.beginPath();
    context.moveTo(W * 0.25, 0);
    context.lineTo(W * 0.25, H);
    context.stroke();
    context.fillStyle = "#050505";
    for (const [px, py] of POCKETS) {
      context.beginPath();
      context.arc(px, py, 5.4, 0, Math.PI * 2);
      context.fill();
    }
    const cue = game.current.balls[0]!;
    if (aimAngle !== null && !cue.potted) {
      context.strokeStyle = "rgba(255,255,255,0.75)";
      context.setLineDash([2, 2]);
      context.lineWidth = 0.5;
      context.beginPath();
      context.moveTo(cue.x, cue.y);
      context.lineTo(cue.x + Math.cos(aimAngle) * 70, cue.y + Math.sin(aimAngle) * 70);
      context.stroke();
      context.setLineDash([]);
      context.strokeStyle = "#e8c48a";
      context.lineWidth = 1.4;
      const back = 4 + power * 10;
      context.beginPath();
      context.moveTo(cue.x - Math.cos(aimAngle) * back, cue.y - Math.sin(aimAngle) * back);
      context.lineTo(cue.x - Math.cos(aimAngle) * (back + 60), cue.y - Math.sin(aimAngle) * (back + 60));
      context.stroke();
    }
    for (const ball of game.current.balls) {
      if (ball.potted) continue;
      context.fillStyle = ball.id > 8 ? "#fff" : colourOf(ball.id);
      context.beginPath();
      context.arc(ball.x, ball.y, R, 0, Math.PI * 2);
      context.fill();
      if (ball.id > 8) {
        context.save();
        context.beginPath();
        context.arc(ball.x, ball.y, R, 0, Math.PI * 2);
        context.clip();
        context.fillStyle = colourOf(ball.id);
        context.fillRect(ball.x - R, ball.y - R * 0.55, R * 2, R * 1.1);
        context.restore();
      }
      context.fillStyle = "rgba(255,255,255,0.45)";
      context.beginPath();
      context.arc(ball.x - R * 0.35, ball.y - R * 0.35, R * 0.3, 0, Math.PI * 2);
      context.fill();
    }
  };

  useEffect(() => {
    if (!rolling) draw(state.winner === null ? aim : null);
  });

  const shoot = (angle: number, strength: number) => {
    shot.current = { firstHit: null, potted: [] };
    strike(game.current, angle, strength);
    setRolling(true);
    let frame = 0;
    const tick = () => {
      step(game.current, shot.current!);
      draw(null);
      frame += 1;
      if (moving(game.current) && frame < 4000) {
        requestAnimationFrame(tick);
        return;
      }
      game.current = settle(game.current, shot.current!, NAMES);
      setRolling(false);
      setView({ ...game.current });
    };
    requestAnimationFrame(tick);
  };

  useEffect(() => {
    if (state.turn !== 1 || state.winner !== null || rolling) return;
    const plan = computerShot(game.current);
    const show = window.setTimeout(() => setAim(plan.angle), 500);
    const go = window.setTimeout(() => shoot(plan.angle, plan.power), 1300);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(go);
    };
  }, [state, rolling]);

  const aimAt = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!yourTurn || !canvas.current) return;
    const rect = canvas.current.getBoundingClientRect();
    const scale = rect.width / (W + RAIL * 2);
    const x = (event.clientX - rect.left) / scale - RAIL;
    const y = (event.clientY - rect.top) / scale - RAIL;
    const cue = game.current.balls[0]!;
    setAim(Math.atan2(y - cue.y, x - cue.x));
  };
  const restart = () => {
    game.current = rack();
    setView({ ...game.current });
    setAim(0);
  };
  const groupLabel = (side: 0 | 1) => {
    const wanted = target(state, side);
    return wanted === "open" ? "open table" : wanted === "eight" ? "on the black" : wanted;
  };
  const left = (side: 0 | 1) => {
    const group = state.groups[side];
    return group ? state.balls.filter((ball) => !ball.potted && groupOf(ball.id) === group).length : 7;
  };

  return (
    <div className="pool">
      <canvas
        ref={canvas}
        width={680}
        height={Math.round((680 * (H + RAIL * 2)) / (W + RAIL * 2))}
        className="pool-table"
        onPointerDown={aimAt}
        onPointerMove={(event) => event.buttons && aimAt(event)}
      />
      <div className="pool-score">
        <span className={state.turn === 0 ? "on" : ""}>You · {groupLabel(0)} · {left(0)} left</span>
        <span className={state.turn === 1 ? "on" : ""}>Computer · {groupLabel(1)} · {left(1)} left</span>
      </div>
      {state.winner === null ? (
        <div className="pool-controls">
          <label>
            Power
            <input type="range" min={0.05} max={1} step={0.01} value={power} disabled={!yourTurn} onChange={(event) => setPower(Number(event.target.value))} />
          </label>
          <button className="primary" disabled={!yourTurn} onClick={() => shoot(aim, power)}>{rolling ? "…" : state.turn === 1 ? "Computer aiming" : "Shoot"}</button>
        </div>
      ) : (
        <button className="primary" onClick={restart}>New game</button>
      )}
      <p className="muted small">{state.log} {yourTurn ? "Tap or drag on the table to aim." : ""}</p>
      {state.winner === null && <button className="link-button small" onClick={restart}>Re-rack</button>}
    </div>
  );
}
