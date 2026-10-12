import { HOTELS, TRAVEL_PLACES, placeById, type Vec2 } from "@lagos-living/shared";
import { useState } from "react";
import type { GameEngine } from "../game/engine";

type Target = { point: Vec2; label: string };

const route = (placeId: string, label?: string): (Target & { id: string }) | null => {
  const place = placeById.get(placeId);
  return place ? { id: placeId, point: place.door, label: label ?? place.name } : null;
};

/** Replaces the Lagos first-session guide while the player is in Dubai: what there is to do here and how to get home. */
export function DubaiGuide({ engine, here, onNavigate }: { engine: GameEngine | null; here: Vec2 | null; onNavigate: (target: Target) => void }) {
  const tour = engine?.tourState() ?? null;
  const [open, setOpen] = useState(true);
  const hotel = HOTELS.map((entry) => route(entry.id))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((a, b) => (here ? Math.hypot(a.point[0] - here[0], a.point[1] - here[1]) - Math.hypot(b.point[0] - here[0], b.point[1] - here[1]) : 0))[0];
  const stops = [
    hotel && { ...hotel, icon: "🏨", text: "Hotel" },
    route(TRAVEL_PLACES.tourism) && { ...route(TRAVEL_PLACES.tourism)!, icon: "🐪", text: "Safari & dhow" },
    route(TRAVEL_PLACES.club) && { ...route(TRAVEL_PLACES.club)!, icon: "🍸", text: "Pearl Club" },
    route(TRAVEL_PLACES.carRental) && { ...route(TRAVEL_PLACES.carRental)!, icon: "🚗", text: "Car hire" },
  ].filter(Boolean) as Array<Target & { id: string; icon: string; text: string }>;
  const airport = route(TRAVEL_PLACES.dubaiAirport, "Dubai International Airport");
  const tourism = route(TRAVEL_PLACES.tourism);
  const atCentre = Boolean(tourism && here && Math.hypot(tourism.point[0] - here[0], tourism.point[1] - here[1]) < 120);
  if (!open) {
    return (
      <button className="dubai-guide-chip" data-testid="dubai-guide-chip" onClick={() => setOpen(true)}>
        🇦🇪 Dubai guide
      </button>
    );
  }
  return (
    <section className="dubai-guide" data-testid="dubai-guide">
      <header>
        <strong>🇦🇪 You're in Dubai</strong>
        <button className="icon-button" onClick={() => setOpen(false)} aria-label="Hide Dubai guide">–</button>
      </header>
      <p>Tap a place for a route. Everything here is in Dubai; your Lagos home, jobs and danfos are back in Lagos.</p>
      {tour ? (
        <div className="dubai-tour" data-testid="dubai-tour">
          <span>🧭 Walking tour · stop {Math.min(tour.index + 1, tour.total)} of {tour.total}{tour.stop ? ` · ${tour.stop}` : " · finished"} · your guide is {tour.guideMetres} m away</span>
          <button className="small-button" onClick={() => engine?.endTour()}>End tour</button>
        </div>
      ) : (
        <button
          className="dubai-tour-start"
          data-testid="dubai-tour-start"
          onClick={() => (atCentre ? engine?.startTour() : tourism && onNavigate(tourism))}
        >
          {atCentre ? "🧭 Start the free walking tour with a guide" : "🧭 Free guided tour — starts at the tourism centre (route there)"}
        </button>
      )}
      <div className="dubai-guide-stops">
        {stops.map((stop) => (
          <button key={stop.id} onClick={() => onNavigate(stop)}>
            {stop.icon} {stop.text}
          </button>
        ))}
      </div>
      {airport && (
        <button className="primary dubai-home" data-testid="dubai-route-airport" onClick={() => onNavigate(airport)}>
          ✈ Back to Lagos: go to Dubai International Airport
        </button>
      )}
    </section>
  );
}
