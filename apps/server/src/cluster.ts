import { randomUUID } from "node:crypto";
import type { EventEmitter } from "node:events";
import type { Presence } from "@colyseus/core";

/**
 * Relays in-process events between server processes that share one Redis, so an HTTP mutation handled by one
 * process reaches rooms hosted by another. Without `REDIS_URL` nothing here is wired and events stay local.
 */
const CHANNEL = "lagos:cluster";
export const processTag = randomUUID();

type Envelope = { origin: string; source: string; event: string; args: unknown[] };

let presence: Presence | null = null;
type Handler = (event: string, args: unknown[], origin: string) => void;
const local = new Map<string, Handler>();

export function clusterEnabled() {
  return presence !== null;
}

export function publish(source: string, event: string, args: unknown[]) {
  if (!presence) return;
  const envelope: Envelope = { origin: processTag, source, event, args };
  void presence.publish(CHANNEL, envelope).catch((error: unknown) => console.error("Cluster publish failed", error));
}

/** Registers a handler for messages other processes publish under `source`. */
export function onRemote(source: string, handler: Handler) {
  local.set(source, handler);
}

/** Every `emit` on the emitter is also delivered to the same emitter in the other processes. */
export function bridgeEmitter(source: string, emitter: EventEmitter<any>) {
  const emitLocally = emitter.emit.bind(emitter) as (event: string, ...args: unknown[]) => boolean;
  (emitter as { emit: (event: string, ...args: unknown[]) => boolean }).emit = (event, ...args) => {
    publish(source, event, args);
    return emitLocally(event, ...args);
  };
  onRemote(source, (event, args) => emitLocally(event, ...args));
}

export async function joinCluster(shared: Presence) {
  presence = shared;
  await shared.subscribe(CHANNEL, (message: Envelope) => {
    if (!message || message.origin === processTag) return;
    local.get(message.source)?.(message.event, message.args, message.origin);
  });
}
