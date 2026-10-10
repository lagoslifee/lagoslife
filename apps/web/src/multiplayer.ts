import { Client, type Room } from "@colyseus/sdk";
import {
  chatMessageSchema,
  type ChatMessage,
  lookSchema,
  looksSchema,
  type Look,
  noticeSchema,
  positionUpdateSchema,
  selfStateSchema,
  worldSnapshotSchema,
  type MotionState,
  type Notice,
  type SelfState,
  type WorldSnapshot,
} from "@lagos-living/shared";
import { apiUrl, authHeaders } from "./auth-client";

export type MultiplayerStatus =
  | { state: "connecting" }
  | { state: "connected"; sessionId: string }
  | { state: "offline"; reason: string };

export type MultiplayerHandlers = {
  snapshot: (snapshot: WorldSnapshot, ownSessionId: string) => void;
  self: (self: SelfState) => void;
  notice: (notice: Notice) => void;
  correction: (point: { x: number; z: number }) => void;
  saved: (at: number) => void;
  status: (status: MultiplayerStatus) => void;
  vehicleStatus: (status: { vehicleId: string; condition: number; damage?: number }) => void;
  horn: (at: { x: number; z: number }) => void;
  chat: (message: ChatMessage) => void;
  suspended: (info: { reason: string; until: string | null }) => void;
  looks: (looks: Look[]) => void;
  plots: () => void;
};

export class MultiplayerConnection {
  private room: Room | undefined;
  private sequence = 0;
  private closed = false;
  private retry: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly handlers: MultiplayerHandlers) {}

  get sessionId() {
    return this.room?.sessionId ?? null;
  }

  async connect() {
    this.handlers.status({ state: "connecting" });
    try {
      const response = await fetch(`${apiUrl}/api/multiplayer-token`, { method: "POST", credentials: "include", headers: authHeaders() });
      if (!response.ok) throw new Error("Could not authenticate multiplayer");
      const { token } = (await response.json()) as { token: string };
      if (this.closed) return;
      const client = new Client(apiUrl);
      const room = await client.joinOrCreate("lagos", { token });
      if (this.closed) {
        await room.leave();
        return;
      }
      this.room = room;
      room.onMessage("snapshot", (payload: unknown) => {
        const parsed = worldSnapshotSchema.safeParse(payload);
        if (parsed.success) this.handlers.snapshot(parsed.data, room.sessionId);
      });
      room.onMessage("self", (payload: unknown) => {
        const parsed = selfStateSchema.safeParse(payload);
        if (parsed.success) this.handlers.self(parsed.data);
      });
      room.onMessage("notice", (payload: unknown) => {
        const parsed = noticeSchema.safeParse(payload);
        if (parsed.success) this.handlers.notice(parsed.data);
      });
      room.onMessage("correction", (payload: { x: number; z: number }) => {
        if (Number.isFinite(payload?.x) && Number.isFinite(payload?.z)) this.handlers.correction(payload);
      });
      room.onMessage("saved", (payload: { at: number }) => this.handlers.saved(payload?.at ?? Date.now()));
      room.onMessage("vehicleStatus", (payload: { vehicleId: string; condition: number; damage?: number }) => {
        if (typeof payload?.vehicleId === "string" && Number.isFinite(payload.condition)) this.handlers.vehicleStatus(payload);
      });
      room.onMessage("horn", (payload: { x: number; z: number }) => {
        if (Number.isFinite(payload?.x) && Number.isFinite(payload?.z)) this.handlers.horn(payload);
      });
      room.onMessage("chat", (payload: unknown) => {
        const parsed = chatMessageSchema.safeParse(payload);
        if (parsed.success) this.handlers.chat(parsed.data);
      });
      room.onMessage("look", (payload: unknown) => {
        const parsed = lookSchema.safeParse(payload);
        if (parsed.success) this.handlers.looks([parsed.data]);
      });
      room.onMessage("looks", (payload: unknown) => {
        const parsed = looksSchema.safeParse(payload);
        if (parsed.success) this.handlers.looks(parsed.data);
      });
      room.onMessage("plots", () => this.handlers.plots());
      room.onMessage("suspended", (payload: { reason?: unknown; until?: unknown }) => {
        this.closed = true;
        this.handlers.suspended({ reason: String(payload?.reason ?? ""), until: typeof payload?.until === "string" ? payload.until : null });
      });
      room.onMessage("replaced", () => {
        this.closed = true;
        this.room = undefined;
        this.handlers.status({ state: "offline", reason: "You are playing in another tab or window. Reload this page to play here." });
      });
      room.onLeave(() => {
        if (this.closed) return;
        this.room = undefined;
        this.handlers.status({ state: "offline", reason: "Connection lost — reconnecting…" });
        this.retry = setTimeout(() => void this.connect(), 3000);
      });
      room.send("requestLooks");
      this.handlers.status({ state: "connected", sessionId: room.sessionId });
    } catch (error) {
      if (this.closed) return;
      this.handlers.status({ state: "offline", reason: error instanceof Error ? error.message : "Multiplayer unavailable" });
      this.retry = setTimeout(() => void this.connect(), 4000);
    }
  }

  sendPosition(x: number, z: number, yaw: number, motion: MotionState) {
    if (!this.room) return;
    const payload = positionUpdateSchema.parse({ sequence: this.sequence++, x, z, yaw: Math.atan2(Math.sin(yaw), Math.cos(yaw)), motion });
    this.room.send("position", payload);
  }

  sendChat(text: string) {
    this.room?.send("chat", { text });
    return Boolean(this.room);
  }

  send(
    type:
      | "board"
      | "alight"
      | "requestStop"
      | "enterProperty"
      | "exitProperty"
      | "unstuck"
      | "emote"
      | "carrying"
      | "enterVehicle"
      | "exitVehicle"
      | "vehicleImpact"
      | "vehicleSignal"
      | "testDrive",
    payload?: unknown,
  ) {
    this.room?.send(type, payload);
  }

  async disconnect() {
    this.closed = true;
    clearTimeout(this.retry);
    const room = this.room;
    this.room = undefined;
    if (room) await room.leave();
  }
}
