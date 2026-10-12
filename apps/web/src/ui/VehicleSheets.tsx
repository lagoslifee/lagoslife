import {
  getPlace,
  insurancePremium,
  VEHICLE_MODELS,
  vehicleCategories,
  vehicleCategoryLabels,
  VEHICLE_RULES,
  vehicleModelById,
  TOW_STAGE_LABEL,
  type Notice,
  type TowDestination,
  type TowStage,
  type TowState,
  type Place,
  type VehicleCategory,
  type Vec2,
} from "@lagos-living/shared";
import { useEffect, useState } from "react";
import { api, naira, type EconomyState, type MyVehicle, type PropertyListing } from "../api";
import type { GameEngine } from "../game/engine";

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

export function DealershipSheet({ place, economy, vehicles, onClose, onRefresh, onToast, onBought, onTestDrive, onPreview }: SheetProps & {
  onBought: (vehicle: MyVehicle) => void;
  onTestDrive: (modelId: string, colour: string) => void;
  /** Shows the selected model on the forecourt in the game view; null when the sheet closes. */
  onPreview: (choice: { modelId: string; colour: string } | null) => void;
}) {
  const [selected, setSelected] = useState(VEHICLE_MODELS[0]!.id);
  const { busy, run } = useRunner(onToast, onRefresh);
  const [colours, setColours] = useState<Record<string, string>>(() => Object.fromEntries(VEHICLE_MODELS.map((model) => [model.id, model.colours[0]!])));
  const [confirming, setConfirming] = useState<{ modelId: string; key: string } | null>(null);
  const [category, setCategory] = useState<VehicleCategory | "all">("all");
  const shown = VEHICLE_MODELS.filter((model) => category === "all" || model.category === category);
  const offered = vehicleCategories.filter((key) => VEHICLE_MODELS.some((model) => model.category === key));
  const balance = economy?.balance ?? 0;
  const bicycles = vehicles.filter((owned) => vehicleModelById.get(owned.modelId)?.body === "bicycle").length;
  const isFull = (model: { body: string }) => (model.body === "bicycle" ? bicycles >= 2 : vehicles.length - bicycles >= 3);
  const selectedColour = colours[selected]!;
  useEffect(() => {
    onPreview({ modelId: selected, colour: selectedColour });
  }, [selected, selectedColour, onPreview]);
  useEffect(() => () => onPreview(null), [onPreview]);

  return (
    <div className="sheet-backdrop see-through" onClick={onClose}>
      <section className="sheet wide showcase-sheet" role="dialog" aria-label={place.name} onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <p className="eyebrow">{place.street.toUpperCase()} · DEALERSHIP</p>
            <h2>{place.name}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <p className="muted small">Tap a car to see it outside. It is parked on Admiralty Way the moment you sign · up to 3 motor vehicles and 2 bicycles.</p>
        <p className="muted small preview-name">Showing on the forecourt: <strong>{vehicleModelById.get(selected)!.name}</strong> · the exact model and colour you will get</p>
        <div className="category-chips" role="tablist" aria-label="Vehicle category">
          {(["all", ...offered] as const).map((key) => (
            <button
              key={key}
              role="tab"
              aria-selected={category === key}
              className={category === key ? "chip selected" : "chip"}
              onClick={() => setCategory(key)}
            >
              {key === "all" ? `All (${VEHICLE_MODELS.length})` : vehicleCategoryLabels[key]}
            </button>
          ))}
        </div>
        <ul className="menu vehicle-menu">
          {shown.map((model) => {
            const colour = colours[model.id]!;
            const affordable = balance >= model.price;
            const pending = confirming?.modelId === model.id;
            const full = isFull(model);
            return (
              <li key={model.id} data-testid={`model-${model.id}`} className={selected === model.id ? "selected" : ""} onClick={() => setSelected(model.id)}>
                <div>
                  <strong>{model.name}</strong>
                  <span>{model.description}</span>
                  <em>
                    {vehicleCategoryLabels[model.category]} · {model.seats} {model.seats === 1 ? "seat" : "seats"} · top speed {kmh(model.topSpeed)} km/h
                    {model.body === "bicycle" ? "" : ` · 0–50 km/h in ${(13.9 / model.acceleration).toFixed(1)} s · cover ${naira(insurancePremium(model))}/week`}
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
                        onClick={() => {
                          setColours((current) => ({ ...current, [model.id]: hex }));
                          setSelected(model.id);
                        }}
                      />
                    ))}
                  </div>
                </div>
                <div className="menu-actions">
                  <button className="secondary" onClick={() => onTestDrive(model.id, colour)}>Test drive</button>
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
                  {vehicle.serviceQuote.dents > 0 && <span className="muted small">{vehicle.serviceQuote.dents} cosmetic dent{vehicle.serviceQuote.dents === 1 ? "" : "s"} · looks only, driving unaffected · fix at the mechanic</span>}
                  <span>
                    {km(vehicle.odometerMetres)} on the clock · {vehicle.serviceDue ? "service due" : `${km(Math.max(0, VEHICLE_RULES.serviceIntervalMetres - vehicle.metresSinceService))} to next service`}
                  </span>
                  {here && !nothingToDo && (
                    <em>
                      Quote: {naira(VEHICLE_RULES.routineServiceFee)} service
                      {vehicle.serviceQuote.repair > 0 ? ` + ${naira(vehicle.serviceQuote.repair)} repairs` : ""}
                      {vehicle.serviceQuote.dents > 0 ? ` + ${naira(vehicle.serviceQuote.dentRepair)} panel-beating (${vehicle.serviceQuote.dents} dent${vehicle.serviceQuote.dents === 1 ? "" : "s"}${vehicle.insured ? ", 70% paid by cover" : ""})` : ""}
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
                        return `${vehicle.plate} serviced and repaired for ${naira(result.charged ?? vehicle.serviceQuote.total)}. Condition 100%${vehicle.serviceQuote.dents ? ", dents gone" : ""}.`;
                      })}
                    >{nothingToDo ? "Running well" : `Service ${naira(vehicle.serviceQuote.total)}`}</button>
                  ) : vehicle.status === "garaged" ? (
                    <span className="muted small">In your garage</span>
                  ) : vehicle.status === "driving" ? (
                    <span className="muted small">Park it outside first</span>
                  ) : vehicle.status === "towing" ? (
                    <span className="muted small">With Ade Recovery</span>
                  ) : (
                    <span className="muted small">Drive it into the bay outside, or Phone → Vehicles → Tow &amp; repair</span>
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
  engine: GameEngine | null;
  tows: TowState[];
  vehicles: MyVehicle[];
  properties: PropertyListing[];
  position: Vec2 | null;
  drivingId: string | null;
  onNavigate: (target: { point: Vec2; label: string } | null) => void;
  onRefresh: () => Promise<void>;
  onToast: (notice: Notice) => void;
  onClose: () => void;
};

export function VehiclesApp({ engine, tows, vehicles, properties, position, drivingId, onNavigate, onRefresh, onToast, onClose }: AppProps) {
  const { busy, run } = useRunner(onToast, onRefresh);
  const [towing, setTowing] = useState<string | null>(null);
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
                {driving ? "You are driving it" : vehicle.status === "towing" ? "With Ade Recovery" : vehicle.status === "garaged" ? `In the garage at ${garage?.name ?? "your home"}` : distance !== null ? `Parked ${distance} m away` : "Parked"}
                {" · "}{km(vehicle.odometerMetres)}{vehicle.serviceDue ? " · service due" : ""}
                {model ? ` · top ${kmh(model.topSpeed)} km/h` : ""}
              </p>
              <p className="small">{vehicle.insured ? `Insured until ${new Date(vehicle.insuredUntil!).toLocaleDateString("en-NG", { day: "numeric", month: "short" })}: free tows, repairs capped at ${naira(VEHICLE_RULES.insuredExcess)}` : "Not insured"}</p>
              <div className="row wrap">
                {vehicle.status === "parked" && vehicle.x !== null && vehicle.z !== null && !driving && (
                  <button className="secondary" onClick={() => { onNavigate({ point: [vehicle.x!, vehicle.z!], label: `Your ${vehicle.modelName}` }); onClose(); }}>Find my car</button>
                )}
                {model && model.seats > 1 && (
                  <button className="secondary" aria-pressed={!vehicle.locked} disabled={busy} onClick={() => void run(async () => {
                    await api.lockVehicle(vehicle.id, !vehicle.locked);
                    return vehicle.locked ? `${vehicle.plate} unlocked: other players can ride as passengers. Only you can drive.` : `${vehicle.plate} locked: nobody else can get in.`;
                  })}>{vehicle.locked ? "🔒 Locked · let passengers in" : "🔓 Open to passengers · lock"}</button>
                )}
                {!vehicle.insured && (
                  <button className="secondary" disabled={busy} onClick={() => void run(async () => {
                    await api.insureVehicle(vehicle.id);
                    return `${vehicle.plate} insured for ${VEHICLE_RULES.insuranceDays} days.`;
                  })}>Insure 7 days · {naira(vehicle.premium)}</button>
                )}
                {model?.body !== "bicycle" && vehicle.status !== "garaged" && vehicle.status !== "towing" && !tows.some((tow) => tow.vehicleId === vehicle.id && tow.stage !== "delivered") && (
                  <button className="secondary" aria-expanded={towing === vehicle.id} onClick={() => setTowing(towing === vehicle.id ? null : vehicle.id)}>
                    🛻 Tow &amp; repair
                  </button>
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
              {tows.filter((tow) => tow.vehicleId === vehicle.id).map((tow) => (
                <TowProgress key={tow.id} tow={tow} onCancel={() => engine?.cancelTow(tow.id)} onNavigate={(point) => { onNavigate({ point, label: `Your ${vehicle.modelName}` }); onClose(); }} />
              ))}
              {towing === vehicle.id && (
                <TowRequest
                  vehicle={vehicle}
                  homes={homes}
                  disabled={!engine}
                  onCancel={() => setTowing(null)}
                  onConfirm={(destination) => {
                    engine?.requestTow(vehicle.id, destination);
                    setTowing(null);
                  }}
                />
              )}
            </li>
          );
        })}
      </ul>
      <p className="muted small">Collisions only count above walking pace; parking taps and kerb scrapes are free. Minor knocks never stop the car, a check-engine light comes on below {VEHICLE_RULES.warnCondition}%, and only a severe crash can disable it. Drive: W/S accelerate and brake, A/D steer, Space handbrake, E to step out, Q horn, L lights. On a phone, use the steering pad and pedals. Collisions reduce condition. Unlocked vehicles let other players ride along, but only you can drive.</p>
    </div>
  );
}

