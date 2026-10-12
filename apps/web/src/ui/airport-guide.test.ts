import { describe, expect, it } from "vitest";
import { emptyTrip, type TicketState } from "@lagos-living/shared";
import { airportStep } from "./airport-guide";

const ticket = (outbound: TicketState["outbound"], back: TicketState["return"] = "booked") =>
  ({ id: "t", reference: "R", cabin: "economy", fare: 1, seat: "14A", partyId: "p", outbound, return: back, immigrationDone: false, createdAt: "", cancelledAt: null, refunded: 0, companions: [] }) as TicketState;

describe("airportStep", () => {
  it("walks a Lagos departure through tickets, check-in and gate", () => {
    const trip = { ...emptyTrip(), stage: "airport" as const };
    expect(airportStep("airport-los", trip, null)?.spot).toBe("tickets");
    expect(airportStep("airport-los", trip, ticket("booked"))?.spot).toBe("checkin");
    expect(airportStep("airport-los", trip, ticket("checked_in"))?.spot).toBe("gate");
  });

  it("sends a Dubai arrival to immigration before baggage and the exit", () => {
    const arrived = { ...emptyTrip(), stage: "arrived" as const };
    expect(airportStep("airport-dxb", arrived, ticket("flown"))?.spot).toBe("immigration");
    expect(airportStep("airport-dxb", { ...arrived, immigrationDone: true }, ticket("flown"))?.spot).toBe("baggage");
    expect(airportStep("airport-dxb", { ...arrived, immigrationDone: true, bagCollected: true }, ticket("flown"))?.spot).toBe("exit");
  });

  it("uses the return leg when flying home from Dubai", () => {
    const trip = { ...emptyTrip(), stage: "airport" as const, immigrationDone: true };
    expect(airportStep("airport-dxb", trip, ticket("flown", "booked"))?.spot).toBe("checkin");
    expect(airportStep("airport-dxb", trip, ticket("flown", "checked_in"))?.spot).toBe("gate");
  });

  it("gives no step outside terminals", () => {
    expect(airportStep("hotel", null, null)).toBeNull();
    expect(airportStep(null, null, null)).toBeNull();
  });
});
