import { useEffect, useState } from "react";
import { COLOURS, HOME_COLUMN, SAFE, TRACK, bestMove, cellOf, current, move, movable, newGame, roll, startOf, type LudoState, type Seat } from "./ludo";

const YOU: Seat = 0;
const DICE = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
const YARD_CORNER: Record<Seat, [number, number]> = { 0: [0, 0], 1: [9, 0], 2: [9, 9], 3: [0, 9] };

/** Ludo against the computer (one or three opponents). Just for fun: no game naira is staked. */
export function LudoGame() {
  const [state, setState] = useState<LudoState | null>(null);
  const [rolling, setRolling] = useState(false);
  const seat = state ? current(state) : YOU;
  const yourTurn = state !== null && seat === YOU && state.winner === null;

  useEffect(() => {
    if (!state || state.winner !== null || seat === YOU) return;
    const timer = window.setTimeout(() => {
      if (state.dice === null) setState(roll(state, 1 + Math.floor(Math.random() * 6)));
      else {
        const pick = bestMove(state);
        if (pick !== null) setState(move(state, pick));
      }
    }, state.dice === null ? 750 : 650);
    return () => window.clearTimeout(timer);
  }, [state, seat]);

  if (!state) {
    return (
      <div className="game-start">
        <p>Classic Ludo: roll a 6 to come out, land on others to send them home, get all four tokens to the centre.</p>
        <div className="row">
          <button className="primary" onClick={() => setState(newGame([0, 2]))}>1 vs computer</button>
          <button onClick={() => setState(newGame([0, 1, 2, 3]))}>4 players (3 computer)</button>
        </div>
      </div>
    );
  }

  const options = yourTurn ? movable(state) : [];
  const doRoll = () => {
    if (!yourTurn || state.dice !== null || rolling) return;
    setRolling(true);
    window.setTimeout(() => {
      setRolling(false);
      setState((latest) => (latest ? roll(latest, 1 + Math.floor(Math.random() * 6)) : latest));
    }, 350);
  };
  const stacks = new Map<string, number>();
  const tokens = state.players.flatMap((owner) =>
    state.tokens[owner].map((progress, index) => {
      const [c, r] = cellOf(owner, progress, index);
      const key = `${c},${r}`;
      const order = stacks.get(key) ?? 0;
      stacks.set(key, order + 1);
      return { owner, index, progress, x: c + 0.5 + (progress >= 0 ? order * 0.16 - 0.12 : 0), y: r + 0.5 - (progress >= 0 ? order * 0.12 : 0) };
    }),
  );

  return (
    <div className="ludo">
      <svg viewBox="0 0 15 15" className="ludo-board" role="img" aria-label="Ludo board">
        <rect width="15" height="15" fill="#f7f3ea" />
        {([0, 1, 2, 3] as Seat[]).map((owner) => {
          const [x, y] = YARD_CORNER[owner];
          return (
            <g key={owner} opacity={state.players.includes(owner) ? 1 : 0.35}>
              <rect x={x} y={y} width="6" height="6" fill={COLOURS[owner].fill} />
              <rect x={x + 0.8} y={y + 0.8} width="4.4" height="4.4" rx="0.4" fill="#fff" />
              {HOME_COLUMN[owner].map(([c, r]) => <rect key={`${c}-${r}`} x={c} y={r} width="1" height="1" fill={COLOURS[owner].fill} stroke="#7a7466" strokeWidth="0.03" />)}
            </g>
          );
        })}
        {TRACK.map(([c, r], index) => {
          const starter = ([0, 1, 2, 3] as Seat[]).find((owner) => startOf(owner) === index);
          return (
            <g key={index}>
              <rect x={c} y={r} width="1" height="1" fill={starter !== undefined ? COLOURS[starter].fill : "#fff"} stroke="#7a7466" strokeWidth="0.03" />
              {SAFE.has(index) && starter === undefined && <text x={c + 0.5} y={r + 0.72} fontSize="0.62" textAnchor="middle" fill="#9a927f">★</text>}
            </g>
          );
        })}
        <polygon points="6,6 9,6 7.5,7.5" fill={COLOURS[1].fill} />
        <polygon points="9,6 9,9 7.5,7.5" fill={COLOURS[2].fill} />
        <polygon points="9,9 6,9 7.5,7.5" fill={COLOURS[3].fill} />
        <polygon points="6,9 6,6 7.5,7.5" fill={COLOURS[0].fill} />
        {tokens.map((token) => {
          const pickable = token.owner === YOU && options.includes(token.index);
          return (
            <g key={`${token.owner}-${token.index}`} onClick={() => pickable && setState(move(state, token.index))} style={{ cursor: pickable ? "pointer" : "default" }}>
              {pickable && <circle cx={token.x} cy={token.y} r="0.48" fill="none" stroke="#111" strokeWidth="0.08" className="ludo-pick" />}
              <circle cx={token.x} cy={token.y} r="0.34" fill={COLOURS[token.owner].fill} stroke="#222" strokeWidth="0.07" />
              <circle cx={token.x - 0.08} cy={token.y - 0.1} r="0.1" fill="rgba(255,255,255,0.6)" />
            </g>
          );
        })}
      </svg>
      <div className="ludo-bar">
        <span className="ludo-turn" style={{ color: COLOURS[seat].fill }}>
          {state.winner !== null ? `${COLOURS[state.winner].name} wins` : seat === YOU ? "Your turn (Red)" : `${COLOURS[seat].name} (computer)`}
        </span>
        <span className="ludo-dice" aria-label="Dice">{rolling ? "🎲" : state.dice ? DICE[state.dice] : ""}</span>
        {state.winner === null ? (
          <button className="primary" disabled={!yourTurn || state.dice !== null || rolling} onClick={doRoll}>Roll</button>
        ) : (
          <button className="primary" onClick={() => setState(null)}>New game</button>
        )}
      </div>
      <p className="muted small">{state.log}{yourTurn && options.length > 0 ? " Tap a ringed token to move it." : ""}</p>
      {state.winner === null && <button className="link-button small" onClick={() => setState(null)}>Quit game</button>}
    </div>
  );
}
