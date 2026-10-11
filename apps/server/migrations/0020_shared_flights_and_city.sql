-- One passenger per seat on each shared flight, enforced by the database as well as the room.
CREATE UNIQUE INDEX IF NOT EXISTS travel_ticket_flight_seat ON travel_ticket (flight_id, flight_seat)
  WHERE flight_id IS NOT NULL AND flight_seat IS NOT NULL;
