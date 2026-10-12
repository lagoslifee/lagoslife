import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { GUEST_EMAIL_DOMAIN, isPlaceholderEmail } from "@lagos-living/shared";

const { pool } = await import("./database.js");
const { auth } = await import("./auth.js");
const { accountSummary, claimGuestAccount, getGoals, resetAddress, saveGoals } = await import("./account-service.js");
const { sendMail } = await import("./mailer.js");
const { resetPasswordEmail } = await import("./emails.js");

const tag = randomUUID().replaceAll("-", "").slice(0, 8);
const created: string[] = [];
async function guest() {
  const result = await auth.api.signUpEmail({ body: { email: `guest-${randomUUID()}@${GUEST_EMAIL_DOMAIN}`, password: randomUUID(), name: `Guest ${tag}`, username: `Guest_${randomUUID().slice(0, 6)}` } });
  created.push(result.user.id);
  return result.user.id;
}
afterAll(async () => {
  await pool.query(`DELETE FROM "user" WHERE id = ANY($1)`, [created]);
});

describe("accounts", () => {
  it("turns a guest into a registered resident who can sign in by username, keeping the same account", async () => {
    const id = await guest();
    expect((await accountSummary(id)).guest).toBe(true);
    const summary = await claimGuestAccount(id, { username: `Ada_${tag}`, name: "Ada Obi", password: "LagosLiving!2026" });
    expect(summary).toEqual({ guest: false, username: `Ada_${tag}`, name: "Ada Obi", email: null });
    const signedIn = await auth.api.signInUsername({ body: { username: `ada_${tag}`, password: "LagosLiving!2026" } });
    expect(signedIn?.user.id).toBe(id);
    await expect(claimGuestAccount(id, { username: `Ada2_${tag}`, name: "Ada", password: "LagosLiving!2026" })).rejects.toThrow(/already registered/);
  });

  it("won't take a username someone else has", async () => {
    const first = await guest();
    const second = await guest();
    await claimGuestAccount(first, { username: `Tobi_${tag}`, name: "Tobi", password: "LagosLiving!2026" });
    await expect(claimGuestAccount(second, { username: `TOBI_${tag}`, name: "Tobi", password: "LagosLiving!2026" })).rejects.toThrow(/already in use/);
  });

  it("finds the reset address from a username, and never mails a made-up address", async () => {
    const id = await guest();
    const email = `chi-${tag}@example.test`;
    await claimGuestAccount(id, { username: `Chi_${tag}`, name: "Chi", password: "LagosLiving!2026", email });
    expect(await resetAddress(`@chi_${tag}`)).toBe(email);
    expect(await resetAddress(email.toUpperCase())).toBe(email);
    const silent = await guest();
    await claimGuestAccount(silent, { username: `Kemi_${tag}`, name: "Kemi", password: "LagosLiving!2026" });
    expect(await resetAddress(`kemi_${tag}`)).toBeNull();
    const placeholder = (await pool.query<{ email: string }>(`SELECT email FROM "user" WHERE id = $1`, [silent])).rows[0]!.email;
    expect(isPlaceholderEmail(placeholder)).toBe(true);
    expect(await sendMail({ to: placeholder, subject: "x", html: "x", text: "x" })).toEqual({ sent: false });
  });

  it("builds a reset email with the link in both the button and the plain text, and escapes names", () => {
    const mail = resetPasswordEmail({ to: "a@example.test", name: "<Ada>", username: "ada", url: "https://example.test/reset?token=abc&x=1" });
    expect(mail.html).toContain('href="https://example.test/reset?token=abc&amp;x=1"');
    expect(mail.html).toContain("Hi &lt;Ada&gt;");
    expect(mail.text).toContain("https://example.test/reset?token=abc&x=1");
  });

  it("saves goals and dreams", async () => {
    const id = await guest();
    expect(await getGoals(id)).toBeNull();
    await saveGoals(id, { goals: ["mansion", "fit"], interests: ["cars"], playstyle: "hustle", dream: "A house on the lagoon for my mum", skipped: false });
    expect(await getGoals(id)).toEqual({ goals: ["mansion", "fit"], interests: ["cars"], playstyle: "hustle", dream: "A house on the lagoon for my mum", skipped: false });
  });
});
