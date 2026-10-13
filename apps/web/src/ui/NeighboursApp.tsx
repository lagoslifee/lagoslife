import { NEIGHBOURS, type FastTravelState } from "@lagos-living/shared";
import { useEffect, useState } from "react";
import { api } from "../api";
import type { GameEngine } from "../game/engine";
import type { PhoneApp } from "./Phone";

type Neighbour = FastTravelState["online"][number];

const initials = (name: string) => name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?";

function distanceLabel(person: Neighbour) {
  if (person.distance === null) return person.where;
  if (person.distance < 25) return `right here · ${person.where}`;
  return person.distance < 1_000 ? `${person.distance} m away · ${person.where}` : `${(person.distance / 1_000).toFixed(1)} km away · ${person.where}`;
}

/**
 * Phone → Neighbours: the people sharing this part of the city with you (a group of up to NEIGHBOURS.groupSize). Wave, go to
 * them, invite them over, add them as a friend or plan a Dubai trip together. When someone leaves, the next arrival takes the place.
 */
export function NeighboursApp({ engine, onToast, onOpen }: { engine: GameEngine | null; onToast: (text: string) => void; onOpen: (app: PhoneApp) => void }) {
  const [state, setState] = useState<FastTravelState | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [befriended, setBefriended] = useState<Set<string>>(new Set());
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
  if (!state) return <p className="muted">Finding your neighbours…</p>;
  const people = [...state.online].sort((a, b) => Number(a.away) - Number(b.away) || (a.distance ?? 1e9) - (b.distance ?? 1e9) || a.name.localeCompare(b.name));
  const nearby = people.filter((person) => person.distance !== null && person.distance < 200).length;
  const addFriend = async (person: Neighbour) => {
    try {
      const { result } = await api.friendRequest(person.name);
      setBefriended((current) => new Set(current).add(person.sessionId));
      onToast(result || `Friend request sent to ${person.name}.`);
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Could not send the request.");
    }
  };
  return (
    <div className="neighbours" data-testid="neighbours-app">
      <p className="neighbours-intro">
        <strong>{people.length + 1}</strong> of {NEIGHBOURS.groupSize} in your neighbourhood right now{nearby ? ` · ${nearby} close by` : ""}. Groups stay small so the city never
        feels packed; when someone leaves, a new neighbour takes their place.
      </p>
      {people.length === 0 && <p className="muted small">It's quiet right now. Invite a friend from Phone → Invite, or check back soon — new neighbours arrive all the time.</p>}
      <ul className="neighbour-list">
        {people.map((person) => (
          <li key={person.sessionId} className={`neighbour${person.away ? " away" : ""}${open === person.sessionId ? " open" : ""}`}>
            <button className="neighbour-row" onClick={() => setOpen((current) => (current === person.sessionId ? null : person.sessionId))} aria-expanded={open === person.sessionId}>
              <span className="neighbour-face" aria-hidden>{initials(person.name)}</span>
              <span className="neighbour-name">
                {person.name}
                <small className="muted">{person.away ? "Gone quiet · " : ""}{distanceLabel(person)}</small>
              </span>
              <span className="neighbour-more" aria-hidden>{open === person.sessionId ? "▴" : "▾"}</span>
            </button>
            {open === person.sessionId && (
              <div className="neighbour-actions">
                <button onClick={() => engine.waveAt(person.sessionId)}>👋 Wave</button>
                <button onClick={() => engine.askToJoin(person.sessionId)}>🚶 Go to them</button>
                <button onClick={() => engine.inviteToMe(person.sessionId)}>📍 Invite here</button>
                <button disabled={befriended.has(person.sessionId)} onClick={() => void addFriend(person)}>{befriended.has(person.sessionId) ? "✓ Request sent" : "➕ Add friend"}</button>
                <button onClick={() => onOpen("travel")}>✈ Plan a trip</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <p className="muted small">Nobody moves without saying yes: "Go to them" and "Invite here" both ask first. To plan a trip, invite them by username in Travel.</p>
    </div>
  );
}
