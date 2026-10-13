import { FOOTBALL, FOOTBALL_KITS, FOOTBALL_TEAMS, type FootballState, type FootballTeam } from "@lagos-living/shared";
import { useEffect, useState } from "react";
import { naira } from "../api";
import type { GameEngine } from "../game/engine";

type Props = {
  engine: GameEngine;
  state: FootballState;
  selfId: string | null;
  pitchName: string;
  balance: number;
  onClose: () => void;
};

const clock = (ms: number) => {
  const seconds = Math.max(0, Math.ceil(ms / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

/** At the cage: who is on each side, the stake and pot, and joining a side or kicking off. */
export function StreetFootballSheet({ engine, state, selfId, pitchName, balance, onClose }: Props) {
  const [stake, setStake] = useState<number>(FOOTBALL.stakes[1]);
  const me = state.players.find((player) => player.sessionId === selfId);
  const open = state.phase !== "finished";
  const agreed = state.players.length > 0;
  const cost = agreed ? state.stake : stake;
  const both = FOOTBALL_TEAMS.every((team) => state.players.some((player) => player.team === team));
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section className="sheet football-sheet" role="dialog" aria-label={pitchName} onClick={(event) => event.stopPropagation()}>
        <header className="sheet-header">
          <div>
            <p className="eyebrow">⚽ Street football · five-a-side</p>
            <h2>{pitchName}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <p className="muted small">
          First to {FOOTBALL.goalsToWin} or the better side after {FOOTBALL.matchMs / 60_000} minutes takes the pot. A draw gives every stake back. The first player on each side keeps goal.
        </p>
        <div className="football-pot">
          <span>Stake <strong>{cost ? naira(cost) : "Free"}</strong></span>
          <span>Pot <strong>{naira(state.pot)}</strong></span>
          <span>{state.phase === "playing" ? `Live · ${state.score.green}–${state.score.gold}` : state.phase === "finished" ? "Full time" : "Waiting to kick off"}</span>
        </div>
        {!agreed && !me && (
          <div className="football-stakes" role="radiogroup" aria-label="Stake per player">
            {FOOTBALL.stakes.map((option) => (
              <button key={option} className={`chip${option === stake ? " selected" : ""}`} onClick={() => setStake(option)} role="radio" aria-checked={option === stake}>
                {option ? naira(option) : "Free"}
              </button>
            ))}
          </div>
        )}
        <div className="football-sides">
          {FOOTBALL_TEAMS.map((team) => {
            const kit = FOOTBALL_KITS[team];
            const side = state.players.filter((player) => player.team === team);
            const full = side.length >= FOOTBALL.teamMax;
            return (
              <div key={team} className="football-side" style={{ borderColor: kit.shirt }}>
                <h3>
                  <i className="kit-swatch" style={{ background: `linear-gradient(${kit.shirt} 60%, ${kit.shorts} 60%)` }} /> {kit.name}
                  <small>{side.length}/{FOOTBALL.teamMax}</small>
                </h3>
                <ul>
                  {side.map((player) => (
                    <li key={player.sessionId}>
                      {player.keeper ? "🧤 " : ""}
                      {player.name}
                      {player.sessionId === selfId ? " (you)" : ""}
                    </li>
                  ))}
                  {!side.length && <li className="muted">Nobody yet</li>}
                </ul>
                {open && me?.team !== team && (
                  <button
                    className="primary"
                    disabled={full || (state.phase !== "lobby" && Boolean(me)) || (!me && balance < cost)}
                    onClick={() => engine.footballJoin(state.pitchId, team, cost)}
                    data-testid={`football-join-${team}`}
                  >
                    {me ? "Switch side" : `Join${cost ? ` · ${naira(cost)}` : ""}`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {me && state.phase === "lobby" && (
          <div className="football-actions">
            <button className="primary" disabled={!both} onClick={() => { engine.footballKickoff(); onClose(); }} data-testid="football-kickoff">
              {both ? "Kick off" : "Waiting for the other side"}
            </button>
            <button className="secondary" onClick={() => engine.footballLeave()}>Leave{state.stake ? " · stake back" : ""}</button>
          </div>
        )}
        {me && state.phase === "playing" && <button className="primary" onClick={onClose}>Back to the game</button>}
      </section>
    </div>
  );
}

/** The scoreboard during a match, and the pass, shoot and tackle buttons for the players in it. */
export function FootballHud({ engine, state, selfId, blocked }: { engine: GameEngine; state: FootballState; selfId: string | null; blocked: boolean }) {
  const [now, setNow] = useState(Date.now());
  const me = state.players.find((player) => player.sessionId === selfId);
  const team: FootballTeam | undefined = me?.team;
  const holding = state.holder === selfId;
  const opponentHas = Boolean(state.holder && state.players.find((player) => player.sessionId === state.holder)?.team !== team);
  const live = state.phase === "playing";

  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [live]);

  useEffect(() => {
    if (!me || !live || blocked) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement | null)?.tagName === "INPUT" || event.repeat) return;
      if (event.code === "KeyR") engine.footballKick("pass");
      else if (event.code === "KeyF") engine.footballKick("shoot");
      else if (event.code === "KeyT") engine.footballTackle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [engine, me, live, blocked]);

  const event = state.event && now - state.event.at < 4_000 ? state.event : null;
  return (
    <>
      <section className={`football-board${state.event?.kind === "goal" && event ? " goal" : ""}`} aria-live="polite">
        <span className="side" style={{ background: FOOTBALL_KITS.green.shirt }}>{FOOTBALL_KITS.green.name}</span>
        <strong>{state.score.green} – {state.score.gold}</strong>
        <span className="side gold" style={{ background: FOOTBALL_KITS.gold.shirt }}>{FOOTBALL_KITS.gold.name}</span>
        <small>{state.phase === "finished" ? "FT" : state.endsAt ? clock(state.endsAt - now) : "Lobby"}{state.pot ? ` · pot ${naira(state.pot)}` : ""}</small>
        {(event || state.phase === "finished") && <p className="football-event">{state.phase === "finished" ? state.event?.text : event?.text}</p>}
      </section>
      {me && live && !blocked && (
        <div className="football-controls">
          <button className={holding ? "ready" : ""} onClick={() => engine.footballKick("pass")} aria-label="Pass (R)">Pass<kbd>R</kbd></button>
          <button className={`shoot${holding ? " ready" : ""}`} onClick={() => engine.footballKick("shoot")} aria-label="Shoot (F)">Shoot<kbd>F</kbd></button>
          <button onClick={() => engine.footballTackle()} disabled={!opponentHas} aria-label="Tackle (T)">Tackle<kbd>T</kbd></button>
        </div>
      )}
    </>
  );
}
