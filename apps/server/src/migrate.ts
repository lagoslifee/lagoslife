import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./database.js";

const directory = join(dirname(fileURLToPath(import.meta.url)), "../migrations");

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_migration (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const applied = new Set(
    (await pool.query<{ name: string }>("SELECT name FROM app_migration")).rows.map(
      ({ name }) => name,
    ),
  );

  for (const name of (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort()) {
    if (applied.has(name)) continue;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(await readFile(join(directory, name), "utf8"));
      await client.query("INSERT INTO app_migration (name) VALUES ($1)", [name]);
      await client.query("COMMIT");
      console.log(`Applied ${name}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
} finally {
  await pool.end();
}
