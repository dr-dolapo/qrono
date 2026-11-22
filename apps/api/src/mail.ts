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

function layout(heading: string, body: string, buttonText: string, link: string, footer: string, details: string[] = []): string {
  const list = details.length
    ? `<ul style="margin:0 0 24px;padding-left:20px;line-height:1.7">${details.map((d) => `<li>${escapeHtml(d)}</li>`).join("")}</ul>`
    : "";
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f5f7;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111">
<table role="presentation" width="100%" style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px">
<tr><td>
<p style="font-weight:800;font-size:20px;margin:0 0 24px">Qrono</p>
<h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(heading)}</h1>
<p style="line-height:1.5;margin:0 0 24px">${escapeHtml(body)}</p>
${list}
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

// ───────────── Event review & approval ─────────────

/** "Tuesday 1 December 2026, 09:00" in the event's own time zone. */
export function formatEventTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString("en-GB", { timeZone, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function formatClockTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" });
}

const withText = (body: string, details: string[], link: string, footer: string) =>
  [body, ...(details.length ? ["", ...details.map((d) => `- ${d}`)] : []), "", link, "", footer].join("\n");

export function reviewRequestedEmail(submitter: string, eventName: string, when: string, link: string): Omit<OutgoingEmail, "to"> {
  const body = `${submitter} has sent "${eventName}" (${when}) for your approval. Review the agenda, leave comments on any task, and approve it when it's ready.`;
  const footer = "You're getting this because you were chosen as an Approver for this event.";
  return {
    subject: `Please review: ${eventName}`,
    text: withText(body, [], link, footer),
    html: layout(`Review "${eventName}"`, body, "Review event", link, footer),
  };
}

export function eventApprovedEmail(approver: string, eventName: string, when: string, link: string): Omit<OutgoingEmail, "to"> {
  const body = `${approver} approved "${eventName}" (${when}). Everyone on the agenda has been told about their part.`;
  const footer = "You're getting this because you're an Approver or Admin on this team.";
  return {
    subject: `Approved: ${eventName}`,
    text: withText(body, [], link, footer),
    html: layout(`"${eventName}" is approved`, body, "View event", link, footer),
  };
}

export function assignedEmail(firstName: string, teamName: string, eventName: string, when: string, tasks: string[], link: string): Omit<OutgoingEmail, "to"> {
  const body = `Hi ${firstName}, you're on the program for "${eventName}" (${when}) with ${teamName}. Your part:`;
  const footer = "Please confirm you can make it, or let the team know if you can't.";
  return {
    subject: `You're on the program: ${eventName}`,
    text: withText(body, tasks, link, footer),
    html: layout(`You're on the program for ${eventName}`, body, "Confirm or decline", link, footer, tasks),
  };
}

export function guestInviteEmail(name: string, teamName: string, eventName: string, when: string, tasks: string[], link: string): Omit<OutgoingEmail, "to"> {
  const body = `Hi ${name}, ${teamName} has put you on the program for "${eventName}" (${when}). Your part:`;
  const footer = "This link is just for you; please don't forward it. It stops working when the event ends. No app or account needed.";
  return {
    subject: `You're on the program: ${eventName}`,
    text: withText(body, tasks, link, footer),
    html: layout(`You're on the program for ${eventName}`, body, "See the program and confirm", link, footer, tasks),
  };
}

// ───────────── Changes after approval ─────────────

export function planChangedEmail(
  name: string,
  eventName: string,
  when: string,
  now: string[],
  before: string[],
  link: string,
): Omit<OutgoingEmail, "to"> {
  const body = `Hi ${name}, the program for "${eventName}" (${when}) has changed. Your part is now:`;
  const previously = before.length ? `Before the change: ${before.join("; ")}.` : "You had no tasks before.";
  const footer = `${previously} Please check the program and let the team know if this doesn't work for you.`;
  return {
    subject: `Changes to the program: ${eventName}`,
    text: withText(body, now.length ? now : ["No tasks at the moment"], link, footer),
    html: layout(`"${eventName}" has changed`, body, "See the program", link, footer, now.length ? now : ["No tasks at the moment"]),
  };
}

export function removedFromProgramEmail(name: string, eventName: string, when: string): Omit<OutgoingEmail, "to"> {
  const body = `Hi ${name}, you're no longer on the program for "${eventName}" (${when}). You don't need to do anything.`;
  return {
    subject: `You're no longer on the program: ${eventName}`,
    text: `${body}\n\nIf you think this is a mistake, contact the event team.`,
    html: `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f5f7;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111"><table role="presentation" width="100%" style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px"><tr><td><p style="font-weight:800;font-size:20px;margin:0 0 24px">Qrono</p><p style="line-height:1.5;margin:0 0 16px">${escapeHtml(body)}</p><p style="font-size:13px;color:#666;margin:0">If you think this is a mistake, contact the event team.</p></td></tr></table></body></html>`,
  };
}
