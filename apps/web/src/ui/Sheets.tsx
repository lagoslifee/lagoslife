import type { Notice, Place } from "@lagos-living/shared";
import { useState } from "react";
import { api, naira, type EconomyState, type PropertyListing } from "../api";

type Props = {
  place: Place;
  economy: EconomyState | null;
  properties: PropertyListing[];
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onToast: (notice: Notice) => void;
  onEnter: (propertyId: string, mode: "enter" | "preview") => void;
  onJobStarted: () => void;
};

export function PlaceSheet({ place, economy, properties, onClose, onRefresh, onToast, onEnter, onJobStarted }: Props) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<null | "rent" | "buy">(null);
  const run = async (work: () => Promise<string>) => {
    setBusy(true);
    try {
      const message = await work();
      onToast({ tone: "success", text: message });
      await onRefresh();
    } catch (error) {
      onToast({ tone: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const vendorItems = economy?.catalog.filter((item) => item.vendorId === place.id) ?? [];
  const listing = properties.find((candidate) => candidate.id === place.id);
  const balance = economy?.balance ?? 0;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section className="sheet" role="dialog" aria-label={place.name} onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <p className="eyebrow">{place.street.toUpperCase()}</p>
            <h2>{place.name}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">✕</button>
        </header>

        {(place.kind === "food" || place.kind === "shop" || place.kind === "furniture") && (
          <>
            <p className="muted">{place.kind === "food" ? "Hot food, packed to go. Eat it now or carry it." : place.kind === "furniture" ? "Furniture for your rented or owned home." : "Everyday provisions."}</p>
            <ul className="menu">
              {vendorItems.map((item) => {
                const owned = economy?.inventory.find((entry) => entry.itemId === item.id)?.quantity ?? 0;
                return (
                  <li key={item.id}>
                    <div>
                      <strong>{item.name}</strong>
                      <span>{item.description}</span>
                      {owned > 0 && <em>In bag: {owned}</em>}
                    </div>
                    <div className="menu-actions">
                      <button
                        className="primary"
                        disabled={busy || balance < item.price}
                        onClick={() => void run(async () => {
                          const result = await api.purchase(item.id);
                          return `Bought ${item.name} for ${naira(item.price)}. Balance ${naira(result.balance)}.`;
                        })}
                      >
                        {balance < item.price ? `Need ${naira(item.price)}` : `Buy ${naira(item.price)}`}
                      </button>
                      {item.category === "food" && owned > 0 && (
                        <button className="secondary" disabled={busy} onClick={() => void run(async () => {
                          const result = await api.eat(item.id);
                          return `You ate ${result.name}. Hunger ${result.needs.hunger}/100.`;
                        })}>Eat</button>
                      )}
                    </div>
                  </li>
                );
              })}
              {!vendorItems.length && <li className="muted">Nothing on sale right now.</li>}
            </ul>
          </>
        )}

        {place.kind === "job" && (
          <div className="job-sheet">
            {economy?.activeJob ? (
              <>
                <p>You are carrying a parcel for <strong>{economy.activeJob.destinationLabel}</strong>.</p>
                <p>Reward on delivery: <strong>{naira(economy.activeJob.reward)}</strong></p>
                <button className="secondary" disabled={busy} onClick={() => void run(async () => {
                  await api.cancelDelivery();
                  return "Job cancelled. The parcel stays at the hub.";
                })}>Cancel this job</button>
              </>
            ) : (
              <>
                <p>Collect a parcel and walk, jog or ride it to a customer in Lekki Phase 1. Pay depends on distance and is credited once on delivery.</p>
                <button className="primary" disabled={busy} onClick={() => void run(async () => {
                  const job = await api.startDelivery();
                  onJobStarted();
                  onClose();
                  return `Parcel collected for ${job.destinationLabel}. Pays ${naira(job.reward)}. Follow the blue route.`;
                })}>Collect a parcel</button>
              </>
            )}
          </div>
        )}

        {(place.kind === "rental" || place.kind === "sale") && listing && (
          <div className="listing">
            <p className="muted">{listing.description}</p>
            <dl className="terms">
              {place.kind === "rental" ? (
                <>
                  <dt>Rent</dt><dd>{naira(listing.rent)} every {listing.intervalDays} days</dd>
                  <dt>Refundable deposit</dt><dd>{naira(listing.deposit)}</dd>
                  <dt>Total upfront</dt><dd><strong>{naira(listing.upfrontRent)}</strong></dd>
                  <dt>Late payment</dt><dd>{listing.graceDays}-day grace period, then the tenancy ends</dd>
                </>
              ) : (
                <>
                  <dt>Price</dt><dd><strong>{naira(listing.purchasePrice)}</strong> · own it outright, no rent</dd>
                </>
              )}
              <dt>Storage</dt><dd>{listing.storageSlots} item slots</dd>
              <dt>Status</dt><dd>{listing.isMine ? (listing.tenureType === "owned" ? "You own this" : "You rent this") : listing.available ? "Available" : "Taken by another resident"}</dd>
            </dl>
            <p className="muted small">Your balance: {naira(balance)}</p>
            <div className="row wrap">
              {listing.isMine ? (
                <>
                  <button className="primary" onClick={() => { onEnter(place.id, "enter"); onClose(); }}>Enter home</button>
                  {!listing.isHome && <button className="secondary" disabled={busy} onClick={() => void run(async () => { await api.setHome(place.id); return `${place.name} set as your home.`; })}>Set as home</button>}
                </>
              ) : listing.available ? (
                <>
                  <button className="secondary" onClick={() => { onEnter(place.id, "preview"); onClose(); }}>Preview interior</button>
                  {confirming ? (
                    <>
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() => void run(async () => {
                          const result = await api.acquire(place.id, place.kind === "rental" ? "rented" : "owned");
                          setConfirming(null);
                          return place.kind === "rental"
                            ? `Tenancy signed. ${naira(listing.upfrontRent)} paid. Digital key added to My Home. Balance ${naira(result.balance)}.`
                            : `${place.name} is yours. Balance ${naira(result.balance)}.`;
                        })}
                      >Confirm {naira(place.kind === "rental" ? listing.upfrontRent : listing.purchasePrice)}</button>
                      <button className="secondary" onClick={() => setConfirming(null)}>Not yet</button>
                    </>
                  ) : (
                    <button
                      className="primary"
                      disabled={balance < (place.kind === "rental" ? listing.upfrontRent : listing.purchasePrice)}
                      onClick={() => setConfirming(place.kind === "rental" ? "rent" : "buy")}
                    >
                      {balance < (place.kind === "rental" ? listing.upfrontRent : listing.purchasePrice)
                        ? `Need ${naira(place.kind === "rental" ? listing.upfrontRent : listing.purchasePrice)}`
                        : place.kind === "rental" ? "Rent this flat" : "Buy this house"}
                    </button>
                  )}
                </>
              ) : (
                <p className="warning">Another resident lives here.</p>
              )}
            </div>
          </div>
        )}
        {(place.kind === "rental" || place.kind === "sale") && !listing && <p className="muted">Loading listing…</p>}
      </section>
    </div>
  );
}
