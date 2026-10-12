import { FAST_TRAVEL, placeById, regionOf, type FastTravelState, type Happening, type TravelPrompt } from "@lagos-living/shared";
import { useEffect, useState } from "react";
import type { GameEngine } from "../game/engine";
import type { RideAsk } from "../multiplayer";

const HAPPENING_ICON: Record<Happening["kind"], string> = { club: "🎶", flight: "✈", gathering: "👥", beach: "🏖", ride: "🚲" };

function useNow(interval = 1_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(timer);
  }, [interval]);
  return now;
}

/** Phone → Go: favourites, discovered places, travelling together, joining a friend, and what's on right now. */
export function GoApp({ engine, onClose }: { engine: GameEngine | null; onClose: () => void }) {
  const [state, setState] = useState<FastTravelState | null>(null);
  const [companions, setCompanions] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const now = useNow();
  useEffect(() => {
    if (!engine) return;
    engine.goListener = setState;
    engine.requestGoState();
    const timer = setInterval(() => engine.requestGoState(), 5_000);
    return () => {
      clearInterval(timer);
      if (engine.goListener === setState) engine.goListener = null;
    };
  }, [engine]);
  if (!engine) return null;
  if (!state) return <p className="muted">Loading…</p>;
  const wait = Math.max(0, Math.ceil((state.cooldownUntil - now) / 1_000));
  const go = (target: { placeId: string } | { favourite: "home" | "garage" | "club" | "airport" }, label: string) => {
    engine.fastTravel(target, label, companions);
    setCompanions([]);
    onClose();
  };
  const region = engine.playerRegion();
  const local = (placeId: string | null | undefined) => {
    const place = placeId ? placeById.get(placeId) : undefined;
    return !place || regionOf(place.door[0], place.door[1]) === region;
  };
  const places = state.discovered
    .map((id) => placeById.get(id))
    .filter((place): place is NonNullable<typeof place> => Boolean(place) && regionOf(place!.door[0], place!.door[1]) === region)
    .filter((place) => !filter || `${place.name} ${place.street}`.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="app-section go-app" data-testid="go-app">
      <p className="muted small">
        Arrive at the public entrance of a place you've already been to. You must be on foot; your car stays parked where you leave it. Walking, danfos and rides
        still work as usual.{wait > 0 && <strong> Ready again in {wait} s.</strong>}
      </p>

      <h3>Tonight in the City</h3>
      {state.happenings.length === 0 && <p className="muted small">Nothing busy in this world right now. Clubs, boarding flights and groups of two or more residents show up here.</p>}
      <ul className="go-list" data-testid="happenings">
        {state.happenings.filter((item) => local(item.placeId)).map((item) => (
          <li key={item.id}>
            <span>
              {HAPPENING_ICON[item.kind]} <strong>{item.title}</strong>
              <small className="muted"> · {item.detail}</small>
            </span>
            {item.placeId && state.discovered.includes(item.placeId) ? (
              <button disabled={wait > 0} onClick={() => go({ placeId: item.placeId! }, placeById.get(item.placeId!)?.name ?? item.title)}>Join</button>
            ) : item.placeId ? (
              <small className="muted">Visit once to unlock</small>
            ) : null}
          </li>
        ))}
      </ul>

      <h3>Favourites</h3>
      <div className="go-favourites">
        {state.favourites.filter((favourite) => region === "lagos" || (favourite.id !== "home" && favourite.id !== "garage")).map((favourite) => (
          <button
            key={favourite.id}
            data-testid={`go-${favourite.id}`}
            disabled={wait > 0 || !favourite.placeId}
            title={favourite.note ?? undefined}
            onClick={() => go({ favourite: favourite.id }, favourite.label)}
          >
            {favourite.label}
            {favourite.note && <small>{favourite.note}</small>}
          </button>
        ))}
      </div>

      {state.nearby.length > 0 && (
        <>
          <h3>Bring residents with you</h3>
          <p className="muted small">Each person you tick gets an invitation and only comes if they accept (within {FAST_TRAVEL.answerMs / 1_000} s).</p>
          <ul className="go-list">
            {state.nearby.map((person) => (
              <li key={person.sessionId}>
                <label>
                  <input
                    type="checkbox"
                    checked={companions.includes(person.sessionId)}
                    disabled={!companions.includes(person.sessionId) && companions.length >= FAST_TRAVEL.maxCompanions}
                    onChange={(event) => setCompanions((list) => (event.target.checked ? [...list, person.sessionId] : list.filter((id) => id !== person.sessionId)))}
                  />{" "}
                  {person.name} <small className="muted">· {person.distance} m</small>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3>Places you've discovered ({state.discovered.length})</h3>
      {state.discovered.length > 6 && <input className="go-filter" placeholder="Search places" value={filter} onChange={(event) => setFilter(event.target.value)} />}
      {state.discovered.length === 0 && <p className="muted small">Walk, ride or drive past shops, parks, clubs and landmarks to add them here.</p>}
      <ul className="go-list" data-testid="go-places">
        {places.map((place) => (
          <li key={place.id}>
            <span>
              {place.name}
              <small className="muted"> · {place.street}</small>
            </span>
            <button disabled={wait > 0} data-testid={`go-place-${place.id}`} onClick={() => go({ placeId: place.id }, place.name)}>Go now</button>
          </li>
        ))}
      </ul>

      <h3>Join a resident</h3>
      <p className="muted small">They get a request and decide. If they're indoors you arrive at the door, never inside; homes and clubs keep their own entry rules.</p>
      {state.online.length === 0 && <p className="muted small">Nobody else is online in this world.</p>}
      <ul className="go-list" data-testid="go-online">
        {state.online.map((person) => (
          <li key={person.sessionId}>
            <span>
              {person.name}
              <small className="muted"> · {person.where}</small>
            </span>
            <button disabled={wait > 0} onClick={() => engine.askToJoin(person.sessionId)}>Ask to join</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Small, non-blocking card: the player can keep walking or driving while it is up. */
export function TravelPromptCard({ prompt, onAnswer }: { prompt: TravelPrompt; onAnswer: (accept: boolean) => void }) {
  const now = useNow(250);
  const left = Math.max(0, Math.ceil((prompt.expiresAt - now) / 1_000));
  useEffect(() => {
    if (left === 0) onAnswer(false);
  }, [left, onAnswer]);
  return (
    <section className="travel-prompt" role="alertdialog" aria-label="Travel request" data-testid="travel-prompt">
      <p>
        {prompt.kind === "together" ? (
          <>
            <strong>{prompt.fromName}</strong> invites you to {prompt.label}.
          </>
        ) : (
          <>
            <strong>{prompt.fromName}</strong> wants to join you.
          </>
        )}{" "}
        <small className="muted">{left}s</small>
      </p>
      <div className="row">
        <button className="primary" data-testid="travel-accept" onClick={() => onAnswer(true)}>{prompt.kind === "together" ? "Go with them" : "Let them come"}</button>
        <button data-testid="travel-decline" onClick={() => onAnswer(false)}>Not now</button>
      </div>
    </section>
  );
}

/** A player at this player's car or booked cab asks to come along; it closes itself after 30 seconds. */
export function RideAskCard({ ask, onAnswer }: { ask: RideAsk; onAnswer: (allow: boolean) => void }) {
  const [shownAt] = useState(() => Date.now());
  const now = useNow(250);
  const left = Math.max(0, Math.ceil((shownAt + 30_000 - now) / 1_000));
  useEffect(() => {
    if (left === 0) onAnswer(false);
  }, [left, onAnswer]);
  return (
    <section className="travel-prompt" role="alertdialog" aria-label="Ride request" data-testid="ride-ask">
      <p>
        <strong>{ask.name}</strong>{" "}
        {ask.cab ? <>wants to share your cab and pay half the fare (₦{ask.share.toLocaleString("en-NG")} back to you).</> : <>is at your car asking for a ride.</>}{" "}
        <small className="muted">{left}s</small>
      </p>
      <div className="row">
        <button className="primary" data-testid="ride-allow" onClick={() => onAnswer(true)}>Let them in</button>
        <button data-testid="ride-decline" onClick={() => onAnswer(false)}>No</button>
      </div>
    </section>
  );
}
