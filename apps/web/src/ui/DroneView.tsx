import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { GameEngine } from "../game/engine";

type Props = {
  engine: GameEngine;
  name: string;
  cars: number;
  onLand: () => void;
};

/** Full-screen drone controls over the live view: drag to circle the house, pinch, scroll or slide to zoom. */
export function DroneView({ engine, name, cars, onLand }: Props) {
  const [zoom, setZoom] = useState(() => engine.droneZoom(null));
  const [orbit, setOrbit] = useState(true);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<number | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onLand();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onLand]);

  const spread = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : null;
  };
  const down = (event: ReactPointerEvent) => {
    (event.target as Element).setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    pinch.current = spread();
  };
  const move = (event: ReactPointerEvent) => {
    const last = pointers.current.get(event.pointerId);
    if (!last) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size >= 2) {
      const now = spread();
      if (now !== null && pinch.current !== null) setZoom(engine.droneZoom(null, (pinch.current - now) * 0.003));
      pinch.current = now;
      return;
    }
    engine.droneLook(event.clientX - last.x, event.clientY - last.y);
  };
  const up = (event: ReactPointerEvent) => {
    pointers.current.delete(event.pointerId);
    pinch.current = spread();
  };

  return (
    <div className="drone-overlay" data-testid="drone-view">
      <div
        className="drone-pad"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onWheel={(event) => setZoom(engine.droneZoom(null, event.deltaY * 0.0012))}
      />
      <header className="drone-bar">
        <span className="drone-rec">● REC</span>
        <div>
          <strong>{name}</strong>
          <small>{cars ? `${cars} car${cars > 1 ? "s" : ""} on show` : "No cars yet — Lekki Motors has some"}</small>
        </div>
        <button className="primary" onClick={onLand} data-testid="drone-land">Land</button>
      </header>
      <footer className="drone-controls">
        <button className="secondary" onClick={() => setZoom(engine.droneZoom(null, -0.12))} aria-label="Fly closer">＋</button>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(zoom * 100)}
          onChange={(event) => setZoom(engine.droneZoom(Number(event.target.value) / 100))}
          aria-label="Drone height"
          data-testid="drone-zoom"
        />
        <button className="secondary" onClick={() => setZoom(engine.droneZoom(null, 0.12))} aria-label="Fly higher">－</button>
        <button
          className={orbit ? "primary" : "secondary"}
          onClick={() => {
            engine.droneOrbit(!orbit);
            setOrbit(!orbit);
          }}
          aria-pressed={orbit}
        >
          ⟳ Orbit
        </button>
      </footer>
      <p className="drone-hint">Drag to circle · pinch or scroll to zoom</p>
    </div>
  );
}
