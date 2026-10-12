import { EventEmitter } from "node:events";

/**
 * `furniture`: a home's furniture changed, so anyone inside reloads it.
 * `invited`: a resident was asked round (guest user id, host name, home name).
 */
export const homeEvents = new EventEmitter<{ furniture: [propertyId: string]; invited: [guestId: string, host: string, home: string] }>();
homeEvents.setMaxListeners(50);
