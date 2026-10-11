import { CLUB_MENU, CLUBS, type ClubStatus, type Notice, type Place } from "@lagos-living/shared";
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
export function ClubBarSheet({ place, economy, onClose, onRefresh, onToast }: Common & { place: Place }) {
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
                    return `${item.name}, ${naira(item.price)}. Hunger ${result.needs.hunger}/100 · energy ${result.needs.energy}/100.`;
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
