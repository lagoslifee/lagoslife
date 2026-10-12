import { betterAuth } from "better-auth";
import { bearer, username } from "better-auth/plugins";
import nodemailer from "nodemailer";
import { config, webOrigins } from "./config.js";
import { pool } from "./database.js";

const mailer = nodemailer.createTransport({
  host: config.SMTP_HOST,
  port: config.SMTP_PORT,
  secure: config.SMTP_SECURE,
  requireTLS: config.NODE_ENV === "production" && !config.SMTP_SECURE,
  auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS ?? "" } : undefined,
});

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
    minPasswordLength: 10,
    sendResetPassword: async ({ user, url }) => {
      await mailer.sendMail({
        from: config.SMTP_FROM,
        to: user.email,
        subject: "Reset your Naija World password",
        text: `Reset your password: ${url}\n\nIf you did not request this, ignore this email.`,
      });
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
