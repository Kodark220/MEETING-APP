import { google } from "googleapis";
import dayjs from "dayjs";
import { loadEnv } from "../config.js";

const env = loadEnv();

const googleScopes = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile"
];

export function getGoogleOAuthClient() {
  return new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI);
}

export function getGoogleAuthUrl(state: string): string {
  const client = getGoogleOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    scope: googleScopes,
    prompt: "consent",
    state
  });
}

export async function exchangeGoogleCode(code: string) {
  const client = getGoogleOAuthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const me = await oauth2.userinfo.get();

  return {
    tokens,
    profile: {
      email: me.data.email || "",
      name: me.data.name || null
    }
  };
}

export function getGoogleClientWithTokens(tokens: {
  access_token?: string | null;
  refresh_token?: string | null;
  scope?: string | null;
  token_type?: string | null;
  expiry_date?: number | null;
}) {
  const client = getGoogleOAuthClient();
  const credentials: import("google-auth-library").Credentials = {
    access_token: tokens.access_token || undefined,
    refresh_token: tokens.refresh_token || undefined,
    scope: tokens.scope || undefined,
    token_type: tokens.token_type || undefined,
    expiry_date: tokens.expiry_date || undefined
  };
  client.setCredentials(credentials);
  return client;
}

export async function listRecentCalendarEvents(auth: import("google-auth-library").OAuth2Client, lookbackHours: number) {
  const calendar = google.calendar({ version: "v3", auth });
  const timeMin = dayjs().subtract(lookbackHours, "hour").toISOString();
  const timeMax = dayjs().add(2, "hour").toISOString();

  const res = await calendar.events.list({
    calendarId: "primary",
    timeMin,
    timeMax,
    conferenceDataVersion: 1,
    singleEvents: true,
    orderBy: "startTime"
  } as any);

  return res.data.items || [];
}

function escapeDriveQuery(value: string) {
  return value.replace(/'/g, "\\'");
}

export async function findMeetRecordingFiles(
  auth: import("google-auth-library").OAuth2Client,
  event: {
    summary?: string | null;
    start?: { dateTime?: string | null } | null;
    end?: { dateTime?: string | null } | null;
  }
) {
  const drive = google.drive({ version: "v3", auth });
  const start = event.start?.dateTime ? dayjs(event.start.dateTime) : dayjs().subtract(2, "hour");
  const end = event.end?.dateTime ? dayjs(event.end.dateTime) : dayjs();
  const createdAfter = start.subtract(1, "hour").toISOString();
  const createdBefore = end.add(6, "hour").toISOString();

  const parts = [
    "mimeType contains 'video/'",
    `createdTime >= '${createdAfter}'`,
    `createdTime <= '${createdBefore}'`,
    "trashed = false"
  ];

  if (event.summary) {
    parts.push(`name contains '${escapeDriveQuery(event.summary)}'`);
  }

  const res = await drive.files.list({
    q: parts.join(" and "),
    fields: "files(id, name, mimeType, createdTime, size)"
  });

  return res.data.files || [];
}

export async function downloadDriveFile(
  auth: import("google-auth-library").OAuth2Client,
  fileId: string
): Promise<ArrayBuffer> {
  const drive = google.drive({ version: "v3", auth });
  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" } as any
  );
  return (res as any).data as ArrayBuffer;
}
