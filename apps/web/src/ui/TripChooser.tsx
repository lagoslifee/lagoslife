import { RIDE, type Vec2 } from "@lagos-living/shared";
import { useMemo } from "react";
import { naira } from "../api";
import type { GameEngine } from "../game/engine";

export type TripTarget = { point: Vec2; label: string };

/** "How do you want to get there?": a small card above the controls, so the game stays visible behind it. */
export function TripChooser({ engine, target, onRoute, onCab, onClose }: {
  engine: GameEngine;
  target: TripTarget;
  onRoute: (target: TripTarget) => void;
  onCab: () => void;
  onClose: () => void;
}) {
  const key = `${target.label}|${target.point.join()}`;
  const cab = useMemo(() => engine.rideOffer(target.point, target.label), [key]);
  const express = useMemo(() => engine.rideOffer(target.point, target.label, true), [key]);
  const pose = engine.pose();
  const metres = Math.round(Math.hypot(target.point[0] - pose.x, target.point[1] - pose.z));
  const distance = metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${metres} m`;
  return (
    <div className="trip-chooser" role="dialog" aria-label={`Getting to ${target.label}`} data-testid="trip-chooser">
      <div className="trip-head">
        <strong>{target.label}</strong>
        <small className="muted">{pose.indoors ? "from the door" : distance}</small>
        <button className="trip-close" aria-label="Close" onClick={onClose}>✕</button>
      </div>
      <div className="trip-options">
        <button className="secondary" data-testid="trip-route" onClick={() => { onRoute(target); onClose(); }}>
          🚗 Drive / walk
          <small>route on the road</small>
        </button>
        <button
          className="secondary"
          data-testid="trip-cab"
          disabled={Boolean(cab.problem)}
          title={cab.problem ?? undefined}
          onClick={() => { engine.bookRide(target.point, target.label); onCab(); onClose(); }}
        >
          🚕 Cab · {cab.problem ? "—" : naira(cab.fare)}
          <small>ride along, ~10 s pickup</small>
        </button>
        <button
          className="primary"
          data-testid="trip-express"
          disabled={Boolean(express.problem)}
          title={express.problem ?? undefined}
          onClick={() => { engine.bookRide(target.point, target.label, true); onClose(); }}
        >
          ⚡ Express · {express.problem ? "—" : naira(express.fare)}
          <small>there in 3 s (+{naira(RIDE.expressFee)})</small>
        </button>
      </div>
      {(express.problem || cab.problem) && <p className="trip-note">{express.problem ?? cab.problem}</p>}
    </div>
  );
}
