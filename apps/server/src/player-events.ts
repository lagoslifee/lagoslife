import { EventEmitter } from "node:events";

/** `notice`: a toast for one resident if they are online in this process (user id, tone, text). */
export const playerEvents = new EventEmitter<{ notice: [userId: string, tone: "info" | "success" | "error", text: string] }>();
playerEvents.setMaxListeners(50);
