import { OWAMBE, OWAMBE_KINDS, OWAMBE_MENU, OWAMBE_SPRAY_AMOUNTS, OWAMBE_SPRAY_REACH, OWAMBE_STYLE, type Notice, type OwambeKind, type OwambeParty } from "@lagos-living/shared";
import { useEffect, useState } from "react";
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
  initialTab?: Tab | undefined;
};

type Tab = "food" | "spray" | "host";

export const owambeTitle = (party: OwambeParty) => OWAMBE_STYLE[party.kind].banner(party.celebrant);

/**
 * At the owambe: the waiter takes your order at the table (the family is paying), and the MC's desk books the ground
 * for a party of your own.
 */
export function OwambeSheet({ engine, party, seated, balance, onClose, onToast, onRefresh, initialTab }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab ?? (seated ? "food" : "host"));
  const [reach, setReach] = useState(() => engine.owambeSprayDistance());
  useEffect(() => {
    const timer = window.setInterval(() => setReach(engine.owambeSprayDistance()), 500);
    return () => window.clearInterval(timer);
  }, [engine]);
  const close = reach !== null && reach <= OWAMBE_SPRAY_REACH;
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
          <button className={tab === "spray" ? "active" : ""} onClick={() => setTab("spray")} data-testid="owambe-spray-tab">💸 Spray</button>
          <button className={tab === "host" ? "active" : ""} onClick={() => setTab("host")}>Host your own</button>
        </nav>
        {tab === "spray" && (
          <div className="owambe-host">
            <p>Dance up to the high table and spray {party.celebrant} with crisp notes. {party.host ? `It all goes to ${party.host}, who's hosting.` : "The family thanks you."}</p>
            <div className="owambe-menu">
              {OWAMBE_SPRAY_AMOUNTS.map((amount) => (
                <button
                  key={amount}
                  disabled={!close || balance < amount}
                  onClick={() => {
                    engine.owambeSpray(amount);
                    window.setTimeout(() => void onRefresh(), 1_200);
                  }}
                  data-testid={`owambe-spray-${amount}`}
                >
                  <span className="owambe-dish-emoji">💸</span>
                  <strong>{naira(amount)}</strong>
                  <small>{amount >= 200_000 ? "Big man spray" : amount >= 50_000 ? "Make it rain" : "Wave of notes"}</small>
                </button>
              ))}
            </div>
            <p className="muted small">
              {close ? "You're close enough to the celebrants. Keep spraying!" : reach === null ? "Step out onto the ground first." : `Walk ${Math.ceil(reach - OWAMBE_SPRAY_REACH)} m closer to the high table to spray.`}
            </p>
          </div>
        )}
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
