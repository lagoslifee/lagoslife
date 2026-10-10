import { COMMUNITY, DISTRICTS, PLACES, type CommunityStatus, type Notice, type Place, type Vec2 } from "@lagos-living/shared";
import { useEffect, useState } from "react";
import { api, naira, type EconomyState } from "../api";

export const COMMUNITY_KINDS = new Set<Place["kind"]>(["library", "park", "worship", "community"]);

const QUIET_COPY: Record<string, { action: string; blurb: string }> = {
  library: { action: "Read for a while", blurb: "Free public reading room. Find a quiet corner and a good book." },
  park: { action: "Sit in the shade", blurb: "Benches under the trees. Open to everyone, all day." },
  worship: { action: "Spend a quiet moment", blurb: "Everyone is welcome. Visiting is entirely optional." },
};

function minutesUntil(iso: string | null) {
  return iso ? Math.max(1, Math.ceil((new Date(iso).getTime() - Date.now()) / 60_000)) : 0;
}

function useCommunityStatus() {
  const [status, setStatus] = useState<CommunityStatus | null>(null);
  useEffect(() => {
    let live = true;
    api.community().then((next) => live && setStatus(next)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return [status, setStatus] as const;
}

type SheetProps = {
  place: Place;
  economy: EconomyState | null;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onToast: (notice: Notice) => void;
};

export function CommunitySheet({ place, economy, onClose, onRefresh, onToast }: SheetProps) {
  const [status, setStatus] = useCommunityStatus();
  const [busy, setBusy] = useState(false);
  const energy = economy?.needs.energy ?? 0;
  const run = async (work: () => Promise<string>) => {
    setBusy(true);
    try {
      onToast({ tone: "success", text: await work() });
      await onRefresh();
    } catch (error) {
      onToast({ tone: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const quiet = QUIET_COPY[place.kind];
  const waiting = minutesUntil(status?.quietReadyAt ?? null);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section className="sheet" role="dialog" aria-label={place.name} data-testid="community-sheet" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <p className="eyebrow">{place.street.toUpperCase()}</p>
            <h2>{place.name}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">✕</button>
        </header>

        {quiet && (
          <div className="community-sheet">
            <p className="muted">{quiet.blurb}</p>
            <p>
              Quiet time lifts energy by <strong>{COMMUNITY.quietVisitEnergy}</strong>, once every {COMMUNITY.quietVisitCooldownMs / 60_000} minutes. The
              library, parks and every place of worship share that same rest; none gives more than another.
            </p>
            {waiting > 0 && <p className="muted small" data-testid="quiet-cooldown">You rested recently. Visits stay open, and the energy lift returns in about {waiting} min.</p>}
            <button
              className="primary"
              disabled={busy}
              onClick={() => void run(async () => {
                const result = await api.visitQuietPlace(place.id);
                setStatus(result.status);
                return result.rested
                  ? `You spent some quiet time at ${place.name}. Energy ${result.needs.energy}/100 (+${result.energyGain}).`
                  : `You spent some quiet time at ${place.name}. You rested recently, so energy is unchanged.`;
              })}
            >{quiet.action}</button>
          </div>
        )}

        {place.kind === "community" && (
          <div className="community-sheet">
            <p className="muted">Residents run the hall together: sorting donations, setting out chairs and helping at the weekend clinic.</p>
            <p>
              A volunteer shift pays <strong>{naira(COMMUNITY.volunteerWage)}</strong> game naira once per Lagos day and uses {COMMUNITY.volunteerEnergyCost} energy
              and {COMMUNITY.volunteerHungerCost} hunger.
            </p>
            {status?.volunteeredToday ? (
              <p data-testid="volunteer-done">Thanks for today's shift. Come back tomorrow.</p>
            ) : (
              <button
                className="primary"
                disabled={busy || energy < COMMUNITY.volunteerMinimumEnergy}
                onClick={() => void run(async () => {
                  const result = await api.volunteer(place.id);
                  setStatus(result.status);
                  return result.replayed ? "You already volunteered today." : `Shift done. +${naira(result.wage)} · balance ${naira(result.balance)}.`;
                })}
              >{energy < COMMUNITY.volunteerMinimumEnergy ? "Too tired to volunteer" : `Volunteer · ${naira(COMMUNITY.volunteerWage)}`}</button>
            )}
            {status && <p className="muted small">Shifts so far: {status.volunteerDays}</p>}
          </div>
        )}
      </section>
    </div>
  );
}

const VENUES = PLACES.filter((place) => COMMUNITY_KINDS.has(place.kind));
const KIND_LABEL: Record<string, string> = { library: "Library", park: "Park", worship: "Place of worship", community: "Community hall" };

export function CommunityApp({ onNavigate, onClose }: { onNavigate: (target: { point: Vec2; label: string }) => void; onClose: () => void }) {
  const [status] = useCommunityStatus();
  const waiting = minutesUntil(status?.quietReadyAt ?? null);
  return (
    <div className="app-section" data-testid="community-app">
      <p className="muted small">
        Quiet places all give the same rest (+{COMMUNITY.quietVisitEnergy} energy, shared {COMMUNITY.quietVisitCooldownMs / 60_000} min cooldown). Visiting any
        of them is optional.
      </p>
      {status && (
        <p>
          {waiting ? `Next restful visit in about ${waiting} min.` : "A quiet visit will lift your energy now."}{" "}
          {status.volunteeredToday ? "You volunteered today." : `Volunteer shift available (${naira(COMMUNITY.volunteerWage)}).`}
        </p>
      )}
      <ul className="venue-list">
        {VENUES.map((place) => (
          <li key={place.id}>
            <div>
              <strong>{place.name}</strong>
              <span>{KIND_LABEL[place.kind]} · {place.street} · {DISTRICTS.find((district) => district.id === place.district)?.name}</span>
            </div>
            <button className="link" onClick={() => { onNavigate({ point: place.door, label: place.name }); onClose(); }}>Navigate</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
