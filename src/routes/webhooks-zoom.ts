import type { FastifyInstance } from "fastify";
import crypto from "crypto";
import { loadEnv } from "../config.js";
import { createMeeting, createRecording, findMeetingByProviderEventId, findRecordingByProviderRecordingId } from "../services/store.js";
import { enqueueRecording } from "../jobs/queues.js";

const env = loadEnv();

export async function zoomWebhookRoutes(app: FastifyInstance) {
  app.post("/", async (req, reply) => {
    const body = req.body as any;

    const timestamp = req.headers["x-zm-request-timestamp"] as string | undefined;
    const signature = req.headers["x-zm-signature"] as string | undefined;
    if (env.ZOOM_WEBHOOK_SECRET_TOKEN && timestamp && signature) {
      const payload = JSON.stringify(body);
      const message = `v0:${timestamp}:${payload}`;
      const hash = crypto.createHmac("sha256", env.ZOOM_WEBHOOK_SECRET_TOKEN).update(message).digest("hex");
      const expected = `v0=${hash}`;
      if (expected !== signature) {
        return reply.status(401).send({ error: "Invalid signature" });
      }
    }

    if (body?.event === "endpoint.url_validation") {
      const plainToken = body.payload?.plainToken;
      const encryptedToken = crypto.createHmac("sha256", env.ZOOM_WEBHOOK_SECRET_TOKEN || "").update(plainToken || "").digest("hex");
      return reply.send({ plainToken, encryptedToken });
    }

    if (body?.event !== "recording.completed") {
      return reply.send({ ok: true });
    }

    const payload = body.payload?.object;
    if (!payload) {
      return reply.status(400).send({ error: "Missing payload" });
    }

    const meetingKey = payload.uuid || payload.id;
    let meeting = meetingKey ? await findMeetingByProviderEventId("zoom", meetingKey) : null;

    if (!meeting) {
      meeting = await createMeeting({
        provider: "zoom",
        provider_event_id: meetingKey || null,
        title: payload.topic || null,
        start_time: payload.start_time || null,
        end_time: payload.end_time || null,
        timezone: payload.timezone || null,
        organizer_email: payload.host_email || null,
        organizer_name: payload.host_name || null,
        attendees: []
      });
    }

    const files = Array.isArray(payload.recording_files) ? payload.recording_files : [];
    const preferred = files.filter((f: any) => ["MP4", "M4A"].includes(f.file_type)).sort((a: any, b: any) => (b.file_size || 0) - (a.file_size || 0));
    const pick = preferred[0] || files[0];
    if (!pick) {
      return reply.send({ ok: true });
    }

    const existing = pick.id ? await findRecordingByProviderRecordingId("zoom", pick.id) : null;
    if (existing) {
      return reply.send({ ok: true });
    }

    const recording = await createRecording({
      meeting_id: meeting.id,
      provider: "zoom",
      provider_recording_id: pick.id || null,
      download_url: pick.download_url || null,
      file_extension: pick.file_extension ? String(pick.file_extension).toLowerCase() : null,
      file_mime: pick.mime_type || null,
      duration_seconds: payload.duration ? Number(payload.duration) * 60 : null,
      status: "pending"
    });

    await enqueueRecording(recording.id);

    return reply.send({ ok: true });
  });
}
