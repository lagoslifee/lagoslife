import { BOTTLE_MENU, broadcastAt, CLUB_MENU, CLUBS, TABLE_GUESTS_MAX, VIEWING, VIEWING_MENU, type ViewingMenuItem, type ViewingStatus, type ClubStatus, type ClubTable, type Notice, type Place } from "@lagos-living/shared";
import { useEffect, useState } from "react";
import { api, naira, type EconomyState } from "../api";

type Common = {
  economy: EconomyState | null;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onToast: (notice: Notice) => void;
};

function useRun({ onRefresh, onToast }: Pick<Common, "onRefresh" | "onToast">) {
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<string>) => {
    setBusy(true);
    try {
      onToast({ tone: "success", text: await work() });
      await onRefresh();
      return true;
    } catch (error) {
      onToast({ tone: "error", text: (error as Error).message });
      return false;
    } finally {
      setBusy(false);
    }
  };
  return [busy, run] as const;
}

function untilLabel(iso: string) {
  return new Date(iso).toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" });
}

/** At the club door: pay tonight's cover once, then walk in and out freely until 6 am. */
export function ClubDoorSheet({ place, economy, onClose, onRefresh, onToast, onEnter }: Common & { place: Place; onEnter: () => void }) {
  const club = CLUBS[place.id];
  const [status, setStatus] = useState<ClubStatus | null>(null);
  const [busy, run] = useRun({ onRefresh, onToast });
  useEffect(() => {
    let live = true;
    api.clubStatus(place.id).then((next) => live && setStatus(next)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [place.id]);
  if (!club) return null;
  const balance = economy?.balance ?? 0;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section className="sheet club-sheet" role="dialog" aria-label={place.name} data-testid="club-door" onClick={(event) => event.stopPropagation()} style={{ borderTop: `4px solid ${club.accent}` }}>
        <header>
          <div>
            <p className="eyebrow">NIGHTCLUB · {place.street.toUpperCase()}</p>
            <h2>{place.name}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <p className="muted">{club.tagline}</p>
        <p>
          Tonight: <strong>{club.dj}</strong> · {club.bpm} bpm
        </p>
        {status?.wristband ? (
          <>
            <p data-testid="club-wristband">You have tonight's wristband. It works until {untilLabel(status.validUntil)}.</p>
            <button className="primary" onClick={() => { onClose(); onEnter(); }}>Go inside</button>
          </>
        ) : (
          <>
            <p>
              Cover charge <strong>{naira(club.cover)}</strong>, paid once a night. Inside: a shared dance floor, a DJ and a bar with soft drinks and small
              chops.
            </p>
            <button
              className="primary"
              disabled={busy || balance < club.cover}
              onClick={() => void run(async () => {
                const result = await api.buyWristband(place.id);
                setStatus(result.status);
                return result.charged ? `Wristband on. Paid ${naira(result.charged)}, balance ${naira(result.balance)}.` : "You already have tonight's wristband.";
              }).then((ok) => {
                if (ok) {
                  onClose();
                  onEnter();
                }
              })}
            >
              {balance < club.cover ? `Need ${naira(club.cover)}` : `Pay ${naira(club.cover)} and go in`}
            </button>
          </>
        )}
        {status && status.nights > 0 && <p className="muted small">You have been here {status.nights} {status.nights === 1 ? "night" : "nights"}.</p>}
      </section>
    </div>
  );
}

/** At the bar inside a club. */
export function ClubBarSheet({ place, economy, onClose, onRefresh, onToast, onServed }: Common & { place: Place; onServed?: (item: { id: string; name: string }) => void }) {
  const [busy, run] = useRun({ onRefresh, onToast });
  const balance = economy?.balance ?? 0;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section className="sheet" role="dialog" aria-label={`${place.name} bar`} data-testid="club-bar" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <p className="eyebrow">THE BAR</p>
            <h2>{place.name}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <p className="muted">Served fresh, enjoyed on the spot. Balance {naira(balance)}.</p>
        <ul className="menu">
          {CLUB_MENU.map((item) => (
            <li key={item.id}>
              <div>
                <strong>{item.name}</strong>
                <span>
                  {item.hunger ? `Hunger +${item.hunger}` : ""}
                  {item.hunger && item.energy ? " · " : ""}
                  {item.energy ? `Energy +${item.energy}` : ""}
                </span>
              </div>
              <div className="menu-actions">
                <button
                  className="primary"
                  disabled={busy || balance < item.price}
                  onClick={() => void run(async () => {
                    const result = await api.clubOrder(place.id, item.id);
                    onServed?.(item);
                    return `${item.name}, ${naira(item.price)}. A waitress is bringing it over. Hunger ${result.needs.hunger}/100 · energy ${result.needs.energy}/100.`;
                  })}
                >
                  {naira(item.price)}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** The viewing-centre kiosk: order from your bench and the attendant walks it over. */
export function ViewingKioskSheet({ place, economy, onClose, onRefresh, onToast, onServed }: Common & { place: Place; onServed: (item: ViewingMenuItem) => void }) {
  const [busy, run] = useRun({ onRefresh, onToast });
  const balance = economy?.balance ?? 0;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section className="sheet" role="dialog" aria-label={`${place.name} kiosk`} data-testid="viewing-kiosk" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <p className="eyebrow">THE KIOSK · MATCH DAY</p>
            <h2>Cold drinks & chops</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <p className="muted">Order from your seat and the attendant brings it over. Balance {naira(balance)}.</p>
        <ul className="menu">
          {VIEWING_MENU.map((item) => (
            <li key={item.id}>
              <div>
                <strong>{item.drink ? "🥤" : "🌯"} {item.name}</strong>
                <span>
                  {item.hunger ? `Hunger +${item.hunger}` : ""}
                  {item.hunger && item.energy ? " · " : ""}
                  {item.energy ? `Energy +${item.energy}` : ""}
                </span>
              </div>
              <div className="menu-actions">
                <button
                  className="primary"
                  data-testid={`kiosk-${item.id}`}
                  disabled={busy || balance < item.price}
                  onClick={() => void run(async () => {
                    await api.viewingOrder(place.id, item.id);
                    onServed(item);
                    return `${item.name}, ${naira(item.price)}. The attendant is bringing it to you.`;
                  })}
                >
                  {naira(item.price)}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** A VIP booth: book it for the night, invite friends, and order bottles that a waiter brings over. */
export function ClubTableSheet({
  place,
  no,
  tables,
  economy,
  onClose,
  onRefresh,
  onToast,
  onTables,
  onSit,
}: Common & { place: Place; no: number; tables: ClubTable[]; onTables: (tables: ClubTable[]) => void; onSit: () => void }) {
  const club = CLUBS[place.id];
  const [busy, run] = useRun({ onRefresh, onToast });
  const [invitee, setInvitee] = useState("");
  const table = tables.find((entry) => entry.no === no);
  const balance = economy?.balance ?? 0;
  if (!club) return null;
  const party = table && (table.mine || table.guest);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section className="sheet club-sheet" role="dialog" aria-label={`VIP table ${no}`} data-testid="club-table" onClick={(event) => event.stopPropagation()} style={{ borderTop: `4px solid ${club.accent}` }}>
        <header>
          <div>
            <p className="eyebrow">{place.name.toUpperCase()} · VIP</p>
            <h2>Table {no}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">✕</button>
        </header>
        {!table ? (
          <p className="muted">Checking the table…</p>
        ) : !table.ownerName ? (
          <>
            <p>
              A velvet booth by the dance floor: you and up to {TABLE_GUESTS_MAX} friends you invite, with bottle service brought to the
              table and your name on the LED wall. It is yours while you stay; a minute after you leave the club it is cleared for the next party.
            </p>
            <button
              className="primary"
              disabled={busy || balance < club.tablePrice}
              onClick={() => void run(async () => {
                const result = await api.bookTable(place.id, no);
                onTables(result.tables);
                return result.charged ? `Table ${no} is yours tonight. Paid ${naira(result.charged)}.` : `Table ${no} is already yours.`;
              })}
            >
              {balance < club.tablePrice ? `Need ${naira(club.tablePrice)}` : `Book for ${naira(club.tablePrice)}`}
            </button>
          </>
        ) : (
          <>
            <p data-testid="table-owner">
              {table.mine ? "Your table while you're here. Leave the club and it's cleared after a minute." : `${table.ownerName}'s table.`}
              {table.guests.length ? ` Guests: ${table.guests.join(", ")}.` : ""}
            </p>
            {!party && <p className="muted">Ask {table.ownerName} to invite you to sit and order here.</p>}
            {party && (
              <button className="secondary" onClick={() => { onClose(); onSit(); }}>Sit at the table</button>
            )}
            {table.mine && (
              <div className="table-guests">
                <h3>Guest list</h3>
                <ul className="menu">
                  {table.guests.map((guest) => (
                    <li key={guest}>
                      <strong>{guest}</strong>
                      <div className="menu-actions">
                        <button className="secondary" disabled={busy} onClick={() => void run(async () => {
                          const result = await api.removeFromTable(place.id, no, guest);
                          onTables(result.tables);
                          return `${result.guest} is off the guest list.`;
                        })}>Remove</button>
                      </div>
                    </li>
                  ))}
                </ul>
                {table.guests.length < TABLE_GUESTS_MAX && (
                  <form
                    className="invite-row"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const name = invitee.trim();
                      if (!name) return;
                      void run(async () => {
                        const result = await api.inviteToTable(place.id, no, name);
                        onTables(result.tables);
                        setInvitee("");
                        return `${result.guest} can join your table.`;
                      });
                    }}
                  >
                    <input value={invitee} onChange={(event) => setInvitee(event.target.value)} placeholder="Resident's username" aria-label="Invite by username" maxLength={40} />
                    <button className="primary" disabled={busy || !invitee.trim()}>Invite</button>
                  </form>
                )}
              </div>
            )}
            {party && (
              <>
                <h3>Bottle service</h3>
                <ul className="menu">
                  {BOTTLE_MENU.map((item) => (
                    <li key={item.id}>
                      <div>
                        <strong>{item.name}</strong>
                        {item.sparkler && <span>Arrives with sparklers</span>}
                      </div>
                      <div className="menu-actions">
                        <button
                          className="primary"
                          disabled={busy || balance < item.price}
                          onClick={() => void run(async () => {
                            const result = await api.orderBottle(place.id, no, item.id);
                            onTables(result.tables);
                            return `${item.name} is on its way to table ${no}. Balance ${naira(result.balance)}.`;
                          })}
                        >
                          {naira(item.price)}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}

/** At the viewing-centre door: what is on the screen right now, and an hour's pass to go in and watch. */
export function ViewingDoorSheet({ place, economy, onClose, onRefresh, onToast, onEnter }: Common & { place: Place; onEnter: () => void }) {
  const [status, setStatus] = useState<ViewingStatus | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, run] = useRun({ onRefresh, onToast });
  useEffect(() => {
    let live = true;
    api.viewingStatus(place.id).then((next) => live && setStatus(next)).catch(() => undefined);
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [place.id]);
  const match = broadcastAt(now);
  const fee = status?.fee ?? VIEWING.entryFee;
  const balance = economy?.balance ?? 0;
  const clock = match.phase === "pre" ? "Kick-off" : match.phase === "half" ? "Half-time" : match.phase === "full" ? "Full-time" : `${Math.floor(match.minute) + 1}'`;
  const pass = status?.passUntil && new Date(status.passUntil).getTime() > now ? status.passUntil : null;
  const enter = () => {
    onClose();
    onEnter();
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section className="sheet club-sheet" role="dialog" aria-label={place.name} data-testid="viewing-door" onClick={(event) => event.stopPropagation()} style={{ borderTop: "4px solid #0f7a3a" }}>
        <header>
          <div>
            <p className="eyebrow">VIEWING CENTRE · {place.street.toUpperCase()}</p>
            <h2>{place.name}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="viewing-now" data-testid="viewing-now">
          <span className="viewing-live">LIVE</span>
          <strong>
            {match.home.name} {match.score.home} – {match.score.away} {match.away.name}
          </strong>
          <span className="muted small">
            {match.league} · {clock}
          </span>
        </div>
        <p className="muted small">
          Up next: {match.next.home.name} v {match.next.away.name}. A new match kicks off every two minutes on the big screen and both side TVs.
        </p>
        {pass ? (
          <>
            <p data-testid="viewing-pass">Your pass works until {untilLabel(pass)}.</p>
            <button className="primary" onClick={enter}>Go in and watch</button>
          </>
        ) : (
          <>
            <p>
              Entry <strong>{naira(fee)}</strong> for {VIEWING.passMinutes} minutes. Grab a bench, chat with whoever is watching, and cheer when your side scores.
            </p>
            <button
              className="primary"
              data-testid="viewing-pay"
              disabled={busy || balance < fee}
              onClick={() => void run(async () => {
                const result = await api.buyViewingPass(place.id);
                setStatus(result.status);
                return result.charged ? `Paid ${naira(result.charged)} at the door. Balance ${naira(result.balance)}.` : "Your pass is still running.";
              }).then((ok) => ok && enter())}
            >
              {balance < fee ? `Need ${naira(fee)}` : `Pay ${naira(fee)} and go in`}
            </button>
          </>
        )}
      </section>
    </div>
  );
}
