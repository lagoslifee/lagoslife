import { SONG_REQUEST, type ClubMusicState } from "@lagos-living/shared";
import { describe, expect, it, vi } from "vitest";
import { ClubJukebox } from "./club-jukebox.js";

const CLUB = "club:eko-nights#1";
const song = { id: "song-1", title: "Lagos Love", artist: "Test Artist", seconds: 60, venues: ["club"] as ("club" | "owambe" | "party")[] };

function setup(options: { guest?: string } = {}) {
  const seen = new Map<string, ClubMusicState>();
  const here = [
    { userId: "ada", name: "Ada" },
    { userId: "bayo", name: "Bayo" },
  ];
  const deps = {
    listeners: vi.fn((club: string) => (club === CLUB ? here.map((entry) => ({ ...entry, send: (state: ClubMusicState) => seen.set(entry.userId, state) })) : [])),
    findSong: vi.fn(async (id: string) => (id === song.id ? song : null)),
    charge: vi.fn(async () => 1_000),
    refund: vi.fn(async () => 3_000),
    guestDjs: vi.fn(async () => (options.guest ? [options.guest] : [])),
    notify: vi.fn(),
  };
  return { jukebox: new ClubJukebox(deps), deps, seen, here };
}

describe("ClubJukebox", () => {
  it("charges a tip, lets the house DJ approve it, and plays it for everyone in the club", async () => {
    const { jukebox, deps, seen } = setup();
    const now = 1_000_000;
    await jukebox.request(CLUB, { userId: "ada", name: "Ada" }, song.id, now);
    expect(deps.charge).toHaveBeenCalledTimes(1);
    expect(seen.get("bayo")?.queue[0]).toMatchObject({ title: "Lagos Love", status: "pending", mine: false });
    expect(seen.get("ada")?.queue[0]?.mine).toBe(true);
    await jukebox.tick(now + SONG_REQUEST.houseDjMs + 1);
    expect(seen.get("bayo")?.playing).toMatchObject({ songId: song.id, startedAt: now + SONG_REQUEST.houseDjMs + 1 + SONG_REQUEST.leadInMs });
    await jukebox.tick(now + SONG_REQUEST.houseDjMs + 1 + SONG_REQUEST.leadInMs + song.seconds * 1000 + 1);
    expect(seen.get("bayo")?.playing).toBeNull();
    expect(deps.refund).not.toHaveBeenCalled();
  });

  it("sends requests to the guest DJ, who can pass on one and refund it; only they can decide", async () => {
    const { jukebox, deps, seen } = setup({ guest: "bayo" });
    await jukebox.request(CLUB, { userId: "ada", name: "Ada" }, song.id);
    const state = seen.get("bayo")!;
    expect(state.dj).toMatchObject({ name: "Bayo", you: true, guest: true });
    const requestId = state.queue[0]!.id;
    await jukebox.decide(CLUB, "ada", requestId, true);
    expect(seen.get("ada")?.queue[0]?.status).toBe("pending");
    await jukebox.decide(CLUB, "bayo", requestId, false);
    expect(seen.get("ada")?.queue).toHaveLength(0);
    expect(deps.refund).toHaveBeenCalledWith("ada", requestId, song.title);
  });

  it("keeps one request per resident, refuses unknown songs, and refunds the queue when everyone leaves", async () => {
    const { jukebox, deps, here } = setup();
    await jukebox.request(CLUB, { userId: "ada", name: "Ada" }, song.id);
    await jukebox.request(CLUB, { userId: "ada", name: "Ada" }, song.id);
    await jukebox.request(CLUB, { userId: "bayo", name: "Bayo" }, "missing");
    expect(deps.charge).toHaveBeenCalledTimes(1);
    here.length = 0;
    await jukebox.tick();
    expect(deps.refund).toHaveBeenCalledTimes(1);
  });
});
