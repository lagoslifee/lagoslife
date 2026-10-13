import { RANKING_BOARDS, rankingBoards, type Notice, type RankingBoard, type RankingState } from "@lagos-living/shared";
import { useEffect, useState } from "react";
import { api } from "../api";

const naira = (amount: number) => `₦${amount.toLocaleString("en-NG")}`;
const MEDALS = ["🥇", "🥈", "🥉"];

/** Phone → Rankings: who is richest, earning most this week, has the biggest garage, the most property and the best fitness. */
export function RankingsApp({ onToast }: { onToast: (notice: Notice) => void }) {
  const [board, setBoard] = useState<RankingBoard>("worth");
  const [state, setState] = useState<RankingState | null>(null);

  useEffect(() => {
    let live = true;
    setState(null);
    api.rankings(board).then((next) => live && setState(next)).catch((error: Error) => onToast({ tone: "error", text: error.message }));
    return () => {
      live = false;
    };
  }, [board, onToast]);

  const info = RANKING_BOARDS[board];
  const show = (value: number) => (info.unit === "naira" ? naira(value) : `${value}%`);
  const mineListed = state?.entries.some((entry) => entry.you);
  return (
    <div className="app-section rankings">
      <div className="rank-tabs" role="tablist">
        {rankingBoards.map((id) => (
          <button key={id} role="tab" aria-selected={id === board} className={id === board ? "active" : ""} data-testid={`rank-${id}`} onClick={() => setBoard(id)}>
            <span>{RANKING_BOARDS[id].emoji}</span>
            {RANKING_BOARDS[id].title.replace(/ (in Lagos|this week|residents)$/, "")}
          </button>
        ))}
      </div>
      <div className="rank-hero">
        <strong>{info.emoji} {info.title}</strong>
        <span>{info.blurb}</span>
        {state?.you && (
          <div className="rank-you" data-testid="rank-you">
            <b>{state.you.rank ? `#${state.you.rank}` : "—"}</b>
            <span>
              {state.you.rank ? `of ${state.residents} · ${show(state.you.value)}` : "Not ranked yet"}
              <br />
              {state.you.ahead
                ? `${show(state.you.ahead.gap)} more to pass ${state.you.ahead.username}`
                : state.you.rank
                  ? state.residents > 1 ? "You're top of Lagos. Hold on to it." : "First on the board."
                  : "Get on the board to be ranked."}
            </span>
          </div>
        )}
      </div>
      {!state ? (
        <p className="muted">Counting up Lagos…</p>
      ) : state.entries.length === 0 ? (
        <p className="muted">Nobody on this board yet. Be the first.</p>
      ) : (
        <ol className="rank-list" data-testid="rank-list">
          {state.entries.map((entry) => (
            <li key={entry.username} className={entry.you ? "you" : ""}>
              <span className="rank-place">{MEDALS[entry.rank - 1] ?? `#${entry.rank}`}</span>
              <span className="rank-name">{entry.username}{entry.you ? " (you)" : ""}</span>
              <span className="rank-value">{show(entry.value)}</span>
            </li>
          ))}
          {state.you?.rank && !mineListed && (
            <li className="you">
              <span className="rank-place">#{state.you.rank}</span>
              <span className="rank-name">You</span>
              <span className="rank-value">{show(state.you.value)}</span>
            </li>
          )}
        </ol>
      )}
    </div>
  );
}
