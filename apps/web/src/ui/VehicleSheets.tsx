import {
  getPlace,
  insurancePremium,
  VEHICLE_MODELS,
  VEHICLE_RULES,
  vehicleModelById,
  type Notice,
  type Place,
  type Vec2,
} from "@lagos-living/shared";
import { useState } from "react";
import { api, naira, type EconomyState, type MyVehicle, type PropertyListing } from "../api";

const kmh = (metresPerSecond: number) => Math.round(metresPerSecond * 3.6);
const km = (metres: number) => `${(metres / 1000).toFixed(1)} km`;

function useRunner(onToast: (notice: Notice) => void, onRefresh: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<string>) => {
    setBusy(true);
    try {
      onToast({ tone: "success", text: await work() });
      await onRefresh();
    } catch (error) {
      onToast({ tone: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

function ConditionBar({ value }: { value: number }) {
  const tone = value < VEHICLE_RULES.limpCondition ? "bad" : value < 70 ? "warn" : "good";
  return (
    <span className={`condition ${tone}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-label="Condition">
      <i style={{ width: `${value}%` }} />
      <b>{value}%</b>
    </span>
  );
}

type SheetProps = {
  place: Place;
  economy: EconomyState | null;
  vehicles: MyVehicle[];
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onToast: (notice: Notice) => void;
};

export function DealershipSheet({ place, economy, vehicles, onClose, onRefresh, onToast, onBought }: SheetProps & { onBought: (vehicle: MyVehicle) => void }) {
  const { busy, run } = useRunner(onToast, onRefresh);
  const [colours, setColours] = useState<Record<string, string>>(() => Object.fromEntries(VEHICLE_MODELS.map((model) => [model.id, model.colours[0]!])));
  const [confirming, setConfirming] = useState<{ modelId: string; key: string } | null>(null);
  const balance = economy?.balance ?? 0;
  const full = vehicles.length >= 3;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section className="sheet wide" role="dialog" aria-label={place.name} onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <p className="eyebrow">{place.street.toUpperCase()} · DEALERSHIP</p>
            <h2>{place.name}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <p className="muted">Fictional models, paid in game naira. Your car is parked outside on Admiralty Way the moment you sign. You own {vehicles.length} of 3 allowed.</p>
        <ul className="menu vehicle-menu">
          {VEHICLE_MODELS.map((model) => {
            const colour = colours[model.id]!;
            const affordable = balance >= model.price;
            const pending = confirming?.modelId === model.id;
            return (
              <li key={model.id} data-testid={`model-${model.id}`}>
                <div>
                  <strong>{model.name}</strong>
                  <span>{model.description}</span>
                  <em>
                    Top speed {kmh(model.topSpeed)} km/h · 0–50 km/h in {(13.9 / model.acceleration).toFixed(1)} s · cover {naira(insurancePremium(model))}/week
                  </em>
                  <div className="swatches" role="radiogroup" aria-label={`${model.name} colour`}>
                    {model.colours.map((hex) => (
                      <button
                        key={hex}
                        role="radio"
                        aria-checked={hex === colour}
                        aria-label={`Colour ${hex}`}
                        className={hex === colour ? "swatch selected" : "swatch"}
                        style={{ background: hex }}
                        onClick={() => setColours((current) => ({ ...current, [model.id]: hex }))}
                      />
                    ))}
                  </div>
                </div>
                <div className="menu-actions">
                  {pending ? (
                    <>
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() => void run(async () => {
                          const result = await api.buyVehicle(model.id, colour, confirming.key);
                          setConfirming(null);
                          onBought(result.vehicle);
                          return `${model.name} ${result.vehicle.plate} is yours and parked outside. Balance ${naira(result.balance ?? balance - model.price)}.`;
                        })}
                      >Confirm {naira(model.price)}</button>
                      <button className="secondary" onClick={() => setConfirming(null)}>Not yet</button>
                    </>
                  ) : (
                    <button
                      className="primary"
                      disabled={busy || !affordable || full}
                      onClick={() => setConfirming({ modelId: model.id, key: crypto.randomUUID() })}
                    >
                      {full ? "Garage limit reached" : affordable ? `Buy ${naira(model.price)}` : `Need ${naira(model.price)}`}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        <p className="muted small">Your balance: {naira(balance)}. Earn more with Swift Parcel deliveries.</p>
      </section>
    </div>
  );
}

export function MechanicSheet({ place, vehicles, onClose, onRefresh, onToast }: SheetProps) {
  const { busy, run } = useRunner(onToast, onRefresh);
  const atWorkshop = (vehicle: MyVehicle) =>
    vehicle.status === "parked" &&
    vehicle.x !== null &&
    vehicle.z !== null &&
    Math.hypot(vehicle.x - place.kerb[0], vehicle.z - place.kerb[1]) <= VEHICLE_RULES.workshopRange;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section className="sheet" role="dialog" aria-label={place.name} onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <p className="eyebrow">{place.street.toUpperCase()} · MECHANIC</p>
            <h2>{place.name}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <p className="muted">
          Park outside and we will service it: {naira(VEHICLE_RULES.routineServiceFee)} check-up plus any repairs. With cover you pay at most {naira(VEHICLE_RULES.insuredExcess)} towards repairs. Cars under {VEHICLE_RULES.limpCondition}% run in limp mode.
        </p>
        {!vehicles.length && <p>You do not own a vehicle yet. Lekki Motors is further east on Admiralty Way.</p>}
        <ul className="menu">
          {vehicles.map((vehicle) => {
            const here = atWorkshop(vehicle);
            const nothingToDo = vehicle.condition >= 100 && vehicle.metresSinceService < 500;
            return (
              <li key={vehicle.id} data-testid={`service-${vehicle.id}`}>
                <div>
                  <strong>{vehicle.modelName} · {vehicle.plate}</strong>
                  <ConditionBar value={vehicle.condition} />
                  <span>
                    {km(vehicle.odometerMetres)} on the clock · {vehicle.serviceDue ? "service due" : `${km(Math.max(0, VEHICLE_RULES.serviceIntervalMetres - vehicle.metresSinceService))} to next service`}
                  </span>
                  {here && !nothingToDo && (
                    <em>
                      Quote: {naira(VEHICLE_RULES.routineServiceFee)} service
                      {vehicle.serviceQuote.repair > 0 ? ` + ${naira(vehicle.serviceQuote.repair)} repairs` : ""}
                      {vehicle.insured && vehicle.serviceQuote.fullRepair > vehicle.serviceQuote.repair ? ` (cover saves ${naira(vehicle.serviceQuote.fullRepair - vehicle.serviceQuote.repair)})` : ""}
                    </em>
                  )}
                </div>
                <div className="menu-actions">
                  {here ? (
                    <button
                      className="primary"
                      disabled={busy || nothingToDo}
                      onClick={() => void run(async () => {
                        const result = await api.serviceVehicle(vehicle.id);
                        return `${vehicle.plate} serviced and repaired for ${naira(result.charged ?? vehicle.serviceQuote.total)}. Condition 100%.`;
                      })}
                    >{nothingToDo ? "Running well" : `Service ${naira(vehicle.serviceQuote.total)}`}</button>
                  ) : vehicle.status === "garaged" ? (
                    <span className="muted small">In your garage</span>
                  ) : vehicle.status === "driving" ? (
                    <span className="muted small">Park it outside first</span>
                  ) : (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => void run(async () => {
                        const result = await api.towVehicle(vehicle.id);
                        return result.charged ? `Towed here for ${naira(result.charged)}.` : "Towed here free under your cover.";
                      })}
                    >{vehicle.insured ? "Tow it here (free)" : `Tow it here ${naira(VEHICLE_RULES.towFee)}`}</button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

type AppProps = {
  vehicles: MyVehicle[];
  properties: PropertyListing[];
  position: Vec2 | null;
  drivingId: string | null;
  onNavigate: (target: { point: Vec2; label: string } | null) => void;
  onRefresh: () => Promise<void>;
  onToast: (notice: Notice) => void;
  onClose: () => void;
};

export function VehiclesApp({ vehicles, properties, position, drivingId, onNavigate, onRefresh, onToast, onClose }: AppProps) {
  const { busy, run } = useRunner(onToast, onRefresh);
  const homes = properties.filter((listing) => listing.isMine);
  if (!vehicles.length) {
    return (
      <div className="app-section">
        <p>You don't own a vehicle yet.</p>
        <p className="muted">Browse cars at Lekki Motors on Admiralty Way. Prices start at {naira(Math.min(...VEHICLE_MODELS.map((model) => model.price)))}. Until then, the danfo is ₦300 a ride.</p>
        <button className="primary" onClick={() => { onNavigate({ point: getPlace("lekki-motors").door, label: "Lekki Motors" }); onClose(); }}>Show Lekki Motors on the map</button>
      </div>
    );
  }
  return (
    <div className="app-section">
      <ul className="vehicle-list">
        {vehicles.map((vehicle) => {
          const model = vehicleModelById.get(vehicle.modelId);
          const distance = position && vehicle.x !== null && vehicle.z !== null ? Math.round(Math.hypot(vehicle.x - position[0], vehicle.z - position[1])) : null;
          const nearHome = homes.find((home) => vehicle.x !== null && vehicle.z !== null && Math.hypot(home.door[0] - vehicle.x, home.door[1] - vehicle.z) <= VEHICLE_RULES.garageRange);
          const garage = homes.find((home) => home.id === vehicle.garagePropertyId);
          const driving = drivingId === vehicle.id;
          return (
            <li key={vehicle.id} className="vehicle-card" data-testid={`vehicle-${vehicle.id}`}>
              <div className="row spread">
                <strong><i className="paint-dot" style={{ background: vehicle.colour }} /> {vehicle.modelName}</strong>
                <span className="plate">{vehicle.plate}</span>
              </div>
              <ConditionBar value={vehicle.condition} />
              <p className="muted small">
                {driving ? "You are driving it" : vehicle.status === "garaged" ? `In the garage at ${garage?.name ?? "your home"}` : distance !== null ? `Parked ${distance} m away` : "Parked"}
                {" · "}{km(vehicle.odometerMetres)}{vehicle.serviceDue ? " · service due" : ""}
                {model ? ` · top ${kmh(model.topSpeed)} km/h` : ""}
              </p>
              <p className="small">{vehicle.insured ? `Insured until ${new Date(vehicle.insuredUntil!).toLocaleDateString("en-NG", { day: "numeric", month: "short" })}: free tows, repairs capped at ${naira(VEHICLE_RULES.insuredExcess)}` : "Not insured"}</p>
              <div className="row wrap">
                {vehicle.status === "parked" && vehicle.x !== null && vehicle.z !== null && !driving && (
                  <button className="secondary" onClick={() => { onNavigate({ point: [vehicle.x!, vehicle.z!], label: `Your ${vehicle.modelName}` }); onClose(); }}>Find my car</button>
                )}
                {!vehicle.insured && (
                  <button className="secondary" disabled={busy} onClick={() => void run(async () => {
                    await api.insureVehicle(vehicle.id);
                    return `${vehicle.plate} insured for ${VEHICLE_RULES.insuranceDays} days.`;
                  })}>Insure 7 days · {naira(vehicle.premium)}</button>
                )}
                {vehicle.status === "parked" && !driving && (
                  <button className="secondary" disabled={busy} onClick={() => void run(async () => {
                    const result = await api.towVehicle(vehicle.id);
                    return result.charged ? `Towed to Ade Auto Works for ${naira(result.charged)}.` : "Towed to Ade Auto Works free under your cover.";
                  })}>Tow to mechanic · {vehicle.insured ? "free" : naira(VEHICLE_RULES.towFee)}</button>
                )}
                {vehicle.status === "parked" && !driving && nearHome && (
                  <button className="secondary" disabled={busy} onClick={() => void run(async () => {
                    await api.garageVehicle(vehicle.id, nearHome.id);
                    return `${vehicle.plate} is in the garage at ${nearHome.name}.`;
                  })}>Put in garage · {nearHome.name}</button>
                )}
                {vehicle.status === "garaged" && (
                  <button className="primary" disabled={busy} onClick={() => void run(async () => {
                    await api.retrieveVehicle(vehicle.id);
                    return `${vehicle.plate} is parked outside ${garage?.name ?? "your home"}.`;
                  })}>Take it out</button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="muted small">Drive: W/S accelerate and brake, A/D steer, Space handbrake, E to step out, Q horn. Collisions reduce condition.</p>
    </div>
  );
}
