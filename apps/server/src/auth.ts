import { betterAuth } from "better-auth";
import { bearer, username } from "better-auth/plugins";
import { PASSWORD_MIN } from "@lagos-living/shared";
import { config, webOrigins } from "./config.js";
import { pool } from "./database.js";
import { resetPasswordEmail } from "./emails.js";
import { sendMail } from "./mailer.js";

/**
 * The emailed link goes straight to the site's "choose a new password" screen with the token, rather than through
 * this server's own redirect, so it works wherever the API is hosted.
 */
function resetLink(url: string, token: string) {
  const callback = new URL(url).searchParams.get("callbackURL");
  if (!callback || !/^https?:\/\//.test(callback)) return url;
  const link = new URL(callback);
  link.searchParams.set("token", token);
  return link.toString();
}

export const auth = betterAuth({
  appName: "Naija World",
  baseURL: config.BETTER_AUTH_URL,
  secret: config.BETTER_AUTH_SECRET,
  database: pool,
  trustedOrigins: webOrigins,
  // Counters in Postgres keep limits shared across server processes. Enabled only in production (the default).
  rateLimit: { storage: "database" },
  advanced: config.TRUSTED_PROXIES.length > 0 ? { ipAddress: { trustedProxies: config.TRUSTED_PROXIES } } : undefined,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: PASSWORD_MIN,
    resetPasswordTokenExpiresIn: 3_600,
    sendResetPassword: async ({ user, url, token }) => {
      const named = user as typeof user & { displayUsername?: string | null; username?: string | null };
      await sendMail(resetPasswordEmail({ to: user.email, name: user.name, username: named.displayUsername ?? named.username ?? null, url: resetLink(url, token) }));
    },
  },
  plugins: [
    // Lets a web client on another site (where browsers block the session cookie) send the session as a header.
    bearer(),
    username({
      minUsernameLength: 3,
      maxUsernameLength: 20,
    }),
  ],
});
