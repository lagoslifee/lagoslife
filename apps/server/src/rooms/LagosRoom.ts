import { movementInputSchema, type MovementInput, type WorldSnapshot } from "@lagos-living/shared";
import { Client, Room, type AuthContext } from "@colyseus/core";
import { schema, t, type SchemaType } from "@colyseus/schema";
import { verifyMultiplayerToken, type MultiplayerIdentity } from "../multiplayer-token.js";
import { removePlayerPosition, setPlayerPosition } from "../player-presence.js";

export const NetworkPlayerState = schema({
  userId: t.string(),
  name: t.string(),
  x: t.float32().default(-10),
  z: t.float32().default(0),
  yaw: t.float32().default(0),
  speed: t.float32().default(0),
  motion: t.string().default("idle"),
  connected: t.boolean().default(true),
});
export type NetworkPlayerState = SchemaType<typeof NetworkPlayerState>;

export const LagosState = schema({
  tick: t.uint32().default(0),
  players: t.map(NetworkPlayerState),
});
export type LagosState = SchemaType<typeof LagosState>;

type LagosClient = Client & { auth: MultiplayerIdentity };

const idleInput: MovementInput = {
  sequence: 0,
  forward: 0,
  right: 0,
  run: false,
  yaw: 0,
};

export class LagosRoom extends Room<{ state: LagosState; client: LagosClient }> {
  maxClients = 32;
  state = new LagosState();
  private latestInputs = new Map<string, MovementInput>();
  private lastSequences = new Map<string, number>();
  private rates = new Map<string, { since: number; count: number }>();

  onAuth(_client: LagosClient, options: { token?: unknown }, _context: AuthContext) {
    return verifyMultiplayerToken(options.token);
  }

  onCreate() {
    this.setPatchRate(50);
    this.onMessage("input", (client, payload) => {
      const now = Date.now();
      const rate = this.rates.get(client.sessionId) ?? { since: now, count: 0 };
      if (now - rate.since >= 1_000) {
        rate.since = now;
        rate.count = 0;
      }
      rate.count += 1;
      this.rates.set(client.sessionId, rate);
      if (rate.count > 40) return;

      const parsed = movementInputSchema.safeParse(payload);
      if (!parsed.success) return;
      const previous = this.lastSequences.get(client.sessionId) ?? -1;
      if (parsed.data.sequence <= previous) return;
      this.lastSequences.set(client.sessionId, parsed.data.sequence);
      this.latestInputs.set(client.sessionId, parsed.data);
    });

    this.setFixedTimestep(({ dt }) => {
      this.state.tick = (this.state.tick + 1) >>> 0;
      for (const [sessionId, player] of this.state.players) {
        const input = this.latestInputs.get(sessionId) ?? idleInput;
        const magnitude = Math.min(1, Math.hypot(input.forward, input.right));
        const targetSpeed = magnitude === 0 ? 0 : input.run ? 6.1 : 3.15;
        const response = targetSpeed > player.speed ? 8.5 : 11.5;
        player.speed += (targetSpeed - player.speed) * (1 - Math.exp(-response * dt));
        if (player.speed < 0.025) player.speed = 0;
        player.yaw = input.yaw;

        if (magnitude > 0) {
          const forward = input.forward / magnitude;
          const right = input.right / magnitude;
          const dx = Math.sin(input.yaw) * forward + Math.cos(input.yaw) * right;
          const dz = Math.cos(input.yaw) * forward - Math.sin(input.yaw) * right;
          player.x = Math.max(-90, Math.min(90, player.x + dx * player.speed * dt));
          player.z = Math.max(-60, Math.min(60, player.z + dz * player.speed * dt));
        }
        player.motion = player.speed > 4 ? "run" : player.speed > 0.2 ? "walk" : "idle";
        setPlayerPosition(player.userId, player.x, player.z);
      }

      if (this.state.tick % 3 === 0) this.broadcastSnapshot();
    }, 30);
  }

  onJoin(client: LagosClient) {
    const player = new NetworkPlayerState();
    player.userId = client.auth.userId;
    player.name = client.auth.name;
    this.state.players.set(client.sessionId, player);
    setPlayerPosition(player.userId, player.x, player.z);
    this.broadcastSnapshot();
  }

  async onLeave(client: LagosClient) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    player.connected = false;
    this.latestInputs.delete(client.sessionId);
    try {
      await this.allowReconnection(client, 10);
      player.connected = true;
    } catch {
      this.state.players.delete(client.sessionId);
      removePlayerPosition(player.userId);
      this.lastSequences.delete(client.sessionId);
      this.rates.delete(client.sessionId);
      this.broadcastSnapshot();
    }
  }

  private broadcastSnapshot() {
    const snapshot: WorldSnapshot = {
      tick: this.state.tick,
      players: [...this.state.players].map(([sessionId, player]) => ({
        sessionId,
        name: player.name,
        x: player.x,
        z: player.z,
        yaw: player.yaw,
        speed: player.speed,
        motion: player.motion as "idle" | "walk" | "run",
        connected: player.connected,
      })),
    };
    this.broadcast("snapshot", snapshot);
  }
}
