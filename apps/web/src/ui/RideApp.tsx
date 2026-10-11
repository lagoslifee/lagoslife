import { PLACES, RIDE, rideFare, type RideState, type Vec2 } from "@lagos-living/shared";
import { useEffect, useMemo, useState } from "react";
import { naira, type PropertyListing } from "../api";
import type { GameEngine } from "../game/engine";

type Destination = { key: string; label: string; sub: string; point: Vec2 };

type Props = {
  engine: GameEngine | null;
  ride: RideState | null;
  properties: PropertyListing[];
  onNavigate: (target: { point: Vec2; label: string } | null) => void;
  onClose: () => void;
};

const clock = (ms: number) => {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};
const minutes = (seconds: number) => (seconds < 90 ? `${Math.max(1, Math.round(seconds / 60))} min` : `${Math.round(seconds / 60)} min`);

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/** Lagos Living Ride: book an NPC driver to any mapped place reachable by road. */
export function RideApp({ engine, ride, properties, onNavigate, onClose }: Props) {
  const active = ride && (ride.status === "approaching" || ride.status === "waiting" || ride.status === "riding");
  const now = useNow(Boolean(active));
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<Destination | null>(null);
  const [booking, setBooking] = useState(false);
  useEffect(() => setBooking(false), [ride?.id, ride?.status]);

  const destinations = useMemo(() => {
    const list: Destination[] = [];
    for (const listing of properties.filter((entry) => entry.isMine)) {
      list.push({ key: `home-${listing.id}`, label: listing.isHome ? `Home · ${listing.name}` : listing.name, sub: listing.addressLabel, point: listing.door });
    }
    const pin = engine?.currentWaypoint();
    if (pin) list.push({ key: "pin", label: `Map pin · ${pin.label}`, sub: "Your current destination", point: pin.point });
    for (const place of PLACES) list.push({ key: place.id, label: place.name, sub: `${place.kind.replace("_", " ")} · ${place.street}`, point: place.door });
    return list;
  }, [properties, engine]);

  const term = query.trim().toLowerCase();
  const matches = (term ? destinations.filter((entry) => `${entry.label} ${entry.sub}`.toLowerCase().includes(term)) : destinations).slice(0, term ? 12 : 8);

  const quote = useMemo(() => {
    if (!engine || !chosen) return null;
    const result = engine.rideQuote(chosen.point);
    const straight = Math.hypot(result.dropoff.point[0] - result.pickup.point[0], result.dropoff.point[1] - result.pickup.point[1]);
    let problem: string | null = null;
    if (result.indoors) problem = "You're indoors. Step out to the street first: the driver arrives about 10 seconds after you book from the kerb, and the timer only starts then.";
    else if (result.aboard) problem = "Get out of your current vehicle before booking.";
    else if (result.pickup.distance > RIDE.pickupRange) problem = `You are ${Math.round(result.pickup.distance)} m from the nearest road. Walk to a street so the driver can reach you.`;
    else if (!result.plan.reachable) problem = `No road connects here with ${chosen.label}. Try the danfo, or walk.`;
    else if (result.dropoff.distance > 400) problem = `${chosen.label} is ${Math.round(result.dropoff.distance)} m from any road, so a car cannot get there.`;
    else if (straight < RIDE.minMetres) problem = `${chosen.label} is a short walk away (${Math.round(straight)} m).`;
    else if (straight > RIDE.maxMetres) problem = `${chosen.label} is outside the service area.`;
    const metres = Math.min(straight * RIDE.maxRoadFactor, Math.max(straight, result.plan.metres));
    return { ...result, problem, metres, fare: rideFare(metres), tripSeconds: metres / RIDE.driverSpeed, walkAfter: result.dropoff.distance };
  }, [engine, chosen]);

  if (active && ride) {
    const remaining = ride.status === "riding" ? engine?.rideRemaining() ?? null : null;
    return (
      <div className="app-section ride-app" data-testid="ride-active">
        <div className="ride-driver">
          <span className="ride-avatar" aria-hidden>🚕</span>
          <div>
            <strong>{ride.driverName}</strong>
            <p className="muted">Tokunbo Saloon · {ride.plate}</p>
          </div>
          <span className="ride-fare">{naira(ride.fare)}</span>
        </div>
        {ride.status === "approaching" && (
          <p className="callout" data-testid="ride-status">Driver arriving in <b>{clock(ride.arrivesAt - now)}</b>. Wait by the yellow beacon on the road.</p>
        )}
        {ride.status === "waiting" && (
          <p className="callout" data-testid="ride-status">{ride.driverName} is at the pickup. Walk to the car and press Get in. Waiting {clock((ride.waitUntil ?? now) - now)} more.</p>
        )}
        {ride.status === "riding" && (
          <p className="callout" data-testid="ride-status">On the way to <b>{ride.label}</b>{remaining !== null ? ` · ${remaining >= 1000 ? `${(remaining / 1000).toFixed(1)} km` : `${Math.round(remaining)} m`} · about ${minutes(remaining / RIDE.driverSpeed)}` : ""}.</p>
        )}
        <div className="row">
          {ride.status !== "riding" && (
            <button onClick={() => { onNavigate({ point: ride.pickup, label: `Pickup · ${ride.driverName}` }); onClose(); }}>Guide me to pickup</button>
          )}
          <button className="danger" data-testid="ride-cancel" onClick={() => engine?.cancelRide()}>
            {ride.status === "riding" ? "Stop here" : "Cancel ride"}
          </button>
        </div>
        <p className="muted small">
          {ride.status === "approaching" && (now - ride.bookedAt <= RIDE.freeCancelSeconds * 1000
            ? `Free to cancel for ${clock(ride.bookedAt + RIDE.freeCancelSeconds * 1000 - now)}; after that ${naira(RIDE.lateCancelFee)} is kept.`
            : `Cancelling now keeps ${naira(RIDE.lateCancelFee)} for the driver's time.`)}
          {ride.status === "waiting" && `Cancelling or not showing up keeps ${naira(RIDE.noShowFee)}.`}
          {ride.status === "riding" && "Stopping early refunds the fare for the distance you have not travelled."}
        </p>
      </div>
    );
  }

  return (
    <div className="app-section ride-app">
      {ride?.message && <p className={`callout ${ride.status === "completed" ? "" : "muted"}`} data-testid="ride-result">{ride.message}</p>}
      <label className="field">
        <span>Where to?</span>
        <input data-testid="ride-search" value={query} placeholder="Search places, homes, streets" onChange={(event) => { setQuery(event.target.value); setChosen(null); }} />
      </label>
      {!chosen && (
        <ul className="ride-results">
          {matches.map((entry) => (
            <li key={entry.key}>
              <button onClick={() => setChosen(entry)}>
                <strong>{entry.label}</strong>
                <small>{entry.sub}</small>
              </button>
            </li>
          ))}
          {!matches.length && <li className="muted small">No mapped place matches “{query}”.</li>}
        </ul>
      )}
      {chosen && quote && (
        <section className="ride-quote" data-testid="ride-quote">
          <strong>{chosen.label}</strong>
          <p className="muted small">{chosen.sub}</p>
          {quote.problem ? (
            <p className="callout warn" data-testid="ride-problem">{quote.problem}</p>
          ) : (
            <>
              <dl>
                <div><dt>Fare</dt><dd>{naira(quote.fare)}</dd></div>
                <div><dt>Driver</dt><dd>~1 min</dd></div>
                <div><dt>Trip</dt><dd>{(quote.metres / 1000).toFixed(1)} km · {minutes(quote.tripSeconds)}</dd></div>
              </dl>
              {quote.walkAfter > 30 && <p className="muted small">Drop-off is on the nearest road, {Math.round(quote.walkAfter)} m from the entrance.</p>}
              <p className="muted small">Paid up front in game naira. Free to cancel within a minute; refunds go back to your wallet.</p>
            </>
          )}
          <div className="row">
            <button onClick={() => setChosen(null)}>Change destination</button>
            <button
              className="primary"
              data-testid="ride-book"
              disabled={Boolean(quote.problem) || booking}
              onClick={() => {
                setBooking(true);
                setTimeout(() => setBooking(false), 4000);
                engine?.bookRide(chosen.point, chosen.label);
              }}
            >
              {booking ? "Booking…" : `Book · ${naira(quote.fare)}`}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