const TOW_STEPS: TowStage[] = ["requested", "arriving", "collected", "repairing", "returning", "delivered"];

function TowRequest({ vehicle, homes, disabled, onCancel, onConfirm }: {
  vehicle: MyVehicle;
  homes: PropertyListing[];
  disabled: boolean;
  onCancel: () => void;
  onConfirm: (destination: TowDestination) => void;
}) {
  const [choice, setChoice] = useState<string>(homes[0] ? `home:${homes[0].id}` : "here");
  const towFee = vehicle.insured ? 0 : VEHICLE_RULES.towFee;
  const { repair, fullRepair } = vehicle.serviceQuote;
  const total = towFee + repair;
  return (
    <div className="tow-request" data-testid="tow-request">
      <p className="small"><strong>Ade Recovery</strong> collects {vehicle.plate}, repairs it to 100% and brings the same car back about {10} seconds after collection.</p>
      <dl className="tow-quote">
        <dt>Repairs</dt><dd>{naira(fullRepair)}</dd>
        {vehicle.insured && fullRepair > repair && (<><dt>Your cover pays</dt><dd>−{naira(fullRepair - repair)}</dd></>)}
        <dt>Tow</dt><dd>{towFee ? naira(towFee) : "Free with cover"}</dd>
        <dt><strong>You pay now</strong></dt><dd><strong>{naira(total)}</strong></dd>
      </dl>
      <fieldset className="tow-destination">
        <legend>Where should we return your car?</legend>
        {homes.map((home) => (
          <label key={home.id}>
            <input type="radio" name={`tow-${vehicle.id}`} checked={choice === `home:${home.id}`} onChange={() => setChoice(`home:${home.id}`)} />
            Home · {home.name}
          </label>
        ))}
        <label>
          <input type="radio" name={`tow-${vehicle.id}`} checked={choice === "here"} onChange={() => setChoice("here")} />
          My current location <span className="muted small">(a safe roadside spot near you when it is ready)</span>
        </label>
      </fieldset>
      <div className="row wrap">
        <button className="primary" disabled={disabled} onClick={() => onConfirm(choice === "here" ? { kind: "here" } : { kind: "home", propertyId: choice.slice(5) })}>
          Send the truck · {naira(total)}
        </button>
        <button className="secondary" onClick={onCancel}>Not now</button>
      </div>
    </div>
  );
}

