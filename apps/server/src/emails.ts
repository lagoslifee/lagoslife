import type { Mail } from "./mailer.js";

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

/**
 * Email layout: table-based with inline styles so it renders the same in Gmail, Outlook and phone mail apps. The logo
 * is drawn in HTML (no image) so it shows even when images are blocked.
 */
function layout(preheader: string, body: string) {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Naija World</title></head>
<body style="margin:0;padding:0;background:#eef2ef;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escape(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2ef;padding:28px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:18px;overflow:hidden;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;color:#13201e;">
<tr><td style="background:#0b2825;background-image:linear-gradient(135deg,#0b2825 0%,#0f3b35 60%,#13564b 100%);padding:26px 28px;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="width:44px;height:44px;background:#e6bd62;border-radius:12px 12px 12px 3px;text-align:center;vertical-align:middle;font-weight:900;font-size:18px;color:#0b2825;letter-spacing:-0.5px;">NW</td>
<td style="padding-left:12px;color:#ffffff;font-weight:800;font-size:17px;letter-spacing:2.5px;">NAIJA WORLD<div style="font-weight:500;font-size:11px;letter-spacing:1px;color:#9fd3c7;padding-top:3px;">YOUR LIFE · YOUR CITY · YOUR STORY</div></td>
</tr></table>
</td></tr>
<tr><td style="height:4px;background:linear-gradient(90deg,#008751 0%,#008751 33%,#ffffff 33%,#ffffff 66%,#008751 66%);background-color:#008751;"></td></tr>
<tr><td style="padding:30px 28px 8px 28px;">${body}</td></tr>
<tr><td style="padding:20px 28px 28px 28px;border-top:1px solid #e3e9e6;font-size:12px;line-height:18px;color:#6b7b77;">
Naija World is a game. We will never ask for your password or bank details by email.<br>
You are receiving this because someone asked to reset the password for this account.
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

export function resetPasswordEmail({ to, name, username, url }: { to: string; name: string; username: string | null; url: string }): Mail {
  const who = username ? ` <strong>@${escape(username)}</strong>` : "";
  const html = layout(
    "Use this link to choose a new password. It expires in one hour.",
    `<h1 style="margin:0 0 12px 0;font-size:24px;line-height:30px;font-weight:800;color:#0b2825;">Reset your password</h1>
<p style="margin:0 0 14px 0;font-size:15px;line-height:23px;">Hi ${escape(name)},</p>
<p style="margin:0 0 22px 0;font-size:15px;line-height:23px;">We got a request to reset the password for your Naija World account${who}. Tap the button to choose a new one.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 22px 0;"><tr><td style="border-radius:12px;background:#e6bd62;">
<a href="${escape(url)}" style="display:inline-block;padding:14px 26px;font-size:16px;font-weight:800;color:#0b2825;text-decoration:none;border-radius:12px;">Choose a new password</a>
</td></tr></table>
<p style="margin:0 0 8px 0;font-size:13px;line-height:20px;color:#4b5b57;">This link works once and expires in <strong>1 hour</strong>. If the button doesn't work, copy this address into your browser:</p>
<p style="margin:0 0 20px 0;font-size:12px;line-height:18px;word-break:break-all;"><a href="${escape(url)}" style="color:#0f6b5c;">${escape(url)}</a></p>
<p style="margin:0 0 6px 0;font-size:13px;line-height:20px;color:#4b5b57;">Didn't ask for this? Ignore this email and your password stays the same.</p>`,
  );
  const text = [
    `Hi ${name},`,
    "",
    `We got a request to reset the password for your Naija World account${username ? ` @${username}` : ""}.`,
    "Choose a new password here (works once, expires in 1 hour):",
    url,
    "",
    "Didn't ask for this? Ignore this email and your password stays the same.",
    "",
    "Naija World · Your life. Your city. Your story.",
  ].join("\n");
  return { to, subject: "Reset your Naija World password", html, text };
}
