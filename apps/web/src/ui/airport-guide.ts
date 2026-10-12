import type { TicketState, TravelInterior, TripState } from "@lagos-living/shared";

export type AirportStep = { spot: string; label: string; detail: string; step: number; total: number };

/**
 * The one thing to do next inside a terminal, in the order the desks are used: tickets, check-in, gate when
 * departing; immigration, baggage, exit when arriving in Dubai. `ticket` is the player's latest ticket from
 * the travel status (null when they have none or it is not loaded yet).
 */
export function airportStep(kind: TravelInterior | null, trip: TripState | null, ticket: TicketState | null): AirportStep | null {
  if (kind !== "airport-los" && kind !== "airport-dxb") return null;
  if (kind === "airport-dxb" && trip?.stage === "arrived") {
    if (!trip.immigrationDone) return { spot: "immigration", label: "Immigration", step: 1, total: 3, detail: "Welcome to Dubai. Show your passport at the immigration desks straight ahead before anything else." };
    if (!trip.bagCollected) return { spot: "baggage", label: "Baggage reclaim", step: 2, total: 3, detail: "Collect your bag from the belt on the right." };
    return { spot: "exit", label: "Exit · taxis & car hire", step: 3, total: 3, detail: "Walk out through the green EXIT doors to taxis, hire cars and your hotel." };
  }
  const leg = kind === "airport-los" ? "outbound" : "return";
  const status = ticket && !ticket.cancelledAt ? ticket[leg] : null;
  const home = kind === "airport-dxb";
  if (status === "booked") return { spot: "checkin", label: "2 · Check-in", step: 2, total: 3, detail: `Check in and drop your bag at desk 2${home ? " for your flight home to Lagos" : ""}.` };
  if (status === "checked_in" || status === "boarded") return { spot: "gate", label: `3 · Gate ${home ? "B7" : "3"}`, step: 3, total: 3, detail: `You're checked in. Board at gate ${home ? "B7" : "3"} at the back of the hall.` };
  return {
    spot: "tickets",
    label: "1 · Tickets",
    step: 1,
    total: 3,
    detail: home ? "To fly back to Lagos, buy a ticket at desk 1 on the left." : "Buy your ticket at desk 1 on the left. You need a Dubai visa from the consulate first.",
  };
}
