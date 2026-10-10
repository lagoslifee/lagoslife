import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins";
import nodemailer from "nodemailer";
import { config } from "./config.js";
import { pool } from "./database.js";

const mailer = nodemailer.createTransport({
  host: config.SMTP_HOST,
  port: config.SMTP_PORT,
  secure: false,
});

export const auth = betterAuth({
  appName: "Lagos Living",
  baseURL: config.BETTER_AUTH_URL,
  secret: config.BETTER_AUTH_SECRET,
  database: pool,
  trustedOrigins: [config.WEB_ORIGIN],
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    sendResetPassword: async ({ user, url }) => {
      await mailer.sendMail({
        from: config.SMTP_FROM,
        to: user.email,
        subject: "Reset your Lagos Living password",
        text: `Reset your password: ${url}\n\nIf you did not request this, ignore this email.`,
      });
    },
  },
  plugins: [
    username({
      minUsernameLength: 3,
      maxUsernameLength: 20,
    }),
  ],
});
