import { randomUUID } from "node:crypto";
import { CLUBS, SONG_REQUEST, type ClubMusicState, type ClubSong, type Notice } from "@lagos-living/shared";

type Listener = { userId: string; name: string; send: (state: ClubMusicState) => void };
type Entry = ClubSong & { requestId: string; songId: string; userId: string; byName: string; status: "pending" | "approved"; decideAt: number; dj: string | null };
type Booth = { playing: (Entry & { startedAt: number }) | null; queue: Entry[]; guest: { userId: string; name: string } | null };

export type JukeboxDeps = {
  /** Residents in this club instance right now. */
  listeners: (club: string) => Listener[];
  findSong: (songId: string) => Promise<ClubSong | null>;
  charge: (userId: string, requestId: string, song: ClubSong, club: string) => Promise<unknown>;
  refund: (userId: string, requestId: string, title: string) => Promise<unknown>;
  guestDjs: (placeId: string, userIds: string[]) => Promise<string[]>;
  notify: (userId: string, notice: Notice) => void;
};

/** `club:eko-nights#2` → `eko-nights`. */
export const clubPlace = (club: string) => club.slice(5).split("#")[0]!;

/**
 * Song requests per club instance: a resident tips to request an uploaded song, the guest DJ on a set (or the house
 * DJ, after a short look) approves or declines, and approved songs play in order for everyone in that club. Declined
 * and unplayable requests are refunded.
 */
export class ClubJukebox {
  private booths = new Map<string, Booth>();

  constructor(private readonly deps: JukeboxDeps) {}

  private booth(club: string) {
    let booth = this.booths.get(club);
    if (!booth) {
      booth = { playing: null, queue: [], guest: null };
      this.booths.set(club, booth);
    }
    return booth;
  }

  private houseDj(club: string) {
    return CLUBS[clubPlace(club)]?.dj ?? "The DJ";
  }

  view(club: string, userId: string): ClubMusicState {
    const booth = this.booth(club);
    const shown = (entry: Entry) => ({ id: entry.requestId, songId: entry.songId, title: entry.title, artist: entry.artist, seconds: entry.seconds, byName: entry.byName, mine: entry.userId === userId });
    return {
      club,
      playing: booth.playing ? { ...shown(booth.playing), startedAt: booth.playing.startedAt } : null,
      queue: booth.queue.map((entry) => ({ ...shown(entry), status: entry.status })),
      dj: booth.guest ? { name: booth.guest.name, you: booth.guest.userId === userId, guest: true } : { name: this.houseDj(club), you: false, guest: false },
    };
  }

  private publish(club: string) {
    for (const listener of this.deps.listeners(club)) listener.send(this.view(club, listener.userId));
  }

  sync(club: string, userId: string) {
    const listener = this.deps.listeners(club).find((entry) => entry.userId === userId);
    listener?.send(this.view(club, userId));
  }

  private async refreshGuest(club: string) {
    const booth = this.booth(club);
    const here = this.deps.listeners(club);
    const djs: string[] = await this.deps.guestDjs(clubPlace(club), here.map((entry) => entry.userId)).catch(() => []);
    const guest = here.find((entry) => djs.includes(entry.userId));
    booth.guest = guest ? { userId: guest.userId, name: guest.name } : null;
  }

  async request(club: string, user: { userId: string; name: string }, songId: string, now = Date.now()) {
    const say = (tone: Notice["tone"], text: string) => this.deps.notify(user.userId, { tone, text });
    if (!CLUBS[clubPlace(club)]) return say("error", "Song requests are taken inside the clubs.");
    const booth = this.booth(club);
    if (booth.queue.length >= SONG_REQUEST.maxQueue) return say("error", "The DJ's list is full. Try again after a couple of songs.");
    const mine = booth.queue.filter((entry) => entry.userId === user.userId).length;
    if (mine >= SONG_REQUEST.perResident) return say("error", "You already have a song on the DJ's list.");
    const song = await this.deps.findSong(songId);
    if (!song) return say("error", "That song isn't available any more.");
    const requestId = randomUUID();
    try {
      await this.deps.charge(user.userId, requestId, song, CLUBS[clubPlace(club)]?.dj ?? club);
    } catch (error) {
      return say("error", error instanceof Error ? error.message : "The tip could not be paid.");
    }
    await this.refreshGuest(club);
    const guest = booth.guest && booth.guest.userId !== user.userId ? booth.guest : null;
    booth.queue.push({ ...song, requestId, songId: song.id, userId: user.userId, byName: user.name, status: "pending", decideAt: now + (guest ? SONG_REQUEST.guestDjMs : SONG_REQUEST.houseDjMs), dj: guest?.userId ?? null });
    say("success", guest ? `Request sent to ${guest.name} on the decks.` : `${this.houseDj(club)} is checking your request…`);
    if (guest) this.deps.notify(guest.userId, { tone: "info", text: `🎧 ${user.name} requested "${song.title}". Approve or pass in the DJ booth card.` });
    this.publish(club);
  }

  async decide(club: string, userId: string, requestId: string, approve: boolean) {
    const booth = this.booth(club);
    const entry = booth.queue.find((item) => item.requestId === requestId && item.status === "pending");
    if (!entry || !booth.guest || booth.guest.userId !== userId || entry.dj !== userId) return;
    await this.settle(club, entry, approve, booth.guest.name);
  }

  private async settle(club: string, entry: Entry, approve: boolean, by: string) {
    const booth = this.booth(club);
    if (approve) {
      entry.status = "approved";
      this.deps.notify(entry.userId, { tone: "success", text: `${by} approved "${entry.title}". It plays after the songs ahead of it.` });
    } else {
      booth.queue = booth.queue.filter((item) => item !== entry);
      await this.deps.refund(entry.userId, entry.requestId, entry.title).catch((error) => console.error("Song refund failed", error));
      this.deps.notify(entry.userId, { tone: "info", text: `${by} passed on "${entry.title}". Your tip was refunded.` });
    }
    this.publish(club);
  }

  async tick(now = Date.now()) {
    for (const [club, booth] of this.booths) {
      const here = this.deps.listeners(club);
      if (!here.length) {
        for (const entry of booth.queue) await this.deps.refund(entry.userId, entry.requestId, entry.title).catch(() => undefined);
        this.booths.delete(club);
        continue;
      }
      for (const entry of booth.queue.filter((item) => item.status === "pending" && item.decideAt <= now)) {
        const left = !here.some((listener) => listener.userId === entry.userId);
        await this.settle(club, entry, !left, this.houseDj(club));
      }
      const playingEnds = booth.playing ? booth.playing.startedAt + booth.playing.seconds * 1000 : 0;
      if (booth.playing && playingEnds > now) continue;
      const changed = Boolean(booth.playing);
      booth.playing = null;
      const next = booth.queue.find((entry) => entry.status === "approved");
      if (next) {
        booth.queue = booth.queue.filter((entry) => entry !== next);
        booth.playing = { ...next, startedAt: now + SONG_REQUEST.leadInMs };
      }
      if (changed || next) this.publish(club);
    }
  }
}
