import type { Env } from "./env";

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Sends an email. In local development (EMAIL_MODE=log) the email is printed
 * to the wrangler console instead, so links can be copied from there.
 * Failures are logged and reported as `false`, never thrown: a slow or failing
 * email provider must not break sign-up.
 */
export async function sendEmail(env: Env, email: OutgoingEmail): Promise<boolean> {
  if (env.EMAIL_MODE !== "send" || !env.EMAIL) {
    console.log(`\n📧 [email to ${email.to}] ${email.subject}\n${email.text}\n`);
    return true;
  }
  try {
    await env.EMAIL.send({ from: env.MAIL_FROM, to: email.to, subject: email.subject, text: email.text, html: email.html });
    return true;
  } catch (err) {
    console.error("Email send failed", { to: email.to, subject: email.subject, err });
    return false;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function layout(heading: string, body: string, buttonText: string, link: string, footer: string): string {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f5f7;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111">
<table role="presentation" width="100%" style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px">
<tr><td>
<p style="font-weight:800;font-size:20px;margin:0 0 24px">Qrono</p>
<h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(heading)}</h1>
<p style="line-height:1.5;margin:0 0 24px">${escapeHtml(body)}</p>
<p style="margin:0 0 24px"><a href="${escapeHtml(link)}" style="background:#f5b301;color:#111;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px;display:inline-block">${escapeHtml(buttonText)}</a></p>
<p style="font-size:13px;color:#666;line-height:1.5;margin:0">${escapeHtml(footer)}<br>If the button doesn't work, paste this link into your browser:<br><span style="word-break:break-all">${escapeHtml(link)}</span></p>
</td></tr></table></body></html>`;
}

export function verificationEmail(firstName: string, link: string): Omit<OutgoingEmail, "to"> {
  const body = `Hi ${firstName}, confirm your email address to finish setting up your Qrono account.`;
  const footer = "This link expires in 24 hours. If you didn't sign up for Qrono, you can ignore this email.";
  return {
    subject: "Confirm your email for Qrono",
    text: `${body}\n\n${link}\n\n${footer}`,
    html: layout("Confirm your email", body, "Confirm email", link, footer),
  };
}

export function passwordResetEmail(firstName: string, link: string): Omit<OutgoingEmail, "to"> {
  const body = `Hi ${firstName}, we got a request to reset your Qrono password. Choose a new one with the link below.`;
  const footer = "This link expires in 1 hour. If you didn't ask for this, you can ignore this email; your password won't change.";
  return {
    subject: "Reset your Qrono password",
    text: `${body}\n\n${link}\n\n${footer}`,
    html: layout("Reset your password", body, "Choose a new password", link, footer),
  };
}

const ROLE_NAMES = { approver: "an Approver", admin: "an Admin", member: "a Member" } as const;

export function teamInviteEmail(
  inviterName: string,
  teamName: string,
  role: keyof typeof ROLE_NAMES,
  link: string,
): Omit<OutgoingEmail, "to"> {
  const body = `${inviterName} invited you to join ${teamName} on Qrono as ${ROLE_NAMES[role]}. Qrono keeps live event programs on time and everyone in sync.`;
  const footer = "This invitation expires in 7 days. If you weren't expecting it, you can ignore this email.";
  return {
    subject: `${inviterName} invited you to ${teamName} on Qrono`,
    text: `${body}\n\n${link}\n\n${footer}`,
    html: layout(`Join ${teamName} on Qrono`, body, "Accept invitation", link, footer),
  };
}

export function joinRequestEmail(requesterName: string, teamName: string, link: string): Omit<OutgoingEmail, "to"> {
  const body = `${requesterName} used your team's invite link to ask to join ${teamName}. Check who they are before letting them in.`;
  const footer = "You're getting this because you're an Approver or Admin on this team.";
  return {
    subject: `${requesterName} wants to join ${teamName}`,
    text: `${body}\n\n${link}\n\n${footer}`,
    html: layout(`${requesterName} wants to join`, body, "Review request", link, footer),
  };
}
