import { query } from "../db.js";

export type User = {
  id: string;
  email: string;
  name: string | null;
};

export type OAuthTokens = {
  access_token: string;
  refresh_token?: string | null;
  scope?: string | null;
  token_type?: string | null;
  expires_at?: string | null;
};

export type Meeting = {
  id: string;
  provider: string;
  provider_event_id: string | null;
  title: string | null;
  start_time: string | null;
  end_time: string | null;
  timezone: string | null;
  organizer_email: string | null;
  organizer_name: string | null;
  attendees: unknown[];
};

export type Recording = {
  id: string;
  meeting_id: string | null;
  provider: string;
  provider_recording_id: string | null;
  download_url: string | null;
  file_extension: string | null;
  file_mime: string | null;
  file_path: string | null;
  duration_seconds: number | null;
  status: string;
};

export async function upsertUserByEmail(email: string, name: string | null): Promise<User> {
  const rows = await query<User>(
    `INSERT INTO users (email, name)
     VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, email, name`,
    [email, name]
  );
  return rows[0];
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const rows = await query<User>("SELECT id, email, name FROM users WHERE email = $1", [email]);
  return rows[0] || null;
}

export async function saveOAuthTokens(userId: string, provider: string, tokens: OAuthTokens): Promise<void> {
  await query(
    `INSERT INTO oauth_tokens (user_id, provider, access_token, refresh_token, scope, token_type, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id, provider)
     DO UPDATE SET access_token = EXCLUDED.access_token,
                   refresh_token = EXCLUDED.refresh_token,
                   scope = EXCLUDED.scope,
                   token_type = EXCLUDED.token_type,
                   expires_at = EXCLUDED.expires_at,
                   updated_at = now()`,
    [
      userId,
      provider,
      tokens.access_token,
      tokens.refresh_token || null,
      tokens.scope || null,
      tokens.token_type || null,
      tokens.expires_at || null
    ]
  );
}

export async function getOAuthTokens(userId: string, provider: string): Promise<OAuthTokens | null> {
  const rows = await query<OAuthTokens>(
    `SELECT access_token, refresh_token, scope, token_type, expires_at
     FROM oauth_tokens WHERE user_id = $1 AND provider = $2`,
    [userId, provider]
  );
  return rows[0] || null;
}

export async function createOAuthState(provider: string, state: string): Promise<void> {
  await query(
    "INSERT INTO oauth_states (provider, state) VALUES ($1, $2)",
    [provider, state]
  );
}

export async function consumeOAuthState(state: string): Promise<string | null> {
  const rows = await query<{ provider: string }>(
    "SELECT provider FROM oauth_states WHERE state = $1",
    [state]
  );
  if (!rows[0]) return null;
  await query("DELETE FROM oauth_states WHERE state = $1", [state]);
  return rows[0].provider;
}

export async function findMeetingByProviderEventId(provider: string, providerEventId: string): Promise<Meeting | null> {
  const rows = await query<Meeting>(
    `SELECT id, provider, provider_event_id, title, start_time, end_time, timezone, organizer_email, organizer_name, attendees
     FROM meetings WHERE provider = $1 AND provider_event_id = $2`,
    [provider, providerEventId]
  );
  return rows[0] || null;
}

export async function createMeeting(input: {
  provider: string;
  provider_event_id?: string | null;
  title?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  timezone?: string | null;
  organizer_email?: string | null;
  organizer_name?: string | null;
  attendees?: unknown[];
}): Promise<Meeting> {
  const rows = await query<Meeting>(
    `INSERT INTO meetings (provider, provider_event_id, title, start_time, end_time, timezone, organizer_email, organizer_name, attendees)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, provider, provider_event_id, title, start_time, end_time, timezone, organizer_email, organizer_name, attendees`,
    [
      input.provider,
      input.provider_event_id || null,
      input.title || null,
      input.start_time || null,
      input.end_time || null,
      input.timezone || null,
      input.organizer_email || null,
      input.organizer_name || null,
      JSON.stringify(input.attendees || [])
    ]
  );
  return rows[0];
}

