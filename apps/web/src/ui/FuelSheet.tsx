import { FUEL, type FuelStationState, type Notice } from "@lagos-living/shared";
import { useEffect, useRef, useState } from "react";
import { api, naira } from "../api";
import type { GameEngine } from "../game/engine";

type Props = {
  engine: GameEngine;
  station: { id: string; name: string };
  vehicleId: string;
  fuel: { litres: number; tank: number };
  balance: number;
  onClose: () => void;
  onToast: (notice: Notice) => void;
  onRefresh: () => Promise<void>;
};

type Step = { kind: "ask" } | { kind: "pos"; litres: number } | { kind: "filling"; litres: number; started: number; paid: number } | { kind: "done"; litres: number; paid: number } | { kind: "owner" };

/**
 * At the pumps: the attendant asks how many litres, brings the POS for a card tap, and the pump runs while the
 * litres count up. The station's own page is a tab away: who owns it, and buying it or setting its pump price.
 */
export function FuelSheet({ engine, station, vehicleId, fuel, balance, onClose, onToast, onRefresh }: Props) {
  const [info, setInfo] = useState<FuelStationState | null>(null);
  const [step, setStep] = useState<Step>({ kind: "ask" });
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [price, setPrice] = useState(0);
  const closed = useRef(false);

  const load = () =>
    api.fuelStations()
      .then((stations) => {
        engine.setFuelPrices(Object.fromEntries(stations.map((entry) => [entry.id, entry.price])));
        const mine = stations.find((entry) => entry.id === station.id) ?? null;
        setInfo(mine);
        if (mine) setPrice(mine.price);
      })
      .catch((error: Error) => onToast({ tone: "error", text: error.message }));
  useEffect(() => {
    void load();
    return () => {
      closed.current = true;
      engine.fuelAttendant(station.id, false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [station.id]);

  useEffect(() => {
    if (step.kind !== "filling") return;
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    const done = window.setTimeout(() => {
      if (closed.current) return;
      setStep({ kind: "done", litres: step.litres, paid: step.paid });
      engine.fuelAttendant(station.id, false);
    }, FUEL.fillMs);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(done);
    };
  }, [step, engine, station.id]);

  if (!info) return null;
  const room = Math.floor(fuel.tank - fuel.litres);
  const options = [10, 20, 30].filter((litres) => litres < room).concat(room > 0 ? [room] : []);

  const pay = async (litres: number) => {
    setBusy(true);
    try {
      const result = await api.buyFuel(station.id, vehicleId, litres, info.price);
      setStep({ kind: "filling", litres: result.litres, started: Date.now(), paid: result.paid });
      window.setTimeout(() => engine.setFuelLevel({ vehicleId, litres: result.fuel, tank: result.tank }), FUEL.fillMs);
      await onRefresh();
    } catch (error) {
      onToast({ tone: "error", text: (error as Error).message });
      void load();
    } finally {
      setBusy(false);
    }
  };

  const ownerAction = async (label: string, work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
      onToast({ tone: "success", text: label });
      await load();
      await onRefresh();
    } catch (error) {
      onToast({ tone: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const gauge = Math.round((fuel.litres / fuel.tank) * 100);
  return (
    <div className="sheet-backdrop" onClick={step.kind === "filling" || step.kind === "pos" ? undefined : onClose}>
    <section className="sheet fuel-sheet" role="dialog" aria-label={station.name} onClick={(event) => event.stopPropagation()}>
      <header className="sheet-header">
        <div>
          <p className="eyebrow">⛽ {info.brand}{info.owner ? ` · owned by ${info.mine ? "you" : info.owner}` : ""}</p>
          <h2>{station.name}</h2>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close">✕</button>
      </header>
      <nav className="fuel-tabs">
        <button className={step.kind !== "owner" ? "active" : ""} onClick={() => setStep({ kind: "ask" })} disabled={step.kind === "filling"}>Pump</button>
        <button className={step.kind === "owner" ? "active" : ""} onClick={() => setStep({ kind: "owner" })} disabled={step.kind === "filling" || step.kind === "pos"}>Station</button>
      </nav>
      {step.kind === "ask" && (
        <>
          <p className="fuel-gauge">Tank {fuel.litres} / {fuel.tank} L <i><b style={{ width: `${gauge}%` }} /></i></p>
          <p className="attendant-line">🧑🏿‍🔧 “Welcome oga! PMS is {naira(info.price)} a litre. How many litres?”</p>
          {room < 1 ? (
            <p className="muted">Your tank is full.</p>
          ) : (
            <div className="fuel-options">
              {options.map((litres) => (
                <button
                  key={litres}
                  disabled={busy || balance < litres * info.price}
                  onClick={() => {
                    engine.fuelAttendant(station.id, true);
                    setStep({ kind: "pos", litres });
                  }}
                >
                  <strong>{litres === room ? "Full tank" : `${litres} L`}</strong>
                  <span>{litres === room ? `${litres} L · ` : ""}{naira(litres * info.price)}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {step.kind === "pos" && (
        <div className="pos-terminal">
          <p className="attendant-line">🧑🏿‍🔧 “{step.litres} litres, {naira(step.litres * info.price)}. Tap your card here, sir.”</p>
          <div className="pos-device">
            <div className="pos-screen">
              <small>{info.brand} · PMS</small>
              <strong>{naira(step.litres * info.price)}</strong>
              <span>{step.litres} L @ {naira(info.price)}</span>
            </div>
            <button className="pos-tap" disabled={busy} onClick={() => void pay(step.litres)} aria-label="Tap card on the POS">
              <span className="contactless" aria-hidden="true">)))</span>
              {busy ? "Processing…" : "Tap card"}
            </button>
          </div>
          <button className="secondary" disabled={busy} onClick={() => { engine.fuelAttendant(station.id, false); setStep({ kind: "ask" }); }}>Change amount</button>
        </div>
      )}
      {step.kind === "filling" && (
        <div className="fuel-filling">
          <p className="attendant-line">🧑🏿‍🔧 “Approved! Filling you now…”</p>
          <p className="pump-counter">
            <strong>{(step.litres * Math.min(1, (now - step.started) / FUEL.fillMs)).toFixed(1)}</strong> L
          </p>
          <i className="pump-bar"><b style={{ width: `${Math.min(100, ((now - step.started) / FUEL.fillMs) * 100)}%` }} /></i>
        </div>
      )}
      {step.kind === "done" && (
        <div className="fuel-done">
          <p className="attendant-line">🧑🏿‍🔧 “{step.litres} litres, {naira(step.paid)}. Thank you sir, drive safe!”</p>
          <button className="primary" onClick={onClose}>Drive off</button>
        </div>
      )}
      {step.kind === "owner" && (
        <div className="fuel-owner">
          {info.mine ? (
            <>
              <p>You own this station. Each litre sold pays you the pump price less the {naira(FUEL.depotPrice)} depot price.</p>
              <p className="fuel-stats"><span>{info.litresSold.toLocaleString("en-NG")} L sold</span><span>{naira(info.earned)} earned</span></p>
              <label>
                Pump price ({naira(FUEL.minPrice)}–{naira(FUEL.maxPrice)})
                <input type="number" min={FUEL.minPrice} max={FUEL.maxPrice} step={10} value={price} onChange={(event) => setPrice(Number(event.target.value))} />
              </label>
              <button className="primary" disabled={busy || price === info.price || price < FUEL.minPrice || price > FUEL.maxPrice} onClick={() => void ownerAction(`Pump price set to ${naira(price)}/L`, () => api.setFuelPrice(station.id, price))}>
                Set price
              </button>
            </>
          ) : info.owner ? (
            <p>{info.owner} owns this station and sets its pump price ({naira(info.price)}/L).</p>
          ) : (
            <>
              <p>{info.brand} runs this station at {naira(FUEL.marketerPrice)}/L. Buy it, set your own pump price, and keep {naira(FUEL.marketerPrice - FUEL.depotPrice)} or more on every litre sold.</p>
              <button className="primary" disabled={busy || balance < FUEL.stationPrice} onClick={() => void ownerAction(`You now own ${station.name}`, () => api.buyFuelStation(station.id))}>
                Buy station · {naira(FUEL.stationPrice)}
              </button>
            </>
          )}
        </div>
      )}
    </section>
    </div>
  );
}
