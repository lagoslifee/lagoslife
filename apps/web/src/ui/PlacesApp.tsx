import { PLACES, regionOf, type Place, type Vec2 } from "@lagos-living/shared";
import { useMemo, useState } from "react";
import type { GameEngine, HudState } from "../game/engine";
import { CATEGORY_LABEL, PLACE_KIND, type PlaceCategory } from "../place-kinds";

export type CabDestination = { key: string; label: string; sub: string; point: Vec2 };

type Props = {
  engine: GameEngine | null;
  hud: HudState | null;
  onNavigate: (target: { point: Vec2; label: string }) => void;
  onCab: (destination: CabDestination) => void;
  onClose: () => void;
};

const distanceLabel = (metres: number) => (metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres / 10) * 10} m`);

/** Phone → Places: every venue on this side of the flight, by category and distance, with a route or a cab to each. */
export function PlacesApp({ engine, hud, onNavigate, onCab, onClose }: Props) {
  const [category, setCategory] = useState<PlaceCategory | "all">("all");
  const [query, setQuery] = useState("");
  const region = engine?.playerRegion() ?? "lagos";
  const here: Vec2 | null = hud ? [hud.x, hud.z] : null;
  const local = useMemo(
    () => PLACES.filter((place) => place.kind !== "delivery" && regionOf(place.door[0], place.door[1]) === region),
    [region],
  );
  const categories = useMemo(() => {
    const present = new Set(local.map((place) => PLACE_KIND[place.kind].category));
    return (Object.keys(CATEGORY_LABEL) as PlaceCategory[]).filter((key) => present.has(key));
  }, [local]);
  const term = query.trim().toLowerCase();
  const list = local
    .filter((place) => category === "all" || PLACE_KIND[place.kind].category === category)
    .filter((place) => !term || `${place.name} ${place.street} ${PLACE_KIND[place.kind].label}`.toLowerCase().includes(term))
    .map((place) => ({ place, metres: here ? Math.hypot(place.door[0] - here[0], place.door[1] - here[1]) : 0 }))
    .sort((a, b) => a.metres - b.metres);
  const driving = Boolean(hud?.vehicle);
  const guide = (place: Place) => {
    onNavigate({ point: driving ? place.kerb : place.door, label: place.name });
    onClose();
  };
  return (
    <div className="app-section places-app" data-testid="places-app">
      <input className="go-filter" placeholder="Search places" value={query} onChange={(event) => setQuery(event.target.value)} />
      <div className="place-chips" role="tablist">
        <button role="tab" aria-selected={category === "all"} className={category === "all" ? "on" : ""} onClick={() => setCategory("all")}>All {local.length}</button>
        {categories.map((key) => (
          <button key={key} role="tab" aria-selected={category === key} className={category === key ? "on" : ""} onClick={() => setCategory(key)}>
            {CATEGORY_LABEL[key]}
          </button>
        ))}
      </div>
      <ul className="place-cards">
        {list.map(({ place, metres }) => {
          const info = PLACE_KIND[place.kind];
          return (
            <li key={place.id} className="place-card" data-testid={`place-${place.id}`}>
              <span className="place-icon" style={{ background: info.colour }} aria-hidden>{info.icon}</span>
              <div className="place-text">
                <strong>{place.name}</strong>
                <small>{info.label} · {place.street}</small>
                {here && <small className="muted">{distanceLabel(metres)} away</small>}
              </div>
              <div className="place-actions">
                <button className="primary" onClick={() => guide(place)}>{driving ? "Drive" : metres < 700 ? "Walk" : "Drive / walk"}</button>
                <button onClick={() => onCab({ key: place.id, label: place.name, sub: `${info.label} · ${place.street}`, point: place.kerb })}>Cab</button>
              </div>
            </li>
          );
        })}
        {!list.length && <li className="muted small">No place matches “{query}”.</li>}
      </ul>
      <p className="muted small">Drive or walk draws the route on the road and ends when you arrive. Cab opens Ride with the fare for that place.</p>
    </div>
  );
}
