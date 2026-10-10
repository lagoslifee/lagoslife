import { useCallback, useEffect, useState } from "react";
import { apiUrl } from "./auth-client";

type Property = {
  id: string;
  name: string;
  district: string;
  addressLabel: string;
  purchasePrice: number;
  monthlyRent: number;
  worldX: number;
  worldZ: number;
  tenureType: "owned" | "rented" | null;
  isMine: boolean;
  available: boolean;
  hasGuestAccess: boolean;
};

type Interior = {
  id: string;
  name: string;
  addressLabel: string;
  access: { owner: boolean; guest: boolean };
  furniture: Array<{
    id: string;
    itemId: string;
    name: string;
    gridX: number;
    gridZ: number;
    rotation: number;
  }>;
  home: { hunger: number; energy: number; cleanliness: number };
  guests: string[];
  availableFurniture: Array<{ itemId: string; name: string; available: number }>;
};

const money = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 0,
});

export function PropertyPanel() {
  const [open, setOpen] = useState(false);
  const [properties, setProperties] = useState<Property[]>([]);
  const [interior, setInterior] = useState<Interior | null>(null);
  const [selectedFurniture, setSelectedFurniture] = useState("");
  const [guestName, setGuestName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const loadProperties = useCallback(async () => {
    const response = await fetch(`${apiUrl}/api/properties`, { credentials: "include" });
    if (response.ok) setProperties((await response.json()) as Property[]);
  }, []);

  useEffect(() => {
    void loadProperties();
  }, [loadProperties]);

  async function request(path: string, body?: object) {
    setBusy(true);
    setMessage("");
    const options: RequestInit = { method: "POST", credentials: "include" };
    if (body) {
      options.headers = { "content-type": "application/json" };
      options.body = JSON.stringify(body);
    }
    const response = await fetch(`${apiUrl}${path}`, options);
    const result = (await response.json()) as { error?: string };
    setBusy(false);
    if (!response.ok) {
      setMessage(result.error ?? "Action failed");
      return null;
    }
    return result;
  }

  async function enterHome(propertyId: string) {
    const response = await fetch(`${apiUrl}/api/properties/${propertyId}/interior`, {
      credentials: "include",
    });
    const result = (await response.json()) as Interior & { error?: string };
    if (!response.ok) {
      setMessage(result.error ?? "Home could not be entered");
      return;
    }
    setInterior(result);
    setSelectedFurniture(result.availableFurniture[0]?.itemId ?? "");
  }

  async function acquire(property: Property, tenure: "owned" | "rented") {
    const result = await request("/api/properties/acquire", {
      propertyId: property.id,
      tenure,
      idempotencyKey: crypto.randomUUID(),
    });
    if (!result) return;
    window.dispatchEvent(new Event("lagos-economy-refresh"));
    await loadProperties();
    await enterHome(property.id);
  }

  async function place(gridX: number, gridZ: number) {
    if (!interior || !selectedFurniture || !interior.access.owner) return;
    const result = await request(`/api/properties/${interior.id}/furniture`, {
      itemId: selectedFurniture,
      gridX,
      gridZ,
      rotation: 0,
      idempotencyKey: crypto.randomUUID(),
    });
    if (result) await enterHome(interior.id);
  }

  async function homeAction(action: "sleep" | "cook" | "clean") {
    if (!interior) return;
    const result = await request(`/api/properties/${interior.id}/action`, { action });
    if (result) await enterHome(interior.id);
  }

  async function invite() {
    if (!interior || !guestName) return;
    const result = await request(`/api/properties/${interior.id}/guests`, {
      username: guestName,
    });
    if (result) {
      setGuestName("");
      await enterHome(interior.id);
    }
  }

  return (
    <>
      <button className="homes-pill" onClick={() => setOpen(true)}>
        <span>HOMES</span>
        <strong>{properties.some(({ isMine }) => isMine) ? "My home" : "View listing"}</strong>
      </button>
      {open && (
        <div className="property-backdrop">
          <section className="property-panel" role="dialog" aria-modal="true" aria-label="Homes">
            <header>
              <div>
                <p className="step-label">{interior ? "HOME INTERIOR" : "IKOYI HOMES"}</p>
                <h2>{interior?.name ?? "Find your place"}</h2>
              </div>
              <button
                aria-label="Close homes"
                onClick={() => {
                  if (interior) setInterior(null);
                  else setOpen(false);
                }}
              >
                {interior ? "←" : "×"}
              </button>
            </header>
            {message && <p className="economy-message" role="status">{message}</p>}

            {!interior ? (
              <div className="property-list">
                {properties.map((property) => (
                  <article key={property.id}>
                    <div className="property-art"><span>IKOYI</span></div>
                    <div>
                      <h3>{property.name}</h3>
                      <p>{property.addressLabel}</p>
                      <small>
                        Map marker {property.worldX.toFixed(0)}, {property.worldZ.toFixed(0)}
                      </small>
                    </div>
                    <div className="property-actions">
                      {property.isMine || property.hasGuestAccess ? (
                        <button className="primary" onClick={() => enterHome(property.id)}>
                          Enter home
                        </button>
                      ) : property.available ? (
                        <>
                          <button
                            className="primary"
                            disabled={busy}
                            onClick={() => acquire(property, "owned")}
                          >
                            Buy · {money.format(property.purchasePrice)}
                          </button>
                          <button
                            className="secondary"
                            disabled={busy}
                            onClick={() => acquire(property, "rented")}
                          >
                            Rent 30 days · {money.format(property.monthlyRent)}
                          </button>
                        </>
                      ) : <strong className="taken-label">Occupied</strong>}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <>
                <div className="needs-row">
                  {Object.entries(interior.home).map(([label, value]) => (
                    <div key={label}>
                      <span>{label}</span>
                      <progress value={value} max={100} />
                      <strong>{value}</strong>
                    </div>
                  ))}
                </div>
                <div className="home-actions">
                  <button onClick={() => homeAction("sleep")} disabled={busy}>Sleep</button>
                  <button onClick={() => homeAction("cook")} disabled={busy}>Cook</button>
                  <button onClick={() => homeAction("clean")} disabled={busy}>Clean</button>
                </div>
                <div className="interior-room" aria-label="Furniture placement grid">
                  {Array.from({ length: 48 }, (_, index) => {
                    const gridX = index % 8;
                    const gridZ = Math.floor(index / 8);
                    return (
                      <button
                        key={index}
                        aria-label={`Floor ${gridX}, ${gridZ}`}
                        onClick={() => place(gridX, gridZ)}
                      />
                    );
                  })}
                  {interior.furniture.map((item) => (
                    <div
                      className={`placed-furniture furniture-${item.itemId}`}
                      style={{
                        gridColumn: item.gridX + 1,
                        gridRow: item.gridZ + 1,
                        rotate: `${item.rotation}deg`,
                      }}
                      title={item.name}
                      key={item.id}
                    >
                      {item.name}
                    </div>
                  ))}
                </div>
                {interior.access.owner && (
                  <div className="interior-tools">
                    <label>
                      Place owned furniture
                      <select
                        value={selectedFurniture}
                        onChange={(event) => setSelectedFurniture(event.target.value)}
                      >
                        <option value="">Buy furniture from the shop first</option>
                        {interior.availableFurniture.map((item) => (
                          <option value={item.itemId} key={item.itemId}>
                            {item.name} ×{item.available}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div>
                      <label>
                        Invite resident by player name
                        <input
                          value={guestName}
                          onChange={(event) => setGuestName(event.target.value)}
                          placeholder="Player name"
                        />
                      </label>
                      <button className="secondary" onClick={invite} disabled={busy || !guestName}>
                        Invite
                      </button>
                    </div>
                    {interior.guests.length > 0 && (
                      <p className="guest-list">Guests: {interior.guests.join(", ")}</p>
                    )}
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
