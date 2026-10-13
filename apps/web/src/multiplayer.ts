import { Client, type Room } from "@colyseus/sdk";
import { report } from "./diagnostics";
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
  type RideState,
  type TowState,
  type CheckpointStop,
  type HoldUp,
  type GuardsChase,
  type TripState,
  type FastTravelState,
  type TravelPrompt,
  type AgberoEncounter,
  type AgberoOutcome,
  type ClubMusicState,
  ROBBERY,
} from "@lagos-living/shared";
import { apiUrl, authHeaders } from "./auth-client";

export type MultiplayerStatus =
  | { state: "connecting" }
  | { state: "connected"; sessionId: string }
  | { state: "offline"; reason: string };

export type PoliceEvent =
  | { type: "checkpoint"; stop: CheckpointStop }
  | { type: "checkpointEnd"; checkpointId: string }
  | { type: "holdUp"; holdUp: HoldUp }
  | { type: "holdUpEnd"; robberyId: string }
  | { type: "guardsChase"; chase: GuardsChase };

/** Another player standing at this player's car (or booked cab) asks to ride along. */
export type RideAsk = { sessionId: string; name: string; vehicleId: string; cab: boolean; share: number };

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
  ride: (ride: RideState | null) => void;
  bikeStock: (stock: Record<string, number>) => void;
  /** `replace` carries the full list (on join); otherwise one job changed. */
  tows: (tows: TowState[], replace: boolean) => void;
  police: (event: PoliceEvent) => void;
  trip: (trip: TripState) => void;
  photo: (photo: { spot: string; companions: string[] }) => void;
  react: (reaction: { sessionId: string; emoji: string }) => void;
  goState: (state: FastTravelState) => void;
  travelPrompt: (prompt: TravelPrompt) => void;
  rideAsk: (ask: RideAsk) => void;
  agbero: (encounter: AgberoEncounter | null) => void;
  agberoOutcome: (outcome: AgberoOutcome) => void;
  clubMusic: (state: ClubMusicState) => void;
  /** The owner rearranged the home this player is standing in. */
  interior: () => void;
};

export class MultiplayerConnection {
  private room: Room | undefined;
  private sequence = 0;
  private closed = false;
  private retry: ReturnType<typeof setTimeout> | undefined;

  private connecting = false;

  constructor(private readonly handlers: MultiplayerHandlers) {
    window.addEventListener("online", this.resume);
    document.addEventListener("visibilitychange", this.resume);
  }

  /** After a screen lock, app switch or dropped signal, rejoin at once instead of waiting for the retry timer. */
  private readonly resume = () => {
    if (this.closed || this.room || this.connecting || document.hidden || !navigator.onLine) return;
    clearTimeout(this.retry);
    void this.connect();
  };

  get sessionId() {
    return this.room?.sessionId ?? null;
  }

