import { hashPassword } from "better-auth/crypto";
import { isGuestEmail, isPlaceholderEmail, NO_EMAIL_DOMAIN, type AccountSummary, type ClaimAccount, type LifeGoals } from "@lagos-living/shared";
import { randomBytes } from "node:crypto";
import { pool } from "./database.js";
import { EconomyError, withTransaction } from "./economy-service.js";

type UserRow = { email: string; name: string; username: string | null; displayUsername: string | null };

export async function accountSummary(userId: string): Promise<AccountSummary> {
  const { rows } = await pool.query<UserRow>(`SELECT email, name, username, "displayUsername" FROM "user" WHERE id = $1`, [userId]);
  const user = rows[0];
  if (!user) throw new EconomyError("Account not found", 404);
  return { guest: isGuestEmail(user.email), username: user.displayUsername ?? user.username ?? "", name: user.name, email: isPlaceholderEmail(user.email) ? null : user.email };
}

/**
 * Turns the guest account you are playing on into a real one (username, name, password, optional email), keeping
 * everything it owns. The session stays signed in.
 */
export async function claimGuestAccount(userId: string, input: ClaimAccount) {
  const email = input.email?.toLowerCase() ?? `${input.username.toLowerCase()}.${randomBytes(4).toString("hex")}@${NO_EMAIL_DOMAIN}`;
  const hash = await hashPassword(input.password);
  await withTransaction(async (client) => {
    const { rows } = await client.query<UserRow>(`SELECT email FROM "user" WHERE id = $1 FOR UPDATE`, [userId]);
    if (!rows[0]) throw new EconomyError("Account not found", 404);
    if (!isGuestEmail(rows[0].email)) throw new EconomyError("This account is already registered.", 409);
    const taken = await client.query(`SELECT 1 FROM "user" WHERE id <> $1 AND (username = $2 OR email = $3) LIMIT 1`, [userId, input.username.toLowerCase(), email]);
    if (taken.rowCount) throw new EconomyError("That username or email is already in use. Try another.", 409);
    await client.query(`UPDATE "user" SET name = $2, username = $3, "displayUsername" = $4, email = $5, "emailVerified" = false, "updatedAt" = NOW() WHERE id = $1`, [
      userId,
      input.name,
      input.username.toLowerCase(),
      input.username,
      email,
    ]);
    const updated = await client.query(`UPDATE account SET password = $2, "updatedAt" = NOW() WHERE "userId" = $1 AND "providerId" = 'credential'`, [userId, hash]);
    if (!updated.rowCount) throw new EconomyError("This account can't take a password.", 409);
  });
  return accountSummary(userId);
}

/** The email to send a reset link to, from a username or an email; null when there is no real address. */
export async function resetAddress(identifier: string) {
  const key = identifier.trim().toLowerCase().replace(/^@/, "");
  const { rows } = await pool.query<{ email: string }>(`SELECT email FROM "user" WHERE username = $1 OR email = $1 LIMIT 1`, [key]);
  const email = rows[0]?.email;
  return email && !isPlaceholderEmail(email) ? email : null;
}

export async function getGoals(userId: string): Promise<LifeGoals | null> {
  const { rows } = await pool.query<LifeGoals>(`SELECT goals, interests, playstyle, dream, skipped FROM player_goals WHERE user_id = $1`, [userId]);
  return rows[0] ?? null;
}

export async function saveGoals(userId: string, goals: LifeGoals) {
  await pool.query(
    `INSERT INTO player_goals (user_id, goals, interests, playstyle, dream, skipped) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id) DO UPDATE SET goals = $2, interests = $3, playstyle = $4, dream = $5, skipped = $6, updated_at = NOW()`,
    [userId, goals.goals, goals.interests, goals.playstyle, goals.dream, goals.skipped],
  );
  return goals;
}
