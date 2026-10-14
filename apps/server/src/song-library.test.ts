import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const { pool } = await import("./database.js");
const { requireStaff } = await import("./safety-service.js");
const { addSong, findSong, listSongs, removeSong, updateSong } = await import("./song-service.js");

const people = ["music", "admin", "moderator"].map((role) => ({ role, id: `lib-${role}-${randomUUID()}` }));
const songs: string[] = [];

beforeAll(async () => {
  for (const person of people) {
    const username = `lib${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    await pool.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt", username, "displayUsername") VALUES ($1, $2, $3, FALSE, NOW(), NOW(), $2, $2)`,
      [person.id, username, `${username}@example.test`],
    );
    await pool.query(`INSERT INTO staff_role (user_id, role, granted_by) VALUES ($1, $2, 'test')`, [person.id, person.role]);
  }
});
afterAll(async () => {
  await pool.query(`DELETE FROM club_song WHERE id = ANY($1)`, [songs]);
  await pool.query(`DELETE FROM "user" WHERE id = ANY($1)`, [people.map((person) => person.id)]);
});

describe("song library", () => {
  it("lets the music role and admins manage songs, but gives the music role no moderation powers", async () => {
    const [music, admin, moderator] = people.map((person) => person.id);
    await expect(requireStaff(music!, "music")).resolves.toBe("music");
    await expect(requireStaff(admin!, "music")).resolves.toBe("admin");
    await expect(requireStaff(moderator!, "music")).rejects.toThrow();
    await expect(requireStaff(music!, "moderator")).rejects.toThrow();
    await expect(requireStaff(music!, "admin")).rejects.toThrow();
    await expect(requireStaff(moderator!, "moderator")).resolves.toBe("moderator");
  });

  it("files songs by where they play, and club requests only see club songs", async () => {
    const audio = Buffer.from("ID3 test");
    const owambe = await addSong({ title: "Owambe Groove", artist: "Test", seconds: 60, venues: ["owambe", "party"], mime: "audio/mpeg", audio }, "test");
    const club = await addSong({ title: "Club Banger", artist: "Test", seconds: 60, venues: ["club"], mime: "audio/mpeg", audio }, "test");
    songs.push(owambe.id, club.id);
    expect((await listSongs("owambe")).map((song) => song.id)).toContain(owambe.id);
    expect((await listSongs("owambe")).map((song) => song.id)).not.toContain(club.id);
    expect(await findSong(owambe.id)).toBeNull();
    expect((await findSong(club.id))?.title).toBe("Club Banger");

    await updateSong(owambe.id, { title: "Owambe Groove (Live)", artist: "Test Band", venues: ["club", "owambe"] });
    expect((await findSong(owambe.id))?.title).toBe("Owambe Groove (Live)");
    expect((await listSongs("party")).map((song) => song.id)).not.toContain(owambe.id);

    await removeSong(club.id);
    expect(await findSong(club.id)).toBeNull();
    await expect(updateSong(club.id, { title: "x", artist: "y", venues: ["club"] })).rejects.toThrow(/library/);
  });
});
