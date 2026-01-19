import nodemailer from "nodemailer";
import { loadEnv } from "../config.js";

const env = loadEnv();

export type OrganizerEmailPayload = {
  organizerName: string | null;
  organizerEmail: string;
  meetingTitle: string | null;
  meetingDate: string | null;
  decisions: { topic: string; items: { text: string }[] }[];
  actionItems: { text: string; owner: { name: string; email: string }; deadline: string }[];
  followups: { to: { name: string; email: string }; subject: string; body: string }[];
};

function buildOrganizerEmailText(payload: OrganizerEmailPayload): string {
  const name = payload.organizerName || "there";
  const title = payload.meetingTitle || "Your meeting";

  const decisionsBlock = payload.decisions
    .map((group) => {
      const items = group.items.map((item) => `- ${item.text}`).join("\n");
      return `Topic: ${group.topic}\n${items}`;
    })
    .join("\n\n");

  const actionsBlock = payload.actionItems
    .map((item) => `- ${item.owner.name}: ${item.text} by ${item.deadline}`)
    .join("\n");

  const followupsBlock = payload.followups
    .map((item) => {
      return `To: ${item.to.name} <${item.to.email}>\nSubject: ${item.subject}\nBody:\n${item.body}`;
    })
    .join("\n\n");

  return `Hi ${name},\n\nHere are the outcomes from ${title}.\n\nDecisions (grouped by topic)\n${decisionsBlock || "No decisions captured."}\n\nAction Items\n${actionsBlock || "No action items captured."}\n\nFollow-up Drafts\n${followupsBlock || "No follow-ups generated."}\n\nIf anything looks off, reply and I will correct it.`;
}

async function sendViaSmtp(to: string, subject: string, text: string) {
  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT || 587,
    secure: false,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined
  });

  await transporter.sendMail({
    from: env.EMAIL_FROM,
    to,
    subject,
    text
  });
}

async function sendViaPostmark(to: string, subject: string, text: string) {
  if (!env.POSTMARK_API_KEY) {
    throw new Error("POSTMARK_API_KEY is required for postmark email");
  }

  const res = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": env.POSTMARK_API_KEY
    },
    body: JSON.stringify({
      From: env.EMAIL_FROM,
      To: to,
      Subject: subject,
      TextBody: text
    })
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Postmark error: ${res.status} ${body}`);
  }
}

export async function sendOrganizerEmail(payload: OrganizerEmailPayload) {
  const subjectDate = payload.meetingDate ? ` (${payload.meetingDate})` : "";
  const subject = `Decisions and Next Steps: ${payload.meetingTitle || "Meeting"}${subjectDate}`;
  const text = buildOrganizerEmailText(payload);

  if (env.EMAIL_PROVIDER === "postmark") {
    await sendViaPostmark(payload.organizerEmail, subject, text);
    return;
  }

  await sendViaSmtp(payload.organizerEmail, subject, text);
}
