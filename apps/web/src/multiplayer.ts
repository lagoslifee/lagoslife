import { Client, type Room } from "@colyseus/sdk";
import {
  movementInputSchema,
  worldSnapshotSchema,
  type MovementInput,
  type WorldSnapshot,
} from "@lagos-living/shared";
import { apiUrl } from "./auth-client";

export type MultiplayerStatus =
  | { state: "connecting" }
  | { state: "connected"; sessionId: string }
  | { state: "offline"; reason: string };

export class MultiplayerConnection {
  private room: Room | undefined;
  private sequence = 0;
  private closed = false;

  constructor(
    private readonly onSnapshot: (snapshot: WorldSnapshot, ownSessionId: string) => void,
    private readonly onStatus: (status: MultiplayerStatus) => void,
  ) {}

  async connect() {
    this.onStatus({ state: "connecting" });
    try {
      const response = await fetch(`${apiUrl}/api/multiplayer-token`, {
        method: "POST",
        credentials: "include",
      });
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
        if (parsed.success) this.onSnapshot(parsed.data, room.sessionId);
      });
      room.onLeave(() => {
        if (!this.closed) this.onStatus({ state: "offline", reason: "Disconnected" });
      });
      this.onStatus({ state: "connected", sessionId: room.sessionId });
    } catch (error) {
      if (!this.closed) {
        this.onStatus({
          state: "offline",
          reason: error instanceof Error ? error.message : "Multiplayer unavailable",
        });
      }
    }
  }

  send(input: Omit<MovementInput, "sequence">) {
    if (!this.room) return;
    const payload = movementInputSchema.parse({ ...input, sequence: this.sequence++ });
    this.room.send("input", payload);
  }

  async disconnect() {
    this.closed = true;
    const room = this.room;
    this.room = undefined;
    if (room) await room.leave();
  }
}
