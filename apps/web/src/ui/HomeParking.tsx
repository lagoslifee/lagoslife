import { VEHICLE_RULES, vehicleModelById, type Notice } from "@lagos-living/shared";
import { useCallback, useEffect, useState } from "react";
import { api, type MyVehicle } from "../api";

type Props = {
  propertyId: string;
  homeName: string;
  door: [number, number] | null;
  owner: boolean;
  onToast: (notice: Notice) => void;
  onRefresh: () => Promise<void>;
};

const BAY_W = 3.0;
const BAY_L = 5.8;
const GAP = 1.2;
const MIN_DRIVEWAY_BAYS = 4;

/** Top-down plan of the home's garage and driveway with every car you own parked in its own bay. */
export function HomeParking({ propertyId, homeName, door, owner, onToast, onRefresh }: Props) {
  const [vehicles, setVehicles] = useState<MyVehicle[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      setVehicles(await api.vehicles());
    } catch (error) {
      onToast({ tone: "error", text: (error as Error).message });
    }
  }, [onToast]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = async (success: string, work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
      onToast({ tone: "success", text: success });
      await Promise.all([reload(), onRefresh()]);
    } catch (error) {
      onToast({ tone: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const distance = (vehicle: MyVehicle) =>
    door && vehicle.x !== null && vehicle.z !== null ? Math.hypot(vehicle.x - door[0], vehicle.z - door[1]) : Infinity;
  const all = vehicles ?? [];
  const garaged = all.filter((vehicle) => vehicle.status === "garaged" && vehicle.garagePropertyId === propertyId);
  const driveway = all
    .filter((vehicle) => vehicle.status === "parked" && distance(vehicle) <= VEHICLE_RULES.garageRange)
    .sort((a, b) => distance(a) - distance(b));
  const here = new Set([...garaged, ...driveway].map((vehicle) => vehicle.id));
  const elsewhere = all.filter((vehicle) => !here.has(vehicle.id));
  const capacity = VEHICLE_RULES.garageCapacity;
  const drivewayBays = Math.max(MIN_DRIVEWAY_BAYS, driveway.length);

  const garageW = capacity * BAY_W;
  const drivewayW = drivewayBays * BAY_W;
  const width = garageW + GAP + drivewayW;
  const height = BAY_L + 2.4;
  const selectedVehicle = all.find((vehicle) => vehicle.id === selected) ?? null;

  const bay = (vehicle: MyVehicle | undefined, x: number, key: string, inGarage: boolean) => (
    <g key={key} className={`parking-bay ${vehicle && vehicle.id === selected ? "selected" : ""}`} onClick={() => vehicle && setSelected(vehicle.id === selected ? null : vehicle.id)}>
      <rect x={x + 0.08} y={0.3} width={BAY_W - 0.16} height={BAY_L} className={inGarage ? "bay-garage" : "bay-driveway"} />
      {!vehicle && <text x={x + BAY_W / 2} y={0.3 + BAY_L / 2} className="bay-empty">{inGarage ? "Free" : "P"}</text>}
      {vehicle && <CarGlyph vehicle={vehicle} cx={x + BAY_W / 2} cy={0.3 + BAY_L / 2} />}
    </g>
  );

  return (
    <div className="designer-body" data-testid="home-parking">
      {vehicles === null ? (
        <p className="muted small">Checking your garage…</p>
      ) : (
        <>
          <svg className="parking-plan" viewBox={`-0.4 -0.4 ${width + 0.8} ${height + 0.6}`} role="img" aria-label={`Garage and driveway at ${homeName}`}>
            <rect x={-0.15} y={0.1} width={garageW + 0.3} height={BAY_L + 0.4} className="garage-walls" />
            <text x={garageW / 2} y={BAY_L + 1.5} className="parking-caption">Garage · {garaged.length}/{capacity}</text>
            <rect x={garageW + GAP - 0.1} y={0.1} width={drivewayW + 0.2} height={BAY_L + 0.4} className="driveway-slab" />
            <text x={garageW + GAP + drivewayW / 2} y={BAY_L + 1.5} className="parking-caption">Driveway & kerb</text>
            {Array.from({ length: capacity }, (_, index) => bay(garaged[index], index * BAY_W, `g${index}`, true))}
            {Array.from({ length: drivewayBays }, (_, index) => bay(driveway[index], garageW + GAP + index * BAY_W, `d${index}`, false))}
          </svg>

          {selectedVehicle ? (
            <div className="designer-toolbar">
              <strong><i className="paint-dot" style={{ background: selectedVehicle.colour }} /> {selectedVehicle.modelName} · {selectedVehicle.plate}</strong>
              {selectedVehicle.status === "garaged" ? (
                <button className="primary" disabled={busy || !owner} onClick={() => void run(`${selectedVehicle.plate} is parked outside ${homeName}.`, () => api.retrieveVehicle(selectedVehicle.id))}>
                  Take it out
                </button>
              ) : (
                <button className="secondary" disabled={busy || !owner || garaged.length >= capacity} onClick={() => void run(`${selectedVehicle.plate} is in the garage at ${homeName}.`, () => api.garageVehicle(selectedVehicle.id, propertyId))}>
                  {garaged.length >= capacity ? "Garage full" : "Put in garage"}
                </button>
              )}
            </div>
          ) : (
            <p className="muted small">
              {all.length === 0
                ? "You don't own a car yet. Lekki Motors has new and tokunbo cars."
                : `Tap a car to move it between the garage and the driveway. Cars parked within ${VEHICLE_RULES.garageRange} m of the door count as here.`}
            </p>
          )}

          {elsewhere.length > 0 && (
            <ul className="parking-elsewhere">
              <li className="muted small">Elsewhere in the city</li>
              {elsewhere.map((vehicle) => (
                <li key={vehicle.id}>
                  <i className="paint-dot" style={{ background: vehicle.colour }} />
                  <span>{vehicle.modelName} · {vehicle.plate}</span>
                  <em>{whereIs(vehicle, distance(vehicle))}</em>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function whereIs(vehicle: MyVehicle, metres: number) {
  if (vehicle.status === "driving") return "Being driven";
  if (vehicle.status === "towing") return "With Ade Recovery";
  if (vehicle.status === "garaged") return "In another garage";
  return Number.isFinite(metres) ? `Parked ${metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres)} m`} away` : "Parked";
}

/** A car seen from above, nose up, sized from its model. */
function CarGlyph({ vehicle, cx, cy }: { vehicle: MyVehicle; cx: number; cy: number }) {
  const model = vehicleModelById.get(vehicle.modelId);
  const bicycle = model?.body === "bicycle";
  const length = Math.min(BAY_L - 0.4, model?.length ?? 4.4);
  const width = Math.min(BAY_W - 0.5, model?.width ?? 1.8);
  const top = cy - length / 2;
  if (bicycle) {
    return (
      <g className="car-glyph" data-testid={`parked-${vehicle.plate}`}>
        <rect x={cx - 0.12} y={top} width={0.24} height={length} rx={0.12} style={{ fill: vehicle.colour }} />
        <text x={cx} y={cy + length / 2 + 0.35} className="car-plate">{vehicle.plate}</text>
      </g>
    );
  }
  return (
    <g className="car-glyph" data-testid={`parked-${vehicle.plate}`}>
      <rect x={cx - width / 2} y={top} width={width} height={length} rx={0.45} style={{ fill: vehicle.colour }} className="car-body" />
      <rect x={cx - width / 2 + 0.18} y={top + length * 0.24} width={width - 0.36} height={length * 0.16} rx={0.12} className="car-glass" />
      <rect x={cx - width / 2 + 0.22} y={top + length * 0.42} width={width - 0.44} height={length * 0.3} rx={0.1} className="car-roof" style={{ fill: vehicle.colour }} />
      <rect x={cx - width / 2 + 0.2} y={top + length * 0.74} width={width - 0.4} height={length * 0.1} rx={0.1} className="car-glass" />
      <text x={cx} y={cy + length / 2 + 0.35} className="car-plate">{vehicle.plate}</text>
    </g>
  );
}
