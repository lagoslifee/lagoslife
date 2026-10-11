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
