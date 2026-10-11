import {
  ACTIVITIES,
  CABINS,
  CAR_RENTAL,
  CONSULATE_NAME,
  CONSULATE_NOTICE,
  ROOFTOP_MENU,
  ROOM_SERVICE,
  RENTAL_CARS,
  TRAVEL,
  TRAVEL_PLACES,
  VEHICLE_MODELS,
  VISA_PLANS,
  cabinClasses,
  flightPhase,
  hotelById,
  placeById,
  seatLabel,
  visaPlans,
  type ActivityId,
  type CabinClass,
  type HotelBookingState,
  type Notice,
  type Place,
  type RoomType,
  type TicketState,
  type TravelInterior,
  type TravelStatus,
  type TripState,
  type Vec2,
} from "@lagos-living/shared";
import { useCallback, useEffect, useState } from "react";
import { api, naira, type EconomyState } from "../api";
import type { GameEngine } from "../game/engine";

/** Street places that open a travel sheet instead of the generic shop or listing sheet. */
export const TRAVEL_SHEET_KINDS = new Set<string>(["airport", "consulate", "hotel", "lounge", "marina", "desert", "photo", "beach", "car_rental"]);

export const LOCAL_PHOTOS_KEY = "lagos-travel-photos";
export type LocalPhoto = { at: number; spot: string; companions: string[]; image: string };
export function loadLocalPhotos(): LocalPhoto[] {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_PHOTOS_KEY) ?? "[]") as LocalPhoto[];
  } catch {
    return [];
  }
}

export const modelName = (modelId: string) => VEHICLE_MODELS.find((model) => model.id === modelId)?.name ?? modelId;
export const spotName = (spot: string) => (spot === "rooftop" ? "Skyline rooftop" : spot === "hotel" ? "Hotel room view" : placeById.get(spot)?.name ?? spot);

