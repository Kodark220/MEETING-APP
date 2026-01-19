import type { FastifyInstance } from "fastify";
import { loadEnv } from "../config.js";
import { getGoogleClientWithTokens, listRecentCalendarEvents, findMeetRecordingFiles } from "../services/google.js";
import { enqueueRecording } from "../jobs/queues.js";
import {
  createMeeting,
  createRecording,
  findMeetingByProviderEventId,
  findRecordingByProviderRecordingId,
  getOAuthTokens,
  getUserByEmail
} from "../services/store.js";

const env = loadEnv();

function requireInternalKey(req: any): boolean {
  if (!env.INTERNAL_API_KEY) return true;
  const key = req.headers["x-internal-key"] as string | undefined;
  return key === env.INTERNAL_API_KEY;
}

export async function meetingRoutes(app: FastifyInstance) {
  app.post("/meet/sync", async (req, reply) => {
    if (!requireInternalKey(req)) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const body = req.body as { userEmail?: string };
    if (!body?.userEmail) {
      return reply.status(400).send({ error: "userEmail is required" });
    }

    const user = await getUserByEmail(body.userEmail);
    if (!user) {
      return reply.status(404).send({ error: "User not found" });
    }

    const tokens = await getOAuthTokens(user.id, "google");
    if (!tokens) {
      return reply.status(400).send({ error: "Google not connected" });
    }

    const auth = getGoogleClientWithTokens({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || null,
      expiry_date: tokens.expires_at ? new Date(tokens.expires_at).getTime() : null
    });

    const events = await listRecentCalendarEvents(auth, env.MEET_SYNC_LOOKBACK_HOURS);
    let created = 0;

    for (const event of events) {
      if (!event.id) continue;
      const isMeet = Boolean(event.hangoutLink || event.conferenceData?.conferenceId);
      if (!isMeet) continue;
      const meeting = await findMeetingByProviderEventId("google_meet", event.id);

      const attendees = (event.attendees || []).map((att: { displayName?: string | null; email?: string | null }) => ({
        name: att.displayName || att.email || "Unknown",
        email: att.email || ""
      })).filter((att: { email: string }) => Boolean(att.email));

      const start = event.start?.dateTime || null;
      const end = event.end?.dateTime || null;

      const meetingRecord = meeting || await createMeeting({
        provider: "google_meet",
        provider_event_id: event.id,
        title: event.summary || null,
        start_time: start,
        end_time: end,
        timezone: event.start?.timeZone || null,
        organizer_email: event.organizer?.email || null,
        organizer_name: event.organizer?.displayName || null,
        attendees
      });

      const files = await findMeetRecordingFiles(auth, {
        summary: event.summary || null,
        start: event.start || null,
        end: event.end || null
      });

      for (const file of files) {
        if (!file.id) continue;
        const existing = await findRecordingByProviderRecordingId("google_meet", file.id);
        if (existing) continue;

        const recording = await createRecording({
          meeting_id: meetingRecord.id,
          provider: "google_meet",
          provider_recording_id: file.id,
          download_url: null,
          file_extension: file.name?.split(".").pop() || null,
          file_mime: file.mimeType || null,
          duration_seconds: null,
          status: "pending"
        });
        await enqueueRecording(recording.id);
        created += 1;
      }
    }

    return reply.send({ ok: true, created });
  });
}
