import { useEffect, useState } from "react";

/** Real in-game captures (full graphics), shown before sign-up so people see the city they're joining. */
const SCENES = [
  { image: "lekki-traffic", place: "Admiralty Way, Lekki", line: "Traffic, danfos and people on the move" },
  { image: "resident", place: "Kayode Court, Lekki", line: "Your resident: pick your look, then step out" },
  { image: "lekki-motors", place: "Lekki Motors", line: "Test-drive and buy real cars" },
  { image: "admiralty-lounge", place: "Admiralty Lounge", line: "Nightclubs, VIP tables and bottle service" },
  { image: "ikoyi-mansion", place: "Milverton Mansion, Ikoyi", line: "Rent, buy or build your home" },
  { image: "dubai-marina", place: "Dubai Marina", line: "Get a visa and fly to Dubai" },
  { image: "dhow-pier", place: "Marina Dhow Pier", line: "Hotels, beaches and the marina" },
  { image: "desert-camp", place: "Golden Dune Camp", line: "Desert trips outside the city" },
] as const;
const SLIDE_MS = 4_500;

export function CityReel() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [ready, setReady] = useState<Set<number>>(() => new Set([0]));

  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(() => setIndex((current) => (current + 1) % SCENES.length), SLIDE_MS);
    return () => clearTimeout(timer);
  }, [index, paused]);
  useEffect(() => {
    const next = (index + 1) % SCENES.length;
    if (ready.has(next)) return;
    const image = new Image();
    image.onload = () => setReady((current) => new Set(current).add(next));
    image.src = `/showcase/${SCENES[next]!.image}.webp`;
  }, [index, ready]);

  const scene = SCENES[index]!;
  return (
    <figure className="city-reel" data-testid="city-reel" aria-roledescription="carousel" aria-label="A look around the city">
      <div className="city-reel-frame" onClick={() => setIndex((index + 1) % SCENES.length)}>
        {SCENES.map((entry, i) =>
          ready.has(i) || i === index ? (
            <img key={entry.image} src={`/showcase/${entry.image}.webp`} alt={i === index ? `${entry.place}: ${entry.line}` : ""} className={i === index ? "on" : ""} draggable={false} />
          ) : null,
        )}
        <div className="city-reel-bars" aria-hidden>
          {SCENES.map((entry, i) => (
            <span key={entry.image} className={i < index ? "done" : i === index ? (paused ? "now paused" : "now") : ""} style={i === index ? { animationDuration: `${SLIDE_MS}ms` } : undefined} />
          ))}
        </div>
        <figcaption>
          <strong>{scene.place}</strong>
          <span>{scene.line}</span>
        </figcaption>
      </div>
      <div className="city-reel-meta">
        <small>Real in-game views · tap to skip</small>
        <button type="button" className="link small" onClick={() => setPaused(!paused)} aria-pressed={paused}>{paused ? "▶ Play" : "❚❚ Pause"}</button>
      </div>
    </figure>
  );
}
