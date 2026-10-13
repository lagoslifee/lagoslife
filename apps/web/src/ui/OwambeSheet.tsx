import { OWAMBE, OWAMBE_KINDS, OWAMBE_MENU, OWAMBE_STYLE, type Notice, type OwambeKind, type OwambeParty } from "@lagos-living/shared";
import { useState } from "react";
import { api, naira } from "../api";
import type { GameEngine } from "../game/engine";

type Props = {
  engine: GameEngine;
  party: OwambeParty;
  seated: boolean;
  balance: number;
  onClose: () => void;
  onToast: (notice: Notice) => void;
  onRefresh: () => Promise<void>;
};

export const owambeTitle = (party: OwambeParty) => OWAMBE_STYLE[party.kind].banner(party.celebrant);

/**
 * At the owambe: the waiter takes your order at the table (the family is paying), and the MC's desk books the ground
 * for a party of your own.
 */
export function OwambeSheet({ engine, party, seated, balance, onClose, onToast, onRefresh }: Props) {
  const [tab, setTab] = useState<"food" | "host">(seated ? "food" : "host");
  const [kind, setKind] = useState<OwambeKind>("birthday");
  const [celebrant, setCelebrant] = useState("");
  const [busy, setBusy] = useState(false);
  const style = OWAMBE_STYLE[party.kind];
  const left = Math.max(0, Math.ceil((party.endsAt - Date.now()) / 60_000));

  const host = async () => {
    setBusy(true);
    try {
      await api.hostOwambe(kind, celebrant.trim());
      onToast({ tone: "success", text: `The canopy is yours: ${OWAMBE_STYLE[kind].banner(celebrant.trim())} starts now. Invite your people!` });
      engine.owambeSync();
      await onRefresh();
      onClose();
    } catch (error) {
      onToast({ tone: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section className="sheet owambe-sheet" role="dialog" aria-label="Owambe" onClick={(event) => event.stopPropagation()}>
        <header className="sheet-header" style={{ borderBottom: `4px solid ${style.asoEbi}` }}>
          <div>
            <p className="eyebrow">{style.emoji} {style.label} · {left} min left</p>
            <h2>{owambeTitle(party)}</h2>
            <p className="muted small">{party.host ? `Hosted by ${party.host}` : "The neighbourhood's party: everyone is welcome."}</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <nav className="fuel-tabs">
          <button className={tab === "food" ? "active" : ""} onClick={() => setTab("food")}>Food</button>
          <button className={tab === "host" ? "active" : ""} onClick={() => setTab("host")}>Host your own</button>
        </nav>
        {tab === "food" &&
          (seated ? (
            <>
              <p className="attendant-line">🤵🏿 “Welcome, you're most welcome! What will you take? It's on the celebrant.”</p>
              <div className="owambe-menu">
                {OWAMBE_MENU.map((dish) => (
                  <button
                    key={dish.id}
                    onClick={() => {
                      engine.owambeOrder(dish.id);
                      onClose();
                    }}
                    data-testid={`owambe-dish-${dish.id}`}
                  >
                    <span className="owambe-dish-emoji">{dish.emoji}</span>
                    <strong>{dish.name}</strong>
                    <small>{dish.hand ? "Eaten by hand" : "With a spoon"} · free</small>
                  </button>
                ))}
              </div>
              <p className="muted small">One plate every {OWAMBE.plateEveryMs / 60_000} minutes. A plate fills you up by {OWAMBE.hunger}.</p>
            </>
          ) : (
            <p className="muted">Find a seat at one of the round tables first; the waiters only serve guests who are sitting down.</p>
          ))}
        {tab === "host" && (
          <div className="owambe-host">
            <p>Book the ground for {OWAMBE.partyMs / 60_000} minutes: the canopy in your aso-ebi colour, your banner over the high table, the DJ, the MC and caterers who feed every guest.</p>
            <div className="football-stakes" role="radiogroup" aria-label="Kind of party">
              {OWAMBE_KINDS.map((option) => (
                <button key={option} className={`chip${option === kind ? " selected" : ""}`} onClick={() => setKind(option)} role="radio" aria-checked={option === kind}>
                  {OWAMBE_STYLE[option].emoji} {OWAMBE_STYLE[option].label} · {naira(OWAMBE.hostPrice[option])}
                </button>
              ))}
            </div>
            <label>
              {kind === "wedding" ? "The couple" : kind === "birthday" ? "Celebrant (e.g. Mama Tolu at 60)" : "In loving memory of"}
              <input value={celebrant} maxLength={40} onChange={(event) => setCelebrant(event.target.value)} placeholder={kind === "wedding" ? "Tolu & Kunle" : kind === "birthday" ? "Mama Tolu at 60" : "Pa Adewale Johnson (1940–2026)"} data-testid="owambe-celebrant" />
            </label>
            {party.host && <p className="muted small">The ground is booked right now; you can book it when this party ends.</p>}
            <button className="primary" disabled={busy || celebrant.trim().length < 2 || balance < OWAMBE.hostPrice[kind] || Boolean(party.host)} onClick={() => void host()} data-testid="owambe-host">
              {busy ? "Booking…" : `Throw the party · ${naira(OWAMBE.hostPrice[kind])}`}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
