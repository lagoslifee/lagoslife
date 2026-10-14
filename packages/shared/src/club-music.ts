import { z } from "zod";

/**
 * The DJ's set: official music videos from the artists' own YouTube channels, played through YouTube's embedded
 * player (the game never hosts or streams the audio itself). Every resident in a club hears the same track at the
 * same point because the position is derived from the clock.
 */
export type ClubTrack = { videoId: string; artist: string; title: string };

export const CLUB_TRACKS: ClubTrack[] = [
  { videoId: "jipQpjUA_o8", artist: "Wizkid ft. Tems", title: "Essence" },
  { videoId: "421w1j87fEM", artist: "Burna Boy", title: "Last Last" },
  { videoId: "OSBan_sH_b8", artist: "Davido ft. Musa Keys", title: "Unavailable" },
  { videoId: "bbVZo4Yw7pI", artist: "Asake", title: "Lonely At The Top" },
  { videoId: "WcIcVapfqXw", artist: "Rema & Selena Gomez", title: "Calm Down" },
  { videoId: "Pu69SyqwPGg", artist: "Olamide ft. Omah Lay", title: "Infinity" },
  { videoId: "FCUk7rIBBAE", artist: "Wizkid", title: "Joro" },
  { videoId: "lPe09eE6Xio", artist: "Burna Boy", title: "Ye" },
  { videoId: "3Iyuym-Gci0", artist: "Davido", title: "Fall" },
  { videoId: "qrIP_igi76U", artist: "Asake", title: "Terminator" },
  { videoId: "dNt1QR1ecuM", artist: "Rema", title: "Charm" },
  { videoId: "6WkxiF7nnjY", artist: "Olamide", title: "Rock" },
  { videoId: "Ecl8Aod0Tl0", artist: "Burna Boy", title: "On The Low" },
  { videoId: "fXl5dPuiJa0", artist: "Asake", title: "Joha" },
  { videoId: "helEv0kGHd4", artist: "Davido", title: "If" },
  { videoId: "DR5dPcoIjOQ", artist: "Olamide", title: "Motigbana" },
  { videoId: "nrTkERuwdCc", artist: "Rema", title: "Soundgasm" },
];

/** Every track gets this long a slot; shorter tracks leave a short gap before the next one. */
export const CLUB_TRACK_SLOT_SECONDS = 180;

/** What a club's DJ is playing at `at` (ms), and how far into it. Clubs start at different points in the set. */
export function clubNowPlaying(clubId: string, at: number) {
  let offset = 0;
  for (const char of clubId) offset = (offset * 31 + char.charCodeAt(0)) % CLUB_TRACKS.length;
  const slot = Math.floor(at / 1000 / CLUB_TRACK_SLOT_SECONDS);
  const index = (slot + offset) % CLUB_TRACKS.length;
  return { index, track: CLUB_TRACKS[index]!, seconds: Math.floor((at / 1000) % CLUB_TRACK_SLOT_SECONDS), slotEndsAt: (slot + 1) * CLUB_TRACK_SLOT_SECONDS * 1000 };
}

/**
 * Songs the admin uploads for the clubs. Residents in a club pay a small tip to request one; the guest DJ on a set
 * approves or declines, and with no guest DJ the house DJ approves it after a short look. Approved songs play for
 * everyone in that club, in order, before the DJ's set carries on.
 */
export const SONG_REQUEST = {
  tip: 2_000,
  /** Requests waiting or approved per club. */
  maxQueue: 6,
  /** One request per resident at a time. */
  perResident: 1,
  houseDjMs: 7_000,
  /** A guest DJ who doesn't answer in this long gets the house DJ to decide. */
  guestDjMs: 45_000,
  /** Gap between songs, so the next one starts in step everywhere. */
  leadInMs: 1_500,
  minSeconds: 20,
  maxSeconds: 480,
  maxBytes: 12 * 1024 * 1024,
} as const;

/** Where a song can play: club DJs' request lists, owambe parties, and house parties. */
export const SONG_VENUES = ["club", "owambe", "party"] as const;
export type SongVenue = (typeof SONG_VENUES)[number];
export const SONG_VENUE_LABEL: Record<SongVenue, string> = { club: "Clubs (requests)", owambe: "Owambe parties", party: "House parties" };

export type ClubSong = { id: string; title: string; artist: string; seconds: number; venues: SongVenue[] };

export type SongRequestView = { id: string; songId: string; title: string; artist: string; seconds: number; byName: string; mine: boolean; status: "pending" | "approved" };

/** What a club's crowd sees: the requested song playing now (if any), the queue, and who is on the decks. */
export type ClubMusicState = {
  club: string;
  playing: (Omit<SongRequestView, "status"> & { startedAt: number }) | null;
  queue: SongRequestView[];
  dj: { name: string; you: boolean; guest: boolean };
};

export const songRequestSchema = z.object({ songId: z.string().min(1).max(64) });
export const songDecisionSchema = z.object({ requestId: z.string().min(1).max(64), approve: z.boolean() });
const venuesField = z
  .union([z.string(), z.array(z.string())])
  .transform((value) => [...new Set((Array.isArray(value) ? value : value.split(",")).map((entry) => entry.trim()).filter(Boolean))])
  .pipe(z.array(z.enum(SONG_VENUES)).min(1, "Pick at least one place for the song to play"));
export const songUploadSchema = z.object({
  title: z.string().trim().min(1).max(80),
  artist: z.string().trim().min(1).max(80),
  seconds: z.coerce.number().int().min(SONG_REQUEST.minSeconds).max(SONG_REQUEST.maxSeconds),
  venues: venuesField.default(["club"]),
});
export const songUpdateSchema = z.object({
  title: z.string().trim().min(1).max(80),
  artist: z.string().trim().min(1).max(80),
  venues: venuesField,
});
