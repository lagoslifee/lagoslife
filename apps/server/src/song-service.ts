import { randomUUID } from "node:crypto";
import { SONG_REQUEST, type ClubSong, type SongVenue } from "@lagos-living/shared";
import { pool } from "./database.js";
import { creditWallet, debitWallet, EconomyError, ensureWallet, withTransaction } from "./economy-service.js";

const AUDIO_TYPES = new Set(["audio/mpeg", "audio/mp3", "audio/mp4", "audio/aac", "audio/ogg", "audio/wav", "audio/x-wav", "audio/webm", "audio/x-m4a"]);

let cache: { at: number; songs: ClubSong[] } | null = null;

const toSong = (row: Record<string, unknown>): ClubSong => ({
  id: String(row.id),
  title: String(row.title),
  artist: String(row.artist),
  seconds: Number(row.seconds),
  venues: (row.venues as SongVenue[] | null) ?? ["club"],
});

/** Every active song, newest first; `venue` keeps only those that play there. */
export async function listSongs(venue?: SongVenue): Promise<ClubSong[]> {
  if (!cache || Date.now() - cache.at >= 30_000) {
    const { rows } = await pool.query(`SELECT id, title, artist, seconds, venues FROM club_song WHERE active ORDER BY created_at DESC LIMIT 500`);
    cache = { at: Date.now(), songs: rows.map(toSong) };
  }
  return venue ? cache.songs.filter((song) => song.venues.includes(venue)) : cache.songs;
}

/** Club DJs only take requests for songs filed under clubs. */
export async function findSong(id: string) {
  return (await listSongs("club")).find((song) => song.id === id) ?? null;
}

export async function addSong(upload: { title: string; artist: string; seconds: number; venues: SongVenue[]; mime: string; audio: Buffer }, uploadedBy: string) {
  const mime = upload.mime.split(";")[0]!.trim().toLowerCase();
  if (!AUDIO_TYPES.has(mime)) throw new EconomyError("Upload an MP3, M4A, AAC, OGG, WAV or WebM audio file.", 415);
  if (!upload.audio.length) throw new EconomyError("The file is empty.", 400);
  if (upload.audio.length > SONG_REQUEST.maxBytes) throw new EconomyError("Songs can be up to 12 MB.", 413);
  const id = randomUUID();
  await pool.query(`INSERT INTO club_song (id, title, artist, seconds, mime, audio, uploaded_by, venues) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [
    id,
    upload.title,
    upload.artist,
    upload.seconds,
    mime,
    upload.audio,
    uploadedBy,
    upload.venues,
  ]);
  cache = null;
  return { id, title: upload.title, artist: upload.artist, seconds: upload.seconds, venues: upload.venues } satisfies ClubSong;
}

export async function updateSong(id: string, change: { title: string; artist: string; venues: SongVenue[] }) {
  const updated = await pool.query(`UPDATE club_song SET title = $2, artist = $3, venues = $4, updated_at = NOW() WHERE id = $1 AND active`, [id, change.title, change.artist, change.venues]);
  if (!updated.rowCount) throw new EconomyError("That song isn't in the library any more.", 404);
  cache = null;
  return listSongs();
}

export async function removeSong(id: string) {
  await pool.query(`UPDATE club_song SET active = FALSE, updated_at = NOW() WHERE id = $1`, [id]);
  cache = null;
  return listSongs();
}

export async function songAudio(id: string) {
  const { rows } = await pool.query(`SELECT mime, audio FROM club_song WHERE id = $1 AND active`, [id]);
  const row = rows[0];
  return row ? { mime: String(row.mime), audio: row.audio as Buffer } : null;
}

/** Takes the tip once per request id. */
export async function chargeSongRequest(userId: string, requestId: string, song: ClubSong, club: string) {
  return withTransaction(async (client) => {
    await ensureWallet(client, userId);
    return debitWallet(client, userId, SONG_REQUEST.tip, "song_request", `Song request · ${song.title} · ${club}`, `song:${requestId}`, { songId: song.id, club });
  });
}

/** Gives the tip back when the DJ passes on a request or it can't be played. */
export async function refundSongRequest(userId: string, requestId: string, title: string) {
  return withTransaction(async (client) => {
    const done = await client.query(`SELECT 1 FROM game_transaction WHERE user_id = $1 AND idempotency_key = $2`, [userId, `song:${requestId}:refund`]);
    if (done.rowCount) return null;
    return creditWallet(client, userId, SONG_REQUEST.tip, "song_request", `Song request refunded · ${title}`, `song:${requestId}:refund`);
  });
}

/** Residents among `userIds` playing a guest DJ set at this club right now. */
export async function guestDjs(placeId: string, userIds: string[]) {
  if (!userIds.length) return [];
  const { rows } = await pool.query(
    `SELECT user_id FROM gig_run WHERE type_id = 'dj' AND place_id = $1 AND status IN ('travelling', 'working') AND user_id = ANY($2)`,
    [placeId, userIds],
  );
  return rows.map((row) => String(row.user_id));
}