  async connect() {
    if (this.connecting) return;
    this.connecting = true;
    this.handlers.status({ state: "connecting" });
    try {
      const response = await fetch(`${apiUrl}/api/multiplayer-token`, { method: "POST", credentials: "include", headers: authHeaders() });
      if (!response.ok) throw new Error("Could not authenticate multiplayer");
      const { token, area } = (await response.json()) as { token: string; area?: string };
      if (this.closed) return;
      const client = new Client(apiUrl);
      const room = await client.joinOrCreate("lagos", { token, area: area ?? "lagos" });
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
      room.onMessage("interior", () => this.handlers.interior());
      room.onMessage("ride", (ride: RideState | null) => this.handlers.ride(ride));
      room.onMessage("bikeStock", (stock: Record<string, number>) => this.handlers.bikeStock(stock));
      room.onMessage("bikeReturned", () => undefined);
      room.onMessage("tows", (tows: TowState[]) => Array.isArray(tows) && this.handlers.tows(tows, true));
      room.onMessage("tow", (tow: TowState) => typeof tow?.id === "string" && this.handlers.tows([tow], false));
      room.onMessage("checkpoint", (stop: CheckpointStop) => typeof stop?.checkpointId === "string" && this.handlers.police({ type: "checkpoint", stop }));
      room.onMessage("checkpointEnd", (end: { checkpointId?: unknown }) => this.handlers.police({ type: "checkpointEnd", checkpointId: String(end?.checkpointId ?? "") }));
      room.onMessage("holdUp", (holdUp: HoldUp) => typeof holdUp?.robberyId === "string" && this.handlers.police({ type: "holdUp", holdUp }));
      room.onMessage("holdUpEnd", (end: { robberyId?: unknown }) => this.handlers.police({ type: "holdUpEnd", robberyId: String(end?.robberyId ?? "") }));
      room.onMessage("guardsChase", (chase: GuardsChase) => {
        if (typeof chase?.victimSessionId !== "string" || typeof chase.robberSessionId !== "string") return;
        this.handlers.police({ type: "guardsChase", chase: { ...chase, until: Date.now() + ROBBERY.chaseMs } });
      });
      room.onMessage("trip", (trip: TripState) => typeof trip?.stage === "string" && this.handlers.trip(trip));
      room.onMessage("react", (reaction: { sessionId?: unknown; emoji?: unknown }) =>
        this.handlers.react({ sessionId: String(reaction?.sessionId ?? ""), emoji: String(reaction?.emoji ?? "") }),
      );
      room.onMessage("agbero", (encounter: AgberoEncounter | null) => this.handlers.agbero(encounter && typeof encounter.id === "string" ? encounter : null));
      room.onMessage("clubMusic", (state: ClubMusicState) => typeof state?.club === "string" && Array.isArray(state.queue) && this.handlers.clubMusic(state));
      room.onMessage("agberoOutcome", (outcome: AgberoOutcome) => Array.isArray(outcome?.point) && this.handlers.agberoOutcome(outcome));
      room.onMessage("goState", (state: FastTravelState) => Array.isArray(state?.discovered) && this.handlers.goState(state));
      room.onMessage("rideAsk", (ask: RideAsk) => typeof ask?.sessionId === "string" && typeof ask.name === "string" && this.handlers.rideAsk(ask));
      room.onMessage("travelPrompt", (prompt: TravelPrompt) => typeof prompt?.requestId === "string" && this.handlers.travelPrompt(prompt));
      room.onMessage("photo", (photo: { spot?: unknown; companions?: unknown }) =>
        this.handlers.photo({ spot: String(photo?.spot ?? ""), companions: Array.isArray(photo?.companions) ? photo.companions.map(String) : [] }),
      );
      room.onMessage("suspended", (payload: { reason?: unknown; until?: unknown }) => {
        this.closed = true;
        this.handlers.suspended({ reason: String(payload?.reason ?? ""), until: typeof payload?.until === "string" ? payload.until : null });
      });
      room.onMessage("replaced", () => {
        this.closed = true;
        this.room = undefined;
        this.handlers.status({ state: "offline", reason: "You are playing in another tab or window. Reload this page to play here." });
      });
      room.onLeave((code) => {
        if (this.closed) return;
        this.room = undefined;
        report("disconnect", `Room closed (${code})`, { detail: { code, online: navigator.onLine, hidden: document.hidden } });
        this.handlers.status({ state: "offline", reason: "Connection lost — reconnecting…" });
        this.retry = setTimeout(() => void this.connect(), 3000);
      });
      room.send("requestLooks");
      this.handlers.status({ state: "connected", sessionId: room.sessionId });
    } catch (error) {
      if (this.closed) return;
      this.handlers.status({ state: "offline", reason: error instanceof Error ? error.message : "Multiplayer unavailable" });
      this.retry = setTimeout(() => void this.connect(), 4000);
    } finally {
      this.connecting = false;
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
      | "react"
      | "fastTravel"
      | "agberoAnswer"
      | "songSync"
      | "songRequest"
      | "songDecide"
      | "travelAnswer"
      | "joinRequest"
      | "goState"
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
      | "testDrive"
      | "rideBook"
      | "rideBoard"
      | "rideAsk"
      | "rideAnswer"
      | "rideArrive"
      | "rideCancel"
      | "rideSkip"
      | "rentBike"
      | "returnBike"
      | "towRequest"
      | "estateViewing"
      | "towCancel"
      | "checkpointAnswer"
      | "holdUp"
      | "robberyAnswer"
      | "travelEnter"
      | "travelCounter"
      | "travelTransfer"
      | "activityStart"
      | "carRent"
      | "carReturn"
      | "photo"
      | "requestTrip",
    payload?: unknown,
  ) {
    this.room?.send(type, payload);
  }

  async disconnect() {
    this.closed = true;
    clearTimeout(this.retry);
    window.removeEventListener("online", this.resume);
    document.removeEventListener("visibilitychange", this.resume);
    const room = this.room;
    this.room = undefined;
    if (room) await room.leave();
  }
}
