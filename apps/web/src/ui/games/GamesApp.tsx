import { useState } from "react";
import { LudoGame } from "./LudoGame";
import { PoolGame } from "./PoolGame";

/** Phone → Games: Ludo and pool against the computer, played on the phone itself. */
export function GamesApp() {
  const [game, setGame] = useState<"ludo" | "pool">("ludo");
  return (
    <div className="app-section games-app" data-testid="games-app">
      <div className="place-chips" role="tablist">
        <button role="tab" aria-selected={game === "ludo"} className={game === "ludo" ? "on" : ""} onClick={() => setGame("ludo")}>🎲 Ludo</button>
        <button role="tab" aria-selected={game === "pool"} className={game === "pool" ? "on" : ""} onClick={() => setGame("pool")}>🎱 Pool</button>
      </div>
      {game === "ludo" ? <LudoGame /> : <PoolGame />}
      <p className="muted small">Single-player against the computer, for fun only: no game naira is staked or won.</p>
    </div>
  );
}
