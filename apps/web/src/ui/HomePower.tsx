import { DIESEL, GENERATORS, generatorModel, type HomePower as Power, type Notice } from "@lagos-living/shared";
import { useCallback, useEffect, useState } from "react";
import { api, naira } from "../api";
import type { GameEngine } from "../game/engine";

type Props = {
  /** Something else has the screen; the light keeps following NEPA underneath. */
  hidden: boolean;
  engine: GameEngine;
  propertyId: string;
  balance: number;
  onToast: (notice: Notice) => void;
  onRefresh: () => Promise<void>;
};

const LABEL: Record<Power["source"], string> = { nepa: "⚡ NEPA light", generator: "🔊 Gen on", none: "🕯️ NEPA took light" };

function until(iso: string) {
  const minutes = Math.max(1, Math.round((new Date(iso).getTime() - Date.now()) / 60_000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}

/**
 * Light at home: a chip showing whether NEPA has light or the generator is carrying the house, and a card to install a
 * generator, buy diesel, flip the switch and set up the diesel standing order.
 */
export function HomePower({ hidden, engine, propertyId, balance, onToast, onRefresh }: Props) {
  const [power, setPower] = useState<Power | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const poll = useCallback(() => api.power(propertyId, true).then(setPower).catch(() => undefined), [propertyId]);
  useEffect(() => {
    void poll();
    const timer = window.setInterval(poll, 30_000);
    return () => {
      window.clearInterval(timer);
      engine.setHomePower(null);
    };
  }, [engine, poll]);
  useEffect(() => {
    if (!power) return;
    engine.setHomePower(power.source);
    // Re-check as NEPA changes, rather than waiting for the next poll.
    const wait = new Date(power.changesAt).getTime() - Date.now() + 1_500;
    if (wait > 0 && wait < 30_000) {
      const timer = window.setTimeout(poll, wait);
      return () => window.clearTimeout(timer);
    }
  }, [engine, power, poll]);

  const run = async (success: string, work: () => Promise<{ power: Power }>) => {
    setBusy(true);
    try {
      const result = await work();
      setPower(result.power);
      onToast({ tone: "success", text: success });
      await onRefresh();
    } catch (error) {
      onToast({ tone: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (!power || hidden) return null;
  const model = generatorModel(power.generator);
  const space = Math.floor(power.tank - power.litres);
  const fill = space * DIESEL.pricePerLitre;
  return (
    <>
      <button type="button" className={`power-chip ${power.source}`} onClick={() => setOpen(!open)} aria-expanded={open}>
        {LABEL[power.source]}
        {model && <small>{power.litres} L</small>}
      </button>
      {open && (
        <section className="power-card" role="dialog" aria-label="Light and generator">
          <header>
            <h3>{power.nepa ? "NEPA has light" : "NEPA took light"}</h3>
            <button type="button" className="close" onClick={() => setOpen(false)} aria-label="Close">✕</button>
          </header>
          <p className="muted">
            {power.nepa ? `Light could go in about ${until(power.changesAt)}.` : `Light should be back in about ${until(power.changesAt)}.`}
            {!power.nepa && power.source === "none" && (model ? (power.litres <= 0 ? " The tank is dry." : " The generator is switched off.") : " No generator, so it's candles for now.")}
          </p>
          {model ? (
            <>
              <div className="power-tank" aria-label={`${power.litres} of ${power.tank} litres`}>
                <i style={{ width: `${Math.min(100, (power.litres / power.tank) * 100)}%` }} />
                <span>{model.name} · {power.litres} / {power.tank} L diesel</span>
              </div>
              <div className="power-actions">
                <button type="button" disabled={busy} onClick={() => void run(power.running ? "Generator switched off" : "Generator switched on — it starts whenever NEPA goes", () => api.switchGenerator(propertyId, { running: !power.running }))}>
                  {power.running ? "⏻ Switch off" : "⏻ Switch on"}
                </button>
                <button type="button" disabled={busy || space < 5 || balance < 10 * DIESEL.pricePerLitre} onClick={() => void run("10 L of diesel delivered", () => api.buyDiesel(propertyId, Math.min(10, space)))}>
                  +10 L · {naira(Math.min(10, space) * DIESEL.pricePerLitre)}
                </button>
                <button type="button" disabled={busy || space < 5 || balance < fill} onClick={() => void run(`Tank filled with ${space} L`, () => api.buyDiesel(propertyId, space))}>
                  Fill up · {naira(fill)}
                </button>
              </div>
              <label className="power-auto">
                <input type="checkbox" checked={power.autoDiesel} disabled={busy} onChange={(event) => void run(event.target.checked ? "Standing order set: diesel is topped up and debited from your account" : "Standing order cancelled", () => api.switchGenerator(propertyId, { autoDiesel: event.target.checked }))} />
                Standing order with {DIESEL.supplier}: refill below {Math.round(DIESEL.refillBelow * 100)}% and debit my account ({naira(DIESEL.pricePerLitre)}/L)
              </label>
              <p className="muted small">It only burns diesel through cuts while someone is home; the gateman switches it off after you leave.</p>
            </>
          ) : null}
          <h4>{model ? "Change generator" : "Install a generator"}</h4>
          <ul className="power-models">
            {GENERATORS.filter((entry) => entry.id !== power.generator).map((entry) => (
              <li key={entry.id}>
                <div>
                  <strong>{entry.name}</strong>
                  <span>{entry.blurb} {entry.tank} L tank.</span>
                </div>
                <button type="button" disabled={busy || balance < entry.price} onClick={() => void run(`${entry.name} installed with 10 L of diesel`, () => api.buyGenerator(propertyId, entry.id))}>
                  {naira(entry.price)}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