export function useTravelStatus() {
  const [status, setStatus] = useState<TravelStatus | null>(null);
  const reload = useCallback(async () => {
    try {
      const next = await api.travel();
      setStatus(next);
      return next;
    } catch {
      return null;
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  const processing = status?.visa?.status === "processing";
  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(() => void reload(), 2_000);
    return () => clearInterval(timer);
  }, [processing, reload]);
  return [status, reload] as const;
}

/** Refund the player would get for cancelling now, mirroring the server rule; null when it can't be cancelled. */
export function ticketRefund(ticket: TicketState, now = Date.now()) {
  if (ticket.cancelledAt || (ticket.outbound !== "booked" && ticket.outbound !== "checked_in")) return null;
  const free = now - new Date(ticket.createdAt).getTime() <= TRAVEL.freeCancelMinutes * 60_000;
  return free ? ticket.fare : Math.round((ticket.fare * (1 - TRAVEL.cancelFeeRate)) / 50) * 50;
}

export function freeCancelLeft(ticket: TicketState, now = Date.now()) {
  return Math.max(0, Math.ceil((new Date(ticket.createdAt).getTime() + TRAVEL.freeCancelMinutes * 60_000 - now) / 60_000));
}

export function hotelRefund(booking: HotelBookingState, now = Date.now()) {
  if (booking.status === "booked") return booking.price;
  if (booking.status !== "checked_in") return 0;
  const nightMs = TRAVEL.hotelNightHours * 3_600_000;
  const left = Math.floor(Math.max(0, new Date(booking.endsAt).getTime() - now) / nightMs);
  return Math.min(booking.price, left * Math.round(booking.price / booking.nights));
}

export const LEG_LABEL: Record<string, string> = { booked: "Booked", checked_in: "Checked in", boarded: "On board", flown: "Flown", cancelled: "Cancelled" };

export function navigateTo(placeId: string, onNavigate: (target: { point: Vec2; label: string }) => void) {
  const place = placeById.get(placeId);
  if (place) onNavigate({ point: place.door, label: place.name });
}

/** One line of next-step guidance for the HUD while a trip is under way. */
export function tripHint(trip: TripState | null, location: string | undefined) {
  if (!trip) return null;
  if (trip.stage === "arrived" && location === "interior") {
    if (!trip.immigrationDone) return "Next: immigration desks ahead";
    if (!trip.bagCollected) return "Next: baggage belt on the right";
    return "Next: exit to the pickup area";
  }
  if (trip.stage === "airport" && trip.leg === "outbound" && location === "interior") return "Tickets & check-in on the left · gate at the back";
  if (trip.stage === "airport" && trip.leg === "return" && location === "interior") return "Check in on the left · gate at the back";
  return null;
}

type SheetBase = { economy: EconomyState | null; onClose: () => void; onRefresh: () => Promise<void>; onToast: (notice: Notice) => void };

function useRunner(onToast: (notice: Notice) => void, after: () => Promise<unknown>) {
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<string | null>) => {
    if (busy) return;
    setBusy(true);
    try {
      const text = await work();
      if (text) onToast({ tone: "success", text });
      await after();
    } catch (error) {
      onToast({ tone: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return [busy, run] as const;
}

function Sheet({ eyebrow, title, onClose, testId, children }: { eyebrow: string; title: string; onClose: () => void; testId: string; children: React.ReactNode }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section className="sheet travel-sheet" role="dialog" aria-label={title} data-testid={testId} onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h2>{title}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">✕</button>
        </header>
        {children}
      </section>
    </div>
  );
}

function VisaLine({ status }: { status: TravelStatus | null }) {
  const visa = status?.visa;
  if (!status) return <p className="muted small">Checking your travel documents…</p>;
  if (!visa) return <p className="travel-flag warn">No Dubai visa yet. Apply at the {CONSULATE_NAME} before buying a ticket.</p>;
  if (visa.status === "processing") return <p className="travel-flag">Visa {visa.reference} processing · ready in {Math.max(1, Math.ceil((Date.parse(visa.readyAt) - Date.now()) / 1000))} s</p>;
  return <p className="travel-flag ok">Visa {visa.reference} issued · {visa.visitsTotal - visa.visitsUsed} of {visa.visitsTotal} visits left · valid until {new Date(visa.validUntil).toLocaleDateString("en-NG", { day: "numeric", month: "short" })}</p>;
}

function TicketLine({ ticket }: { ticket: TicketState | null | undefined }) {
  if (!ticket) return <p className="muted small">No return ticket yet.</p>;
  return (
    <p className="travel-flag ok">
      {CABINS[ticket.cabin].name} return {ticket.reference} · {seatLabel(ticket.seat)} · out: {LEG_LABEL[ticket.outbound]} · back: {LEG_LABEL[ticket.return]}
    </p>
  );
}

/* ---------- Street places ---------- */

export function TravelPlaceSheet({
  place,
  engine,
  economy,
  onClose,
  onRefresh,
  onToast,
  onNavigate,
  onOpenApp,
}: SheetBase & { place: Place; engine: GameEngine; onNavigate: (target: { point: Vec2; label: string }) => void; onOpenApp: (app: "travel" | "ride") => void }) {
  const [status, reload] = useTravelStatus();
  const [busy, run] = useRunner(onToast, async () => {
    await reload();
    await onRefresh();
  });
  const balance = economy?.balance ?? 0;
  const go = (action: () => void) => {
    action();
    onClose();
  };
  const photoButton = (
    <button className="secondary" onClick={() => go(() => engine.takePhoto(place.id))} data-testid="take-photo">📸 Take a photo here</button>
  );

  if (place.kind === "consulate") {
    return (
      <Sheet eyebrow="FICTIONAL · GAME ROLEPLAY" title={CONSULATE_NAME} onClose={onClose} testId="consulate-sheet">
        <p className="muted">{CONSULATE_NOTICE}</p>
        <p>Inside: a reception desk, waiting seats and a visa counter. Tourist visas cost a fixed fee, take about {TRAVEL.visaProcessingSeconds} seconds to process and are never randomly refused.</p>
        <VisaLine status={status} />
        <button className="primary" onClick={() => go(() => engine.enterTravel("consulate"))} data-testid="enter-consulate">Enter the office</button>
      </Sheet>
    );
  }

  if (place.kind === "airport") {
    const lagos = place.id === TRAVEL_PLACES.lagosAirport;
    const ticket = status?.ticket;
    return (
      <Sheet eyebrow={lagos ? "INTERNATIONAL DEPARTURES" : "DUBAI ARRIVALS & DEPARTURES · RECREATED"} title={place.name} onClose={onClose} testId="airport-sheet">
        {lagos ? (
          <>
            <p className="muted">Fly Lagos ⇄ Dubai with a return ticket. Inside: ticket desks, check-in, the Business lounge and the gate. The flight takes one minute, and you can skip it.</p>
            <ol className="travel-steps">
              <li className={status?.visa?.status === "issued" ? "done" : ""}>Get a tourist visa at the consular office</li>
              <li className={ticket ? "done" : ""}>Buy a return ticket (Economy {naira(CABINS.economy.fare)} · Business {naira(CABINS.business.fare)})</li>
              <li className={ticket && ticket.outbound !== "booked" ? "done" : ""}>Check in, then board at the gate</li>
            </ol>
            <VisaLine status={status} />
            <TicketLine ticket={ticket} />
            {status && !status.visa && <button className="link" onClick={() => { navigateTo(TRAVEL_PLACES.consulate, onNavigate); onClose(); }}>Directions to the consular office</button>}
          </>
        ) : (
          <>
            <p className="muted">Going home? Enter departures to check in for your return flight. Arriving passengers come out here at the pickup area.</p>
            <TicketLine ticket={ticket} />
            <div className="row">
              <button className="secondary" onClick={() => { onOpenApp("ride"); }}>🚕 Taxi to the Marina</button>
              <button className="secondary" onClick={() => { navigateTo(TRAVEL_PLACES.carRental, onNavigate); onClose(); }}>🚗 Car hire desk</button>
            </div>
          </>
        )}
        <button className="primary" onClick={() => go(() => engine.enterTravel("airport"))} data-testid="enter-airport">Enter the terminal</button>
      </Sheet>
    );
  }

  if (place.kind === "hotel") return <HotelSheet place={place} engine={engine} status={status} busy={busy} run={run} balance={balance} onClose={onClose} />;

  if (place.kind === "lounge") {
    return (
      <Sheet eyebrow="ROOFTOP LOUNGE · FICTIONAL" title={place.name} onClose={onClose} testId="rooftop-sheet">
        <p className="muted">Take the lift to an open-air terrace over the marina, with a bar, dining tables and a skyline photo frame. Entry is free; you pay for what you order.</p>
        <button className="primary" onClick={() => go(() => engine.enterTravel("rooftop"))} data-testid="enter-rooftop">Take the lift up</button>
      </Sheet>
    );
  }

  if (place.kind === "marina" || place.kind === "desert") {
    const desert = place.kind === "desert";
    const offered = (Object.keys(ACTIVITIES) as ActivityId[]).filter((id) => !desert || id === "desert-safari");
    return (
      <Sheet eyebrow={desert ? "DESERT CAMP · FICTIONAL" : "MARINA TOURS DESK"} title={place.name} onClose={onClose} testId="activity-sheet">
        {desert && <p className="muted">A Bedouin-style camp for photos by the dunes. The 4×4 back to the Marina is free.</p>}
        <ul className="venue-list">
          {offered.map((id) => {
            const activity = ACTIVITIES[id];
            const done = status?.activities.some((entry) => entry.activity === id);
            return (
              <li key={id}>
                <div>
                  <strong>{activity.name}{done ? " ✓" : ""}</strong>
                  <span>{activity.blurb} About {activity.seconds} s · {naira(activity.price)}</span>
                </div>
                <button className="primary small-button" disabled={busy || balance < activity.price} onClick={() => go(() => engine.startActivity(id))} data-testid={`book-${id}`}>
                  {balance < activity.price ? "Not enough" : `Book · ${naira(activity.price)}`}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="row">
          {photoButton}
          {desert && <button className="secondary" onClick={() => go(() => engine.backToMarina())}>4×4 back to the Marina</button>}
        </div>
      </Sheet>
    );
  }

  if (place.kind === "car_rental") {
    return <CarHireSheet place={place} engine={engine} status={status} balance={balance} busy={busy} run={run} onClose={onClose} />;
  }

  return (
    <Sheet eyebrow={place.kind === "beach" ? "PUBLIC BEACH" : "PHOTO SPOT"} title={place.name} onClose={onClose} testId="photo-sheet">
      <p className="muted">{place.kind === "beach" ? "Soft sand, the Gulf and the Ain Dubai wheel offshore. Free for everyone." : "Line up the skyline and snap a picture. Friends standing near you are tagged in the photo."}</p>
      {photoButton}
    </Sheet>
  );
}

function HotelSheet({ place, engine, status, busy, run, balance, onClose }: { place: Place; engine: GameEngine; status: TravelStatus | null; busy: boolean; run: (work: () => Promise<string | null>) => Promise<void>; balance: number; onClose: () => void }) {
  const hotel = hotelById.get(place.id);
  const [nights, setNights] = useState(1);
  const [key, setKey] = useState<string | null>(null);
  if (!hotel) return null;
  const stays = (status?.bookings ?? []).filter((booking) => booking.hotelId === hotel.id && (booking.status === "booked" || booking.status === "checked_in"));
  return (
    <Sheet eyebrow={`${hotel.tier.toUpperCase()} HOTEL · FICTIONAL`} title={hotel.name} onClose={onClose} testId="hotel-sheet">
      <p className="muted">{hotel.blurb} One night is {TRAVEL.hotelNightHours} real hours. You pay the whole stay up front, so nothing is charged while you're offline.</p>
      {stays.map((booking) => (
        <div key={booking.id} className="travel-card" data-testid="hotel-stay">
          <strong>{booking.mine ? "Your stay" : `${booking.ownerName}'s stay (you're a guest)`} · {booking.roomName}</strong>
          <span>{booking.nights} night{booking.nights === 1 ? "" : "s"} · until {new Date(booking.endsAt).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })}</span>
          {booking.status === "checked_in" && (key || booking.keyCode) && <span className="digital-key">🔑 Digital key {key ?? booking.keyCode}</span>}
          <div className="row">
            {booking.mine && booking.status === "booked" && (
              <button className="primary" disabled={busy} data-testid="hotel-checkin" onClick={() => void run(async () => {
                const result = await api.checkInHotel(booking.id);
                setKey(result.keyCode);
                return `Checked in. Your digital key is ${result.keyCode}.`;
              })}>Check in at reception</button>
            )}
            {booking.status === "checked_in" && (
              <button className="primary" data-testid="hotel-go-up" onClick={() => { engine.enterTravel("hotel", { hotelId: hotel.id, bookingId: booking.id }); onClose(); }}>Go up to the room</button>
            )}
            {!booking.mine && booking.status === "booked" && <span className="muted small">Waiting for {booking.ownerName} to check in.</span>}
          </div>
        </div>
      ))}
      <label className="travel-nights">
        Nights
        <select value={nights} onChange={(event) => setNights(Number(event.target.value))}>
          {Array.from({ length: TRAVEL.maxNights }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count}</option>)}
        </select>
      </label>
      <ul className="venue-list">
        {hotel.rooms.map((room) => {
          const total = room.perNight * nights;
          return (
            <li key={room.type}>
              <div>
                <strong>{room.name} · {naira(room.perNight)}/night</strong>
                <span>Sleeps {room.capacity} · {room.amenities.join(" · ")}</span>
              </div>
              <div className="stack">
                <button className="secondary small-button" onClick={() => { engine.enterTravel("hotel", { hotelId: hotel.id, previewRoom: room.type as RoomType }); onClose(); }}>Preview</button>
                <button className="primary small-button" disabled={busy || balance < total} data-testid={`book-${room.type}`} onClick={() => void run(async () => {
                  await api.bookHotel(hotel.id, room.type as RoomType, nights);
                  return `Booked ${room.name} for ${nights} night${nights === 1 ? "" : "s"} · ${naira(total)}. Check in here to get your key.`;
                })}>{balance < total ? "Not enough" : `Book · ${naira(total)}`}</button>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="muted small">Cancel before check-in for a full refund. Checking out early refunds whole unused nights. Anything left in the room safe comes back to your inventory when the stay ends.</p>
    </Sheet>
  );
}

function CarHireSheet({ place, engine, status, balance, busy, run, onClose }: { place: Place; engine: GameEngine; status: TravelStatus | null; balance: number; busy: boolean; run: (work: () => Promise<string | null>) => Promise<void>; onClose: () => void }) {
  const [hours, setHours] = useState(1);
  const rental = status?.rental;
  return (
    <Sheet eyebrow="CAR HIRE · DUBAI" title={place.name} onClose={onClose} testId="car-hire-sheet">
      <p className="muted">Hire cars stay in Dubai and go back automatically when the time is up. Your own cars in Lagos are never moved.</p>
      {rental ? (
        <div className="travel-card">
          <strong>{modelName(rental.modelId)} on hire</strong>
          <span>Until {new Date(rental.until).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })}</span>
          <button className="secondary" disabled={busy} onClick={() => { engine.returnCar(); onClose(); }}>Return it now</button>
        </div>
      ) : (
        <>
          <label className="travel-nights">
            Hours
            <select value={hours} onChange={(event) => setHours(Number(event.target.value))}>
              {Array.from({ length: CAR_RENTAL.maxHours }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count}</option>)}
            </select>
          </label>
          <ul className="venue-list">
            {RENTAL_CARS.map((car) => (
              <li key={car.modelId}>
                <div>
                  <strong>{modelName(car.modelId)}</strong>
                  <span>{naira(car.perHour)}/hour · {naira(car.perHour * hours)} for {hours} h</span>
                </div>
                <button className="primary small-button" disabled={busy || balance < car.perHour * hours} onClick={() => void run(async () => {
                  engine.rentCar(car.modelId, hours);
                  onClose();
                  return null;
                })}>{balance < car.perHour * hours ? "Not enough" : "Hire"}</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Sheet>
  );
}

/* ---------- Spots inside travel interiors ---------- */

export function TravelSpotSheet({ interior, spot, engine, trip, economy, onClose, onRefresh, onToast, onNavigate }: SheetBase & {
  interior: TravelInterior;
  spot: string;
  engine: GameEngine;
  trip: TripState | null;
  onNavigate: (target: { point: Vec2; label: string }) => void;
}) {
  const [status, reload] = useTravelStatus();
  const [busy, run] = useRunner(onToast, async () => {
    await reload();
    await onRefresh();
  });
  const balance = economy?.balance ?? 0;
  const counter = (action: Parameters<GameEngine["travelCounter"]>[0]) => {
    engine.travelCounter(action);
    onClose();
  };
  const now = Date.now();

  if (interior === "consulate") {
    const visa = status?.visa;
    if (spot === "counter") {
      return (
        <Sheet eyebrow="VISA COUNTER · GAME ROLEPLAY" title="Tourist visas for Dubai" onClose={onClose} testId="visa-counter">
          <p className="muted">{CONSULATE_NOTICE} Fees are fixed, processing takes about {TRAVEL.visaProcessingSeconds} seconds, and applications are never randomly refused.</p>
          <VisaLine status={status} />
          <ul className="venue-list">
            {visaPlans.map((plan) => {
              const details = VISA_PLANS[plan];
              return (
                <li key={plan}>
                  <div>
                    <strong>{details.name}</strong>
                    <span>{details.visits} visit{details.visits === 1 ? "" : "s"} within {details.days} days · fee {naira(details.fee)}</span>
                  </div>
                  <button className="primary small-button" disabled={busy || balance < details.fee || visa?.status === "processing" || (visa?.status === "issued" && visa.visitsUsed < visa.visitsTotal)} data-testid={`visa-${plan}`} onClick={() => void run(async () => {
                    const result = await api.applyVisa(plan);
                    return result.replayed ? "That application is already in." : `Application ${result.visa.reference} received · ${naira(details.fee)} paid. Take a seat; it's ready in about ${TRAVEL.visaProcessingSeconds} seconds.`;
                  })}>{balance < details.fee ? "Not enough" : `Apply · ${naira(details.fee)}`}</button>
                </li>
              );
            })}
          </ul>
          {visa?.status === "issued" && <p className="muted small">Your visa is on your phone in Travel. Next: the airport, {placeById.get(TRAVEL_PLACES.lagosAirport)?.name}.</p>}
        </Sheet>
      );
    }
    return (
      <Sheet eyebrow={spot === "reception" ? "RECEPTION" : "WAITING AREA"} title={CONSULATE_NAME} onClose={onClose} testId="consulate-info">
        {spot === "reception" ? (
          <>
            <p>Welcome. To travel to Dubai you need a tourist visa from the counter on the right, then a return ticket from the airport.</p>
            <ol className="travel-steps">
              <li>Choose a visa plan at the counter and pay the fee</li>
              <li>Wait a few seconds on the seats while it's processed</li>
              <li>Your visa appears in Phone → Travel; then head to the airport</li>
            </ol>
          </>
        ) : (
          <p>Have a seat while your application is processed.</p>
        )}
        <VisaLine status={status} />
        {visa?.status === "issued" && (
          <button className="link" onClick={() => { navigateTo(TRAVEL_PLACES.lagosAirport, onNavigate); onClose(); }}>Directions to the airport</button>
        )}
      </Sheet>
    );
  }

  if (interior === "airport-los" || interior === "airport-dxb") {
    const lagos = interior === "airport-los";
    const ticket = status?.ticket;
    const leg = lagos ? ticket?.outbound : ticket?.return;
    if (spot === "tickets") {
      const refund = ticket ? ticketRefund(ticket, now) : null;
      return (
        <Sheet eyebrow="TICKET DESK" title="Lagos ⇄ Dubai return" onClose={onClose} testId="ticket-desk">
          {ticket ? (
            <div className="travel-card" data-testid="my-ticket">
              <strong>{CABINS[ticket.cabin].name} · {ticket.reference} · {seatLabel(ticket.seat)}</strong>
              <span>Paid {naira(ticket.fare)} · out: {LEG_LABEL[ticket.outbound]} · back: {LEG_LABEL[ticket.return]}</span>
              {refund !== null ? (
                <>
                  <span className="muted small">
                    {freeCancelLeft(ticket, now) > 0
                      ? `Free cancellation for ${freeCancelLeft(ticket, now)} more min: full refund of ${naira(refund)}.`
                      : `Cancel now for ${naira(refund)} back (${Math.round(TRAVEL.cancelFeeRate * 100)}% kept). No cancellations once you've boarded.`}
                  </span>
                  <button className="secondary" disabled={busy} onClick={() => void run(async () => {
                    const result = await api.cancelTicket(ticket.id);
                    return `Ticket cancelled · ${naira(result.refund)} refunded.`;
                  })}>Cancel ticket</button>
                </>
              ) : (
                <span className="muted small">You've flown out, so this ticket can't be cancelled. Your return flight is included.</span>
              )}
            </div>
          ) : lagos && status && status.visa?.status !== "issued" ? (
            <div className="travel-card warn" data-testid="visa-needed">
              <strong>You need a Dubai visa first</strong>
              <span>{status.visa?.status === "processing" ? "Your visa is still processing. It will be ready in a few seconds." : `Apply at the ${CONSULATE_NAME}. It takes about ${TRAVEL.visaProcessingSeconds} seconds and is never randomly refused.`}</span>
              {!status.visa && <button className="link" onClick={() => { navigateTo(TRAVEL_PLACES.consulate, onNavigate); onClose(); }}>Directions to the consular office</button>}
            </div>
          ) : !lagos ? (
            <p className="muted">Tickets are sold in Lagos as returns. Without one, ask at the Lagos terminal.</p>
          ) : null}
          {lagos && !ticket && status?.visa?.status === "issued" && (
            <div className="cabin-options">
              {cabinClasses.map((cabin: CabinClass) => {
                const details = CABINS[cabin];
                return (
                  <div key={cabin} className={`travel-card cabin-${cabin}`}>
                    <strong>{details.name} return · {naira(details.fare)}</strong>
                    <span>{details.seat}</span>
                    <ul>{details.perks.map((perk) => <li key={perk}>{perk}</li>)}</ul>
                    <span className="muted small">Total to pay now: {naira(details.fare)}. Free cancellation for {TRAVEL.freeCancelMinutes} min, then {Math.round(TRAVEL.cancelFeeRate * 100)}% is kept until you board.</span>
                    <button className="primary" disabled={busy || balance < details.fare} data-testid={`buy-${cabin}`} onClick={() => void run(async () => {
                      const result = await api.buyTicket(cabin);
                      return result.replayed ? "You already have this ticket." : `${details.name} return booked · ${result.ticket.reference} · ${seatLabel(result.ticket.seat)}. Check in at the next counter.`;
                    })}>{balance < details.fare ? `You need ${naira(details.fare)}` : `Pay ${naira(details.fare)}`}</button>
                  </div>
                );
              })}
            </div>
          )}
          {ticket && <p className="muted small">Travelling with friends? Invite them from Phone → Travel. Each friend pays their own fare only when they accept.</p>}
        </Sheet>
      );
    }
    if (spot === "checkin") {
      return (
        <Sheet eyebrow="CHECK-IN" title={lagos ? "Check in · LL 721 to Dubai" : "Check in · LL 722 to Lagos"} onClose={onClose} testId="checkin-desk">
          <TicketLine ticket={ticket} />
          {!ticket ? <p>You need a ticket first. The ticket desk is just behind you.</p> : leg === "booked" ? (
            <button className="primary" onClick={() => counter("checkin")} data-testid="do-checkin">Check in and drop my bag</button>
          ) : (
            <p>{leg === "checked_in" ? "You're checked in. Head to the gate at the back of the hall." : `This leg is ${LEG_LABEL[leg ?? "booked"]?.toLowerCase()}.`}</p>
          )}
        </Sheet>
      );
    }
    if (spot === "gate") {
      return (
        <Sheet eyebrow="GATE" title={lagos ? "Gate 4 · LL 721 to Dubai" : "Gate 12 · LL 722 to Lagos"} onClose={onClose} testId="gate-desk">
          <TicketLine ticket={ticket} />
          <p className="muted">Doors close {TRAVEL.boardingSeconds} seconds after the first passenger boards, and friends boarding meanwhile share the flight. The flight lasts {TRAVEL.flightSeconds} seconds.</p>
          {leg === "checked_in" ? (
            <button className="primary" onClick={() => counter("board")} data-testid="do-board">Board the plane</button>
          ) : (
            <p>{leg === "booked" ? "Check in at the counter first." : !ticket ? "You need a ticket to board." : "Nothing to board right now."}</p>
          )}
        </Sheet>
      );
    }
    if (spot === "lounge") {
      return (
        <Sheet eyebrow="BUSINESS LOUNGE" title="Sky Lounge" onClose={onClose} testId="lounge-desk">
          <p className="muted">Quiet seating, coffee, pastries and fresh juice for Business passengers.</p>
          <button className="primary" disabled={ticket?.cabin !== "business"} onClick={() => counter("lounge")}>{ticket?.cabin === "business" ? "Show my boarding pass" : "Business tickets only"}</button>
        </Sheet>
      );
    }
    if (spot === "immigration" || spot === "baggage") {
      const immigration = spot === "immigration";
      return (
        <Sheet eyebrow={immigration ? "IMMIGRATION · GAME ROLEPLAY" : "BAGGAGE RECLAIM"} title={immigration ? "Passport control" : "Belt 3 · LL 721"} onClose={onClose} testId={`${spot}-desk`}>
          {immigration ? (
            <>
              <p className="muted">Fictional desks for roleplay. Your visa visit is used once, however many times you come back here.</p>
              <VisaLine status={status} />
              <button className="primary" disabled={trip?.immigrationDone} onClick={() => counter("immigration")} data-testid="do-immigration">{trip?.immigrationDone ? "Passport stamped ✓" : "Hand over my passport"}</button>
            </>
          ) : (
            <button className="primary" disabled={!trip?.immigrationDone || trip.bagCollected} onClick={() => counter("baggage")} data-testid="do-baggage">
              {trip?.bagCollected ? "Bag collected ✓" : trip?.immigrationDone ? "Collect my bag" : "Clear immigration first"}
            </button>
          )}
        </Sheet>
      );
    }
    return (
      <Sheet eyebrow="DEPARTURES" title="Flight information" onClose={onClose} testId="departures-board">
        <table className="departures">
          <tbody>
            <tr><td>LL 721</td><td>Dubai</td><td>Boarding on demand</td></tr>
            <tr><td>LL 722</td><td>Lagos</td><td>From Dubai</td></tr>
          </tbody>
        </table>
        <p className="muted small">Flights leave whenever someone boards; anyone boarding in the next {TRAVEL.boardingSeconds} seconds joins the same flight.</p>
      </Sheet>
    );
  }

  if (interior === "hotel") {
    const bookingId = trip?.room?.bookingId ?? null;
    const booking = status?.bookings.find((entry) => entry.id === bookingId) ?? null;
    const hotel = trip?.room ? hotelById.get(trip.room.hotelId) : undefined;
    if (!booking) {
      return (
        <Sheet eyebrow="ROOM PREVIEW" title={hotel?.name ?? "Hotel room"} onClose={onClose} testId="hotel-preview-spot">
          <p>This is a preview. Book the room at reception downstairs to use the bed, safe and room service.</p>
          <button className="secondary" onClick={() => { engine.exitProperty(); onClose(); }}>Back to reception</button>
        </Sheet>
      );
    }
    if (spot === "storage") return <HotelSafe booking={booking} economy={economy} busy={busy} run={run} onClose={onClose} />;
    if (spot === "service") return <MenuSheet title="Room service" eyebrow={booking.hotelName.toUpperCase()} menu={ROOM_SERVICE} kind="room-service" bookingId={booking.id} balance={balance} busy={busy} run={run} onClose={onClose} />;
    if (spot === "view") {
      return (
        <Sheet eyebrow="WINDOW" title="The view" onClose={onClose} testId="hotel-view">
          <p className="muted">The marina towers and the Gulf beyond.</p>
          <button className="primary" onClick={() => { engine.takePhoto("hotel"); onClose(); }}>📸 Take a photo</button>
        </Sheet>
      );
    }
    return <HotelStay booking={booking} busy={busy} run={run} balance={balance} onClose={onClose} />;
  }

  if (interior === "rooftop") {
    if (spot === "photo") {
      return (
        <Sheet eyebrow="PHOTO FRAME" title="Skyline at sunset" onClose={onClose} testId="rooftop-photo">
          <p className="muted">Friends within a few metres are tagged in the shot.</p>
          <button className="primary" onClick={() => { engine.takePhoto("rooftop"); onClose(); }} data-testid="take-photo">📸 Take a photo</button>
        </Sheet>
      );
    }
    return <MenuSheet title={spot === "bar" ? "Rooftop bar" : "Rooftop dining"} eyebrow="SKYLINE ROOFTOP" menu={ROOFTOP_MENU} kind="rooftop" balance={balance} busy={busy} run={run} onClose={onClose} />;
  }
  return null;
}

function MenuSheet({ title, eyebrow, menu, kind, bookingId, balance, busy, run, onClose }: {
  title: string;
  eyebrow: string;
  menu: ReadonlyArray<{ id: string; name: string; price: number; hunger: number; energy: number }>;
  kind: "room-service" | "rooftop";
  bookingId?: string;
  balance: number;
  busy: boolean;
  run: (work: () => Promise<string | null>) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <Sheet eyebrow={eyebrow} title={title} onClose={onClose} testId={`menu-${kind}`}>
      <ul className="venue-list">
        {menu.map((item) => (
          <li key={item.id}>
            <div>
              <strong>{item.name}</strong>
              <span>{naira(item.price)} · hunger +{item.hunger} · energy +{item.energy}</span>
            </div>
            <button className="primary small-button" disabled={busy || balance < item.price} data-testid={`order-${item.id}`} onClick={() => void run(async () => {
              const result = await api.travelOrder(kind, item.id, bookingId);
              return `${result.name} served · ${naira(item.price)}.`;
            })}>{balance < item.price ? "Not enough" : `Order · ${naira(item.price)}`}</button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

function HotelSafe({ booking, economy, busy, run, onClose }: { booking: HotelBookingState; economy: EconomyState | null; busy: boolean; run: (work: () => Promise<string | null>) => Promise<void>; onClose: () => void }) {
  const carried = (economy?.inventory ?? []).filter((item) => item.quantity > 0 && item.category !== "food");
  return (
    <Sheet eyebrow={`${booking.roomName.toUpperCase()} · WARDROBE`} title="Room safe" onClose={onClose} testId="hotel-safe">
      <p className="muted small">Only you can open your safe. Anything still inside comes back to your inventory when the stay ends.</p>
      <h3>In the safe</h3>
      {booking.storage.length === 0 && <p className="muted small">Empty.</p>}
      <ul className="venue-list">
        {booking.storage.map((item) => (
          <li key={item.itemId}>
            <div><strong>{item.name}</strong><span>×{item.quantity}</span></div>
            <button className="secondary small-button" disabled={busy || !booking.mine} onClick={() => void run(async () => { await api.hotelStorage(booking.id, item.itemId, "out"); return `Took ${item.name} out of the safe.`; })}>Take one</button>
          </li>
        ))}
      </ul>
      {booking.mine && (
        <>
          <h3>Carrying</h3>
          {carried.length === 0 && <p className="muted small">Nothing to store.</p>}
          <ul className="venue-list">
            {carried.map((item) => (
              <li key={item.itemId}>
                <div><strong>{item.name}</strong><span>×{item.quantity}</span></div>
                <button className="secondary small-button" disabled={busy} onClick={() => void run(async () => { await api.hotelStorage(booking.id, item.itemId, "in"); return `${item.name} locked in the safe.`; })}>Store one</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Sheet>
  );
}

export function HotelStay({ booking, busy, run, balance, onClose }: { booking: HotelBookingState; busy: boolean; run: (work: () => Promise<string | null>) => Promise<void>; balance: number; onClose?: () => void }) {
  const [guest, setGuest] = useState("");
  const perNight = Math.round(booking.price / booking.nights);
  const refund = hotelRefund(booking);
  const body = (
    <div className="travel-card" data-testid="hotel-stay-card">
      <strong>{booking.hotelName} · {booking.roomName}{booking.mine ? "" : ` · guest of ${booking.ownerName}`}</strong>
      <span>{booking.nights} night{booking.nights === 1 ? "" : "s"} · {naira(booking.price)} paid · ends {new Date(booking.endsAt).toLocaleString("en-NG", { weekday: "short", hour: "2-digit", minute: "2-digit" })}</span>
      {booking.keyCode && <span className="digital-key">🔑 Digital key {booking.keyCode}</span>}
      {booking.guests.length > 0 && <span>Guests: {booking.guests.join(", ")}</span>}
      {booking.mine && (
        <>
          <div className="row">
            <button className="secondary small-button" disabled={busy || balance < perNight || booking.nights >= TRAVEL.maxNights} onClick={() => void run(async () => { await api.extendHotelStay(booking.id, 1); return `Stay extended by one night · ${naira(perNight)}.`; })}>
              Extend 1 night · {naira(perNight)}
            </button>
            <button className="secondary small-button" disabled={busy} data-testid="hotel-checkout" onClick={() => void run(async () => {
              const result = await api.endHotelStay(booking.id);
              onClose?.();
              return `${booking.status === "booked" ? "Booking cancelled" : "Checked out"} · ${naira(result.refund)} refunded. Your safe's contents are back in your inventory.`;
            })}>{booking.status === "booked" ? "Cancel booking" : "Check out"} · {naira(refund)} back</button>
          </div>
          <form className="row" onSubmit={(event) => {
            event.preventDefault();
            const name = guest.trim();
            if (!name) return;
            void run(async () => { await api.hotelGuest(booking.id, name, true); setGuest(""); return `${name} can now go up to your room.`; });
          }}>
            <input value={guest} onChange={(event) => setGuest(event.target.value)} placeholder="Friend's resident name" aria-label="Invite a guest" />
            <button className="secondary small-button" disabled={busy || !guest.trim()}>Invite guest</button>
          </form>
          {booking.guests.map((name) => (
            <button key={name} className="link" disabled={busy} onClick={() => void run(async () => { await api.hotelGuest(booking.id, name, false); return `${name} no longer has access.`; })}>Remove {name}</button>
          ))}
        </>
      )}
    </div>
  );
  if (!onClose) return body;
  return (
    <Sheet eyebrow="YOUR ROOM" title="Your stay" onClose={onClose} testId="hotel-bed">
      <p className="muted small">Paid up front, so nothing is charged while you're offline. Early checkout refunds whole unused nights.</p>
      {body}
    </Sheet>
  );
}

/* ---------- Flight and excursion overlays ---------- */

const PHASE_LABEL = { boarding: "Boarding · doors closing", takeoff: "Takeoff", cruise: "Cruising · cabin service", descent: "Descent", landed: "Landed" } as const;

export function FlightPanel({ engine, trip, now }: { engine: GameEngine; trip: TripState; now: number }) {
  const flight = trip.flight!;
  const [audio, setAudio] = useState(() => engine.getCabinAudio());
  const serverNow = now + engine.serverClockOffset();
  const phase = flightPhase(flight.departAt, serverNow);
  const elapsed = Math.max(0, (serverNow - flight.departAt) / 1000);
  const left = Math.max(0, Math.ceil((flight.arriveAt - serverNow) / 1000));
  const pending = engine.arrivalPreload();
  const toggle = (key: "hum" | "announcements") => {
    const next = { ...audio, [key]: !audio[key] };
    setAudio(next);
    engine.setCabinAudio(next);
  };
  return (
    <section className="flight-panel" data-testid="flight-panel">
      <p className="eyebrow">{flight.code} · {flight.label}</p>
      <p><strong>{CABINS[flight.cabin].name}</strong> · {seatLabel(flight.seat)}</p>
      <p>{PHASE_LABEL[phase]}{phase === "boarding" ? ` · ${Math.max(0, Math.ceil((flight.departAt - serverNow) / 1000))} s` : ` · lands in ${left} s`}</p>
      <div className="flight-progress" aria-label="Flight progress">
        <i style={{ width: `${Math.min(100, (elapsed / TRAVEL.flightSeconds) * 100)}%` }} />
        <span style={{ left: `${(TRAVEL.takeoffEnds / TRAVEL.flightSeconds) * 100}%` }} />
        <span style={{ left: `${(TRAVEL.cruiseEnds / TRAVEL.flightSeconds) * 100}%` }} />
      </div>
      {flight.companions.length > 0 && <p className="small">Travelling with {flight.companions.join(", ")}</p>}
      <p className="small muted" data-testid="arrival-preload">
        {phase === "boarding" ? `${trip.leg === "return" ? "Lagos" : "Dubai"} starts loading after takeoff.` : pending > 0 ? `Preparing ${trip.leg === "return" ? "Lagos" : "Dubai"}… ${pending} map area${pending === 1 ? "" : "s"} left` : `${trip.leg === "return" ? "Lagos" : "Dubai"} is ready.`}
      </p>
      <div className="row">
        <button className={`secondary small-button ${audio.hum ? "active" : ""}`} aria-pressed={audio.hum} onClick={() => toggle("hum")}>Cabin sound {audio.hum ? "on" : "off"}</button>
        <button className={`secondary small-button ${audio.announcements ? "active" : ""}`} aria-pressed={audio.announcements} onClick={() => toggle("announcements")}>Announcements {audio.announcements ? "on" : "off"}</button>
        <button className="primary small-button" data-testid="skip-flight" onClick={() => engine.travelCounter("skip")}>Skip flight</button>
      </div>
    </section>
  );
}

export function ExcursionPanel({ engine, trip, now }: { engine: GameEngine; trip: TripState; now: number }) {
  const excursion = trip.excursion!;
  const serverNow = now + engine.serverClockOffset();
  const details = ACTIVITIES[excursion.activity];
  const starting = serverNow < excursion.startsAt;
  const left = Math.max(0, Math.ceil((excursion.endsAt - serverNow) / 1000));
  return (
    <section className="flight-panel" data-testid="excursion-panel">
      <p className="eyebrow">{details.name.toUpperCase()}</p>
      <p>{starting ? `Setting off in ${Math.ceil((excursion.startsAt - serverNow) / 1000)} s` : `Back in ${left} s`}</p>
      <div className="flight-progress"><i style={{ width: `${Math.min(100, Math.max(0, (serverNow - excursion.startsAt) / (excursion.endsAt - excursion.startsAt)) * 100)}%` }} /></div>
      <p className="small muted">{details.blurb}</p>
    </section>
  );
}

