import { EventEmitter } from "node:events";

/** Lets HTTP vehicle mutations refresh the live room's vehicle cache in the same process. */
export const vehicleEvents = new EventEmitter<{
  changed: [vehicleId: string];
  ownerReset: [userId: string];
}>();

/** The room's live view of street vehicles, for HTTP handlers that need the tank as it is right now. */
export const liveVehicles: {
  fuel?: (vehicleId: string) => { litres: number; x: number; z: number } | undefined;
  refuel?: (vehicleId: string, litres: number) => void;
} = {};
