import { AIRCRAFT, AIRCRAFT_RULES, aircraftById, isFastTravelKind, PLACES, regionOf, type Notice, type OwnedAircraft } from "@lagos-living/shared";
import { useEffect, useMemo, useState } from "react";
import { api, naira, type EconomyState } from "../api";
import type { GameEngine } from "../game/engine";

type Props = {
  engine: GameEngine | null;
  economy: EconomyState | null;
  onRefresh: () => Promise<void>;
  onToast: (notice: Notice) => void;
  onClose: () => void;
};

/** Phone → Hangar: buy a helicopter or a private jet, then hop across the city or fly Lagos ⇄ Dubai in your own. */
export function HangarApp({ engine, economy, onRefresh, onToast, onClose }: Props) {
  const [owned, setOwned] = useState<OwnedAircraft[] | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [landing, setLanding] = useState<Record<string, string>>({});
  const region = engine?.playerRegion() ?? "lagos";
  const pads = useMemo(
    () => PLACES.filter((place) => isFastTravelKind(place.kind) && regionOf(place.door[0], place.door[1]) === region).sort((a, b) => a.name.localeCompare(b.name)),
    [region],
  );

  const load = () =>
    api
      .aircraft()
      .then((result) => setOwned(result.owned))
      .catch((error: Error) => {
        setOwned([]);
        onToast({ tone: "error", text: error.message });
      });
  useEffect(() => {
    void load();
  }, []);

  const buy = async (modelId: string) => {
    setBusy(true);
    try {
      const { aircraft } = await api.buyAircraft(modelId);
      onToast({ tone: "success", text: `🛩️ Your ${aircraftById.get(modelId)?.name} is in the hangar, registered ${aircraft.tail}. (Game money.)` });
      setConfirming(null);
      await Promise.all([load(), onRefresh()]);
    } catch (error) {
      onToast({ tone: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const balance = economy?.balance ?? 0;
  const full = (owned?.length ?? 0) >= AIRCRAFT_RULES.maxOwned;
  return (
    <div className="app-section hangar-app" data-testid="hangar-app">
      <p className="muted small">For the elite only. A helicopter sets you down anywhere public in the city you're in, no traffic and no need to have been there before. A private jet flies you between Lagos and Dubai whenever you like, just you and the crew (you still need your visa).</p>

      <h3>Your hangar</h3>
      {owned === null && <p className="muted">Loading…</p>}
      {owned?.length === 0 && <p className="muted small">No aircraft yet.</p>}
      <ul className="go-list" data-testid="hangar-owned">
        {owned?.map((entry) => {
          const model = aircraftById.get(entry.modelId);
          if (!model) return null;
          const pad = landing[entry.id] ?? pads[0]?.id ?? "";
          return (
            <li key={entry.id} className="hangar-owned">
              <span>
                {model.kind === "jet" ? "✈️" : "🚁"} <strong>{model.name}</strong>
                <small className="muted"> · {entry.tail} · {naira(model.tripCost)} a {model.kind === "jet" ? "flight" : "hop"}</small>
              </span>
              {model.kind === "helicopter" ? (
                <span className="row">
                  <select value={pad} onChange={(event) => setLanding((current) => ({ ...current, [entry.id]: event.target.value }))} aria-label="Where to land" data-testid={`hangar-pad-${entry.id}`}>
                    {pads.map((place) => (
                      <option key={place.id} value={place.id}>{place.name}</option>
                    ))}
                  </select>
                  <button
                    className="primary"
                    disabled={!engine || !pad || balance < model.tripCost}
                    onClick={() => {
                      engine?.helicopterHop(entry.id, pad);
                      onClose();
                    }}
                    data-testid={`hangar-hop-${entry.id}`}
                  >
                    Fly
                  </button>
                </span>
              ) : (
                <button
                  className="primary"
                  disabled={!engine || balance < model.tripCost}
                  onClick={() => {
                    engine?.jetFlight(entry.id);
                    onClose();
                  }}
                  data-testid={`hangar-jet-${entry.id}`}
                >
                  {region === "dubai" ? "Fly home to Lagos" : "Fly to Dubai"}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <h3>Showroom</h3>
      {full && <p className="muted small">Your hangar is full ({AIRCRAFT_RULES.maxOwned} aircraft).</p>}
      <ul className="hangar-catalog">
        {AIRCRAFT.map((model) => (
          <li key={model.id} className="vehicle-card">
            <div>
              <strong>{model.kind === "jet" ? "✈️" : "🚁"} {model.name}</strong>
              <p className="muted small">{model.description}</p>
              <small className="muted">{model.seats} seats · {model.cruise} km/h · {naira(model.tripCost)} per {model.kind === "jet" ? "flight" : "hop"}</small>
            </div>
            {confirming === model.id ? (
              <span className="row">
                <button className="primary" disabled={busy} onClick={() => void buy(model.id)} data-testid={`hangar-confirm-${model.id}`}>
                  {busy ? "Buying…" : `Pay ${naira(model.price)}`}
                </button>
                <button onClick={() => setConfirming(null)}>Cancel</button>
              </span>
            ) : (
              <button disabled={full || balance < model.price} onClick={() => setConfirming(model.id)} data-testid={`hangar-buy-${model.id}`}>
                {balance < model.price ? `${naira(model.price)} · can't afford` : `Buy · ${naira(model.price)}`}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
