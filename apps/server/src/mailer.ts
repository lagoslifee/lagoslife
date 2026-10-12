import nodemailer from "nodemailer";
import { isPlaceholderEmail } from "@lagos-living/shared";
import { config } from "./config.js";

export type Mail = { to: string; subject: string; html: string; text: string };

const smtp = nodemailer.createTransport({
  host: config.SMTP_HOST,
  port: config.SMTP_PORT,
  secure: config.SMTP_SECURE,
  requireTLS: config.NODE_ENV === "production" && !config.SMTP_SECURE,
  auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS ?? "" } : undefined,
});

/** Sends through Resend when RESEND_API_KEY is set, otherwise SMTP. Accounts without a real address get nothing. */
export async function sendMail(mail: Mail) {
  if (isPlaceholderEmail(mail.to)) return { sent: false as const };
  if (config.RESEND_API_KEY) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${config.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: config.RESEND_FROM, to: [mail.to], subject: mail.subject, html: mail.html, text: mail.text }),
    });
    if (!response.ok) throw new Error(`Resend refused the email (${response.status}): ${(await response.text()).slice(0, 300)}`);
    return { sent: true as const };
  }
  await smtp.sendMail({ from: config.SMTP_FROM, to: mail.to, subject: mail.subject, html: mail.html, text: mail.text });
  return { sent: true as const };
}