export async function createRecording(input: {
  meeting_id?: string | null;
  provider: string;
  provider_recording_id?: string | null;
  download_url?: string | null;
  file_extension?: string | null;
  file_mime?: string | null;
  duration_seconds?: number | null;
  status?: string;
}): Promise<Recording> {
  const rows = await query<Recording>(
    `INSERT INTO recordings (meeting_id, provider, provider_recording_id, download_url, file_extension, file_mime, duration_seconds, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, meeting_id, provider, provider_recording_id, download_url, file_extension, file_mime, file_path, duration_seconds, status`,
    [
      input.meeting_id || null,
      input.provider,
      input.provider_recording_id || null,
      input.download_url || null,
      input.file_extension || null,
      input.file_mime || null,
      input.duration_seconds || null,
      input.status || "pending"
    ]
  );
  return rows[0];
}

export async function findRecordingByProviderRecordingId(provider: string, providerRecordingId: string): Promise<Recording | null> {
  const rows = await query<Recording>(
    `SELECT id, meeting_id, provider, provider_recording_id, download_url, file_extension, file_mime, file_path, duration_seconds, status
     FROM recordings WHERE provider = $1 AND provider_recording_id = $2`,
    [provider, providerRecordingId]
  );
  return rows[0] || null;
}

export async function getRecordingById(recordingId: string): Promise<Recording | null> {
  const rows = await query<Recording>(
    `SELECT id, meeting_id, provider, provider_recording_id, download_url, file_extension, file_mime, file_path, duration_seconds, status
     FROM recordings WHERE id = $1`,
    [recordingId]
  );
  return rows[0] || null;
}

export async function updateRecordingStatus(recordingId: string, status: string): Promise<void> {
  await query(
    "UPDATE recordings SET status = $1, updated_at = now() WHERE id = $2",
    [status, recordingId]
  );
}

export async function updateRecordingFile(recordingId: string, filePath: string, durationSeconds: number | null): Promise<void> {
  await query(
    "UPDATE recordings SET file_path = $1, duration_seconds = $2, updated_at = now() WHERE id = $3",
    [filePath, durationSeconds, recordingId]
  );
}

export async function createTranscript(input: {
  recording_id: string;
  provider: string;
  content_json?: unknown;
  content_text?: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO transcripts (recording_id, provider, content_json, content_text)
     VALUES ($1, $2, $3, $4)`,
    [input.recording_id, input.provider, input.content_json ? JSON.stringify(input.content_json) : null, input.content_text || null]
  );
}

export async function getTranscriptByRecordingId(recordingId: string): Promise<{ content_json: unknown; content_text: string | null } | null> {
  const rows = await query<{ content_json: unknown; content_text: string | null }>(
    "SELECT content_json, content_text FROM transcripts WHERE recording_id = $1",
    [recordingId]
  );
  return rows[0] || null;
}

export async function createArtifact(input: {
  meeting_id: string;
  decisions?: unknown;
  action_items?: unknown;
  followups?: unknown;
  internal_notes?: unknown;
}): Promise<void> {
  await query(
    `INSERT INTO artifacts (meeting_id, decisions, action_items, followups, internal_notes)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      input.meeting_id,
      input.decisions ? JSON.stringify(input.decisions) : null,
      input.action_items ? JSON.stringify(input.action_items) : null,
      input.followups ? JSON.stringify(input.followups) : null,
      input.internal_notes ? JSON.stringify(input.internal_notes) : null
    ]
  );
}

export async function getMeetingById(meetingId: string): Promise<Meeting | null> {
  const rows = await query<Meeting>(
    `SELECT id, provider, provider_event_id, title, start_time, end_time, timezone, organizer_email, organizer_name, attendees
     FROM meetings WHERE id = $1`,
    [meetingId]
  );
  return rows[0] || null;
}
