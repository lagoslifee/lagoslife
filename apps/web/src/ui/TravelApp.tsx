import { ACTIVITIES, CABINS, CONSULATE_NAME, HOTELS, TRAVEL, TRAVEL_PLACES, seatLabel, type Notice, type Vec2 } from "@lagos-living/shared";
import { useState } from "react";
import { api, naira, type EconomyState } from "../api";
import type { GameEngine } from "../game/engine";
import { HotelStay, LEG_LABEL, freeCancelLeft, loadLocalPhotos, modelName, navigateTo, spotName, ticketRefund, useTravelStatus } from "./TravelSheets";

const DESTINATIONS: Array<{ id: string; label: string; region: string }> = [
  { id: TRAVEL_PLACES.consulate, label: `${CONSULATE_NAME} (visas)`, region: "Lagos" },
  { id: TRAVEL_PLACES.lagosAirport, label: "Lagos air terminal (flights to Dubai)", region: "Lagos" },
  { id: TRAVEL_PLACES.dubaiAirport, label: "Dubai arrivals & departures", region: "Dubai" },
  ...HOTELS.map((hotel) => ({ id: hotel.id, label: `${hotel.name} · ${hotel.tier} hotel`, region: "Dubai" })),
  { id: TRAVEL_PLACES.pier, label: "Marina dhow pier · tours desk", region: "Dubai" },
  { id: TRAVEL_PLACES.rooftop, label: "Skyline rooftop lounge", region: "Dubai" },
  { id: "jbr-beach", label: "JBR beach", region: "Dubai" },
  { id: "marina-photo-point", label: "Marina photo point", region: "Dubai" },
  { id: "walk-grill", label: "Marina Walk grill", region: "Dubai" },
  { id: "marina-dhow-cafe", label: "Dhow café", region: "Dubai" },
  { id: TRAVEL_PLACES.boutique, label: "Marina boutique (outfits)", region: "Dubai" },
  { id: TRAVEL_PLACES.souvenirs, label: "Souvenir shop", region: "Dubai" },
  { id: TRAVEL_PLACES.carRental, label: "Car hire desk", region: "Dubai" },
];

