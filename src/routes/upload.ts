import type { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import dayjs from "dayjs";
import { saveRecordingBuffer } from "../services/storage.js";
import { createMeeting, createRecording, updateRecordingFile } from "../services/store.js";
import { enqueueRecording } from "../jobs/queues.js";

function parseAttendees(raw: string | undefined) {
  if (!raw) return [];
  const entries = raw.split(/[,;\n]+/).map((value) => value.trim()).filter(Boolean);
  return entries
    .map((entry) => {
      const match = entry.match(/^(.*?)<(.+?)>$/);
      if (match) {
        return { name: match[1].trim() || match[2].trim(), email: match[2].trim() };
      }
      return { name: entry.split("@")[0] || entry, email: entry };
    })
    .filter((attendee) => attendee.email.includes("@"));
}

export async function uploadRoutes(app: FastifyInstance) {
  app.get("/", async (_req, reply) => {
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Upload Recording</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 32px; max-width: 720px; margin: 0 auto; }
    label { display: block; margin-top: 12px; font-weight: 600; }
    input, textarea { width: 100%; padding: 8px; margin-top: 6px; }
    button { margin-top: 16px; padding: 10px 14px; background: #111; color: #fff; border: 0; border-radius: 6px; cursor: pointer; }
    .note { font-size: 13px; color: #666; margin-top: 12px; }
  </style>
</head>
<body>
  <h1>Upload a recording</h1>
  <form method="post" enctype="multipart/form-data">
    <label>Organizer email</label>
    <input name="organizerEmail" type="email" required />

    <label>Organizer name (optional)</label>
    <input name="organizerName" type="text" />

    <label>Meeting title (optional)</label>
    <input name="meetingTitle" type="text" />

    <label>Meeting date (optional)</label>
    <input name="meetingDate" type="date" />

    <label>Attendees (comma-separated emails or Name &lt;email&gt;)</label>
    <textarea name="attendees" rows="3" placeholder="sarah@company.com, Alex <alex@company.com>"></textarea>

    <label>Recording file</label>
    <input name="recording" type="file" accept="audio/*,video/*" required />

    <button type="submit">Upload and process</button>
    <p class="note">Large files may take several minutes to process.</p>
  </form>
</body>
</html>`;
    reply.type("text/html").send(html);
  });

  app.post("/", async (req, reply) => {
    const fields: Record<string, string> = {};
    let upload: { filename: string; mimetype: string; buffer: Buffer } | null = null;

    const parts = req.parts();
    for await (const part of parts) {
      if ((part as any).file) {
        const filePart = part as any;
        if (filePart.fieldname !== "recording") {
          continue;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of filePart.file) {
          chunks.push(chunk as Buffer);
        }
        upload = {
          filename: filePart.filename || "recording",
          mimetype: filePart.mimetype || "application/octet-stream",
          buffer: Buffer.concat(chunks)
        };
      } else {
        const valuePart = part as any;
        fields[valuePart.fieldname] = String(valuePart.value || "");
      }
    }

    if (!upload) {
      return reply.status(400).send("Recording file is required.");
    }

    const organizerEmail = (fields.organizerEmail || "").trim();
    if (!organizerEmail) {
      return reply.status(400).send("Organizer email is required.");
    }

    const organizerName = (fields.organizerName || "").trim() || null;
    const meetingTitle = (fields.meetingTitle || "").trim() || "Manual upload";
    const meetingDate = (fields.meetingDate || "").trim() || null;

    const attendees = parseAttendees(fields.attendees);
    if (!attendees.find((attendee) => attendee.email.toLowerCase() === organizerEmail.toLowerCase())) {
      attendees.push({ name: organizerName || organizerEmail, email: organizerEmail });
    }

    const extension = upload.filename.split(".").pop() || "mp4";
    const stored = await saveRecordingBuffer(upload.buffer, extension, upload.mimetype);

    const startTime = meetingDate ? dayjs(meetingDate).startOf("day").toISOString() : null;

    const meeting = await createMeeting({
      provider: "manual",
      provider_event_id: randomUUID(),
      title: meetingTitle,
      start_time: startTime,
      end_time: null,
      timezone: null,
      organizer_email: organizerEmail,
      organizer_name: organizerName,
      attendees
    });

    const recording = await createRecording({
      meeting_id: meeting.id,
      provider: "manual",
      provider_recording_id: randomUUID(),
      download_url: null,
      file_extension: extension,
      file_mime: upload.mimetype,
      duration_seconds: null,
      status: "pending"
    });

    await updateRecordingFile(recording.id, stored.path, null);
    await enqueueRecording(recording.id);

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Upload received</title>
</head>
<body>
  <h1>Upload received</h1>
  <p>Your recording is processing. You'll receive an email when it's ready.</p>
</body>
</html>`;
    reply.type("text/html").send(html);
  });
}