function TowProgress({ tow, onCancel, onNavigate }: { tow: TowState; onCancel: () => void; onNavigate: (point: Vec2) => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);
  const step = tow.stage === "loading" ? 1 : TOW_STEPS.indexOf(tow.stage);
  const left = tow.stageEndsAt ? Math.max(0, Math.ceil((tow.stageEndsAt - now) / 1000)) : null;
  const cancellable = tow.stage === "requested" || tow.stage === "arriving";
  return (
    <div className="tow-progress" data-testid={`tow-${tow.stage}`}>
      <ol>
        {TOW_STEPS.map((stage, index) => (
          <li key={stage} className={index < step ? "done" : index === step ? "now" : ""}>{TOW_STAGE_LABEL[stage]}</li>
        ))}
      </ol>
      <p className="small">
        {tow.stage === "loading" ? "Winching your car onto the truck…" : TOW_STAGE_LABEL[tow.stage]}
        {left !== null && tow.stage !== "delivered" ? ` · ${tow.stage === "arriving" ? "about " : ""}${left}s` : ""}
        {` · to ${tow.destinationLabel}`}
      </p>
      {tow.message && <p className="small muted">{tow.message}</p>}
      <div className="row wrap">
        {tow.point && (tow.stage === "delivered" || tow.stage === "arriving" || tow.stage === "loading") && (
          <button className="secondary" onClick={() => onNavigate(tow.point!)}>{tow.stage === "delivered" ? "Show me where it is" : "Show the pickup"}</button>
        )}
        {cancellable && <button className="secondary" onClick={onCancel}>Cancel (full refund)</button>}
      </div>
    </div>
  );
}
