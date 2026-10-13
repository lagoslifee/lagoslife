/**
 * Creates (or updates) a staff admin account and tops its wallet up to a balance:
 *   ADMIN_USERNAME=admin ADMIN_PASSWORD=... ADMIN_BALANCE=1000000000 DATABASE_URL=... npx tsx src/create-admin.ts
 * The password is set directly, so it bypasses the sign-up minimum length; choose a strong one.
 */
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { NO_EMAIL_DOMAIN } from "@lagos-living/shared";
import { pool } from "./database.js";
import { creditWallet, withTransaction } from "./economy-service.js";

const username = process.env.ADMIN_USERNAME?.trim();
const password = process.env.ADMIN_PASSWORD;
const balance = Number(process.env.ADMIN_BALANCE ?? 0);
if (!username || !password) throw new Error("Set ADMIN_USERNAME and ADMIN_PASSWORD");

const hash = await hashPassword(password);
await withTransaction(async (client) => {
  const existing = await client.query<{ id: string }>(`SELECT id FROM "user" WHERE LOWER(username) = LOWER($1)`, [username]);
  let userId = existing.rows[0]?.id;
  if (!userId) {
    userId = randomUUID().replaceAll("-", "");
    await client.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt", username, "displayUsername")
       VALUES ($1, $2, $3, FALSE, NOW(), NOW(), $4, $2)`,
      [userId, username, `${username.toLowerCase()}@${NO_EMAIL_DOMAIN}`, username.toLowerCase()],
    );
  }
  const updated = await client.query(`UPDATE account SET password = $2, "updatedAt" = NOW() WHERE "userId" = $1 AND "providerId" = 'credential'`, [userId, hash]);
  if (!updated.rowCount) {
    await client.query(
      `INSERT INTO account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt") VALUES ($1, $2, 'credential', $2, $3, NOW(), NOW())`,
      [randomUUID().replaceAll("-", ""), userId, hash],
    );
  }
  await client.query(`INSERT INTO staff_role (user_id, role, granted_by) VALUES ($1, 'admin', 'create-admin') ON CONFLICT (user_id) DO UPDATE SET role = 'admin'`, [userId]);
  await client.query(`INSERT INTO wallet (user_id, balance) VALUES ($1, 0) ON CONFLICT (user_id) DO NOTHING`, [userId]);
  const { rows } = await client.query<{ balance: string }>(`SELECT balance FROM wallet WHERE user_id = $1 FOR UPDATE`, [userId]);
  const missing = balance - Number(rows[0]!.balance);
  if (missing > 0) await creditWallet(client, userId, missing, "admin_grant", "Admin grant", `admin-grant:${randomUUID()}`);
  console.log(`Admin ${username} (${userId}) ready${missing > 0 ? `, wallet topped up by ${missing}` : ""}.`);
});
await pool.end();