export function TravelApp({ engine, economy, onNavigate, onRefresh, onToast, onClose }: {
  engine: GameEngine | null;
  economy: EconomyState | null;
  onNavigate: (target: { point: Vec2; label: string }) => void;
  onRefresh: () => Promise<void>;
  onToast: (notice: Notice) => void;
  onClose: () => void;
}) {
  const [status, reload] = useTravelStatus();
  const [busy, setBusy] = useState(false);
  const [friend, setFriend] = useState("");
  const [photos] = useState(loadLocalPhotos);
  const balance = economy?.balance ?? 0;
  const run = async (work: () => Promise<string | null>) => {
    if (busy) return;
    setBusy(true);
    try {
      const text = await work();
      if (text) onToast({ tone: "success", text });
      await reload();
      await onRefresh();
    } catch (error) {
      onToast({ tone: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const go = (placeId: string) => {
    navigateTo(placeId, onNavigate);
    onClose();
  };
  if (!status) return <div className="app-section"><p className="muted">Loading your trips…</p></div>;
  const { visa, ticket } = status;
  const refund = ticket ? ticketRefund(ticket) : null;
  const incoming = status.invites.filter((invite) => invite.incoming && invite.status === "pending");
  const sent = status.invites.filter((invite) => !invite.incoming);
  const stays = status.bookings.filter((booking) => booking.status === "booked" || booking.status === "checked_in");
  const pastStays = status.bookings.filter((booking) => booking.status !== "booked" && booking.status !== "checked_in");

  return (
    <div className="app-section travel-app" data-testid="travel-app">
      <p className="muted small">Lagos ⇄ Dubai holidays. Everything is game naira; the airline, consulate and hotels are fictional. Start at the {CONSULATE_NAME} for a visa, then the Lagos air terminal.</p>

      {incoming.map((invite) => (
        <div key={invite.id} className="travel-card warn" data-testid="trip-invite">
          <strong>{invite.fromName} invited you to Dubai</strong>
          <span>{CABINS[invite.cabin].name} return · you'd pay {naira(invite.fare)} only if you accept. You'll still need your own visa to fly.</span>
          <div className="row">
            <button className="primary small-button" disabled={busy || balance < invite.fare} onClick={() => void run(async () => { await api.answerTripInvite(invite.id, true); return `Trip accepted · ${naira(invite.fare)} paid. You'll be seated with ${invite.fromName}.`; })}>
              {balance < invite.fare ? `Need ${naira(invite.fare)}` : `Accept · ${naira(invite.fare)}`}
            </button>
            <button className="secondary small-button" disabled={busy} onClick={() => void run(async () => { await api.answerTripInvite(invite.id, false); return "Invitation declined. Nothing was charged."; })}>Decline</button>
          </div>
        </div>
      ))}

      <h3>Visa</h3>
      {visa ? (
        <div className={`travel-card ${visa.status === "issued" ? "ok" : ""}`} data-testid="phone-visa">
          <strong>{visa.name}</strong>
          <span>{visa.reference} · {visa.status === "processing" ? "Processing — ready in a few seconds" : visa.status === "issued" ? `Issued · ${visa.visitsTotal - visa.visitsUsed} of ${visa.visitsTotal} visits left · valid until ${new Date(visa.validUntil).toLocaleDateString("en-NG", { day: "numeric", month: "short" })}` : "Expired"}</span>
        </div>
      ) : (
        <div className="travel-card warn">
          <strong>No visa yet</strong>
          <span>Apply at the counter inside the consular office. It's fixed-fee, takes about {TRAVEL.visaProcessingSeconds} seconds and is never randomly refused.</span>
          <button className="link" onClick={() => go(TRAVEL_PLACES.consulate)}>Navigate to the consular office</button>
        </div>
      )}

      <h3>Flights</h3>
      {ticket ? (
        <div className="travel-card" data-testid="phone-ticket">
          <strong>{CABINS[ticket.cabin].name} return · {ticket.reference}</strong>
          <span>{seatLabel(ticket.seat)} · paid {naira(ticket.fare)}</span>
          <span>LL 721 Lagos → Dubai: {LEG_LABEL[ticket.outbound]} · LL 722 Dubai → Lagos: {LEG_LABEL[ticket.return]}</span>
          {ticket.companions.length > 0 && <span>Travelling with {ticket.companions.join(", ")}</span>}
          {refund !== null ? (
            <>
              <span className="muted small">{freeCancelLeft(ticket) > 0 ? `Free cancellation for ${freeCancelLeft(ticket)} more min (full ${naira(refund)} back).` : `Cancelling now refunds ${naira(refund)}; ${Math.round(TRAVEL.cancelFeeRate * 100)}% is kept. No cancellations after boarding.`}</span>
              <button className="secondary small-button" disabled={busy} onClick={() => void run(async () => { const result = await api.cancelTicket(ticket.id); return `Ticket cancelled · ${naira(result.refund)} refunded.`; })}>Cancel ticket</button>
            </>
          ) : (
            <span className="muted small">Already flown out — your return flight home is included.</span>
          )}
          {ticket.outbound !== "flown" && ticket.outbound !== "cancelled" && (
            <form className="row" onSubmit={(event) => {
              event.preventDefault();
              const name = friend.trim();
              if (!name) return;
              void run(async () => { const result = await api.inviteToTrip(ticket.id, name); setFriend(""); return `Invitation sent to ${result.friendName}. They pay ${naira(ticket.fare)} only if they accept.`; });
            }}>
              <input value={friend} onChange={(event) => setFriend(event.target.value)} placeholder="Friend's resident name" aria-label="Invite a friend" />
              <button className="secondary small-button" disabled={busy || !friend.trim()}>Invite</button>
            </form>
          )}
          {sent.length > 0 && <span className="small">Invites: {sent.map((invite) => `${invite.toName} (${invite.status})`).join(", ")}</span>}
        </div>
      ) : (
        <div className="travel-card">
          <strong>No ticket</strong>
          <span>Buy a return at the ticket desk inside the Lagos air terminal: Economy {naira(CABINS.economy.fare)} or Business {naira(CABINS.business.fare)}.</span>
          <button className="link" onClick={() => go(TRAVEL_PLACES.lagosAirport)}>Navigate to the airport</button>
        </div>
      )}

      <h3>Hotels</h3>
      {stays.length === 0 && <p className="muted small">No current stay. Book at a hotel's reception in Dubai.</p>}
      {stays.map((booking) => (
        <HotelStay key={booking.id} booking={booking} busy={busy} run={run} balance={balance} />
      ))}

      {status.rental && (
        <>
          <h3>Car hire</h3>
          <div className="travel-card">
            <strong>{modelName(status.rental.modelId)}</strong>
            <span>Until {new Date(status.rental.until).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })}</span>
            <button className="secondary small-button" onClick={() => { engine?.returnCar(); void reload(); }}>Return now</button>
          </div>
        </>
      )}

      <h3>Photos</h3>
      {status.photos.length === 0 && <p className="muted small">No travel photos yet. Look for 📸 spots in Dubai.</p>}
      <div className="photo-grid">
        {status.photos.slice(0, 12).map((photo) => {
          const local = photos.find((entry) => entry.spot === photo.spot && Math.abs(entry.at - Date.parse(photo.takenAt)) < 15_000);
          return (
            <figure key={photo.id}>
              {local ? <img src={local.image} alt={spotName(photo.spot)} /> : <div className="photo-placeholder">📸</div>}
              <figcaption>{spotName(photo.spot)}{photo.companions.length ? ` · with ${photo.companions.join(", ")}` : ""}</figcaption>
            </figure>
          );
        })}
      </div>

      <h3>History</h3>
      <ul className="venue-list">
        {status.tickets.map((entry) => (
          <li key={entry.id}>
            <div>
              <strong>{CABINS[entry.cabin].name} return {entry.reference}</strong>
              <span>{new Date(entry.createdAt).toLocaleDateString("en-NG")} · {entry.cancelledAt ? `cancelled, ${naira(entry.refunded)} refunded` : `out ${LEG_LABEL[entry.outbound]} · back ${LEG_LABEL[entry.return]}`}</span>
            </div>
          </li>
        ))}
        {pastStays.map((booking) => (
          <li key={booking.id}>
            <div>
              <strong>{booking.hotelName} · {booking.roomName}</strong>
              <span>{booking.nights} night{booking.nights === 1 ? "" : "s"} · {booking.status.replace("_", " ")}</span>
            </div>
          </li>
        ))}
        {status.activities.map((entry) => (
          <li key={entry.at + entry.activity}>
            <div>
              <strong>{ACTIVITIES[entry.activity as keyof typeof ACTIVITIES]?.name ?? entry.activity}</strong>
              <span>{new Date(entry.at).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
            </div>
          </li>
        ))}
        {status.tickets.length + pastStays.length + status.activities.length === 0 && <li className="muted small">Nothing yet.</li>}
      </ul>

      <h3>Places</h3>
      <ul className="venue-list">
        {DESTINATIONS.map((entry) => (
          <li key={entry.id}>
            <div><strong>{entry.label}</strong><span>{entry.region}</span></div>
            <button className="link" onClick={() => go(entry.id)}>Navigate</button>
          </li>
        ))}
      </ul>
      <p className="muted small">Dubai is reached by flight only. Within each city, taxis and express rides work as usual.</p>
    </div>
  );
}
