import { EventEmitter } from "node:events";

/** Lets HTTP vehicle mutations refresh the live room's vehicle cache in the same process. */
export const vehicleEvents = new EventEmitter<{
  changed: [vehicleId: string];
  ownerReset: [userId: string];
}>();
