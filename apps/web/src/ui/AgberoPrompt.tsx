import { AGBERO, type AgberoChoice, type AgberoEncounter } from "@lagos-living/shared";
import { useEffect, useState } from "react";
import { naira } from "../api";

/** Non-blocking choice card: steering, pedals and the camera keep working, and simply driving off is an answer. */
export function AgberoPrompt({ encounter, onAnswer }: { encounter: AgberoEncounter; onAnswer: (choice: AgberoChoice) => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);
  const left = Math.max(0, Math.ceil((encounter.expiresAt - now) / 1_000));
  return (
    <section className="travel-prompt agbero-prompt" role="alertdialog" aria-label="Roadside tout" data-testid="agbero-prompt">
      <p>
        <strong>An agbero</strong> (fictional tout) at {encounter.spotName.split("·").pop()?.trim()} wants {naira(encounter.ask)} to "settle the boys". <small className="muted">{left}s</small>
      </p>
      <p className="muted small">
        Paying is optional. If you drive off he may slap the car — at worst one small cosmetic dent (no effect on driving), and nobody follows you.
      </p>
      <div className="row">
        <button className="primary" data-testid="agbero-pay" onClick={() => onAnswer("pay")}>Pay {naira(encounter.ask)}</button>
        {!encounter.negotiated && <button data-testid="agbero-negotiate" onClick={() => onAnswer("negotiate")}>Haggle</button>}
        <button data-testid="agbero-police" onClick={() => onAnswer("police")}>Call police</button>
        {encounter.hasGuards && <button data-testid="agbero-guards" onClick={() => onAnswer("guards")}>Guards</button>}
        <button data-testid="agbero-drive" onClick={() => onAnswer("drive")}>Drive away</button>
      </div>
      <p className="muted small">Turn these off in Phone → Settings → Street life. Lowest he takes: {naira(AGBERO.floor)}.</p>
    </section>
  );
}
