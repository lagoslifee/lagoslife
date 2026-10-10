import { describe, expect, it } from "vitest";
import { createMultiplayerToken, verifyMultiplayerToken } from "./multiplayer-token.js";

describe("multiplayer join tokens", () => {
  it("round-trips a short-lived server-issued identity", () => {
    const token = createMultiplayerToken({ userId: "user-1", name: "IslandRunner" });
    expect(verifyMultiplayerToken(token)).toMatchObject({
      userId: "user-1",
      name: "IslandRunner",
    });
  });

  it("rejects a modified signature", () => {
    const token = createMultiplayerToken({ userId: "user-1", name: "IslandRunner" });
    expect(verifyMultiplayerToken(`${token.slice(0, -1)}x`)).toBeNull();
  });
});
