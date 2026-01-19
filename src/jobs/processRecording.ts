import dayjs from "dayjs";
import { getRecordingById, getMeetingById, getOAuthTokens, getTranscriptByRecordingId, getUserByEmail, updateRecordingFile, updateRecordingStatus, createTranscript, createArtifact, saveOAuthTokens } from "../services/store.js";
import { downloadZoomRecording, refreshZoomToken } from "../services/zoom.js";
import { downloadDriveFile, getGoogleClientWithTokens } from "../services/google.js";
import { saveRecordingBuffer } from "../services/storage.js";
import { transcribeRecording } from "../services/transcription.js";
import { extractMeetingOutcomes } from "../services/extraction.js";
import { inferNextMeetingDate, normalizeOutcomes } from "../services/normalize.js";
import { sendOrganizerEmail } from "../services/email.js";

export async function processRecording(recordingId: string) {
  const recording = await getRecordingById(recordingId);
  if (!recording) {
    throw new Error("Recording not found");
  }

  if (recording.status === "emailed") {
    return;
  }

  await updateRecordingStatus(recordingId, "processing");

  try {
    const meeting = recording.meeting_id ? await getMeetingById(recording.meeting_id) : null;
    if (!meeting) {
      throw new Error("Meeting not found");
    }

    let recordingFilePath = recording.file_path;
    let recordingExtension = recording.file_extension || "mp4";

    if (!recordingFilePath) {
      if (recording.provider === "zoom") {
        const organizerEmail = meeting.organizer_email;
        if (!organizerEmail) {
          throw new Error("Organizer email missing");
        }
        const user = await getUserByEmail(organizerEmail);
        if (!user) {
          throw new Error("Organizer user not found");
        }
        const tokens = await getOAuthTokens(user.id, "zoom");
        if (!tokens) {
          throw new Error("Zoom not connected for organizer");
        }
        let accessToken = tokens.access_token;
        if (tokens.expires_at && tokens.refresh_token && new Date(tokens.expires_at) < new Date()) {
          const refreshed = await refreshZoomToken(tokens.refresh_token);
          accessToken = refreshed.access_token;
          await saveOAuthTokens(user.id, "zoom", {
            access_token: refreshed.access_token,
            refresh_token: refreshed.refresh_token || tokens.refresh_token,
            scope: refreshed.scope || tokens.scope,
            token_type: refreshed.token_type || tokens.token_type,
            expires_at: refreshed.expires_in ? new Date(Date.now() + refreshed.expires_in * 1000).toISOString() : tokens.expires_at
          });
        }
        if (!recording.download_url) {
          throw new Error("Zoom download_url missing");
        }

        const buffer = await downloadZoomRecording(recording.download_url, accessToken);
        const extension = recording.file_extension || "mp4";
        const mime = recording.file_mime || "video/mp4";
        const stored = await saveRecordingBuffer(buffer, extension, mime);
        await updateRecordingFile(recording.id, stored.path, recording.duration_seconds);
        recordingFilePath = stored.path;
        recordingExtension = extension;
      } else if (recording.provider === "google_meet") {
        const organizerEmail = meeting.organizer_email;
        if (!organizerEmail) {
          throw new Error("Organizer email missing");
        }
        const user = await getUserByEmail(organizerEmail);
        if (!user) {
          throw new Error("Organizer user not found");
        }
        const tokens = await getOAuthTokens(user.id, "google");
        if (!tokens) {
          throw new Error("Google not connected for organizer");
        }
        if (!recording.provider_recording_id) {
          throw new Error("Drive file id missing");
        }

        const auth = getGoogleClientWithTokens({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token || null,
          expiry_date: tokens.expires_at ? new Date(tokens.expires_at).getTime() : null
        });
        const buffer = await downloadDriveFile(auth, recording.provider_recording_id);
        const extension = recording.file_extension || "mp4";
        const mime = recording.file_mime || "video/mp4";
        const stored = await saveRecordingBuffer(buffer, extension, mime);
        await updateRecordingFile(recording.id, stored.path, recording.duration_seconds);
        recordingFilePath = stored.path;
        recordingExtension = extension;
      } else {
        throw new Error("Unsupported provider");
      }
    }

    const transcriptRecord = await getTranscriptByRecordingId(recording.id);
    let transcriptSegments: { speaker: string; start: number; end: number; text: string }[] = [];
    let transcriptText = "";

    if (!transcriptRecord) {
      if (!recordingFilePath) {
        throw new Error("Recording file path missing");
      }
      const filename = `recording.${recordingExtension}`;
      const transcript = await transcribeRecording(recordingFilePath, filename);
      transcriptSegments = transcript.segments.map((seg: any) => ({
        speaker: seg.speaker || "Speaker",
        start: seg.start || 0,
        end: seg.end || 0,
        text: seg.text || ""
      }));
      transcriptText = transcript.text;

      await createTranscript({
        recording_id: recording.id,
        provider: "openai",
        content_json: transcriptSegments,
        content_text: transcriptText
      });
    } else {
      transcriptSegments = Array.isArray(transcriptRecord.content_json)
        ? (transcriptRecord.content_json as any)
        : [];
      transcriptText = transcriptRecord.content_text || "";
    }

    let attendees: any[] = [];
    if (Array.isArray(meeting.attendees)) {
      attendees = meeting.attendees as any[];
    } else if (typeof meeting.attendees === "string") {
      try {
        attendees = JSON.parse(meeting.attendees) as any[];
      } catch {
        attendees = [];
      }
    }
    const attendeeList = attendees
      .map((att) => ({ name: att.name || att.email || "Unknown", email: att.email || "" }))
      .filter((att) => Boolean(att.email));

    if (attendeeList.length === 0 && meeting.organizer_email) {
      attendeeList.push({
        name: meeting.organizer_name || meeting.organizer_email,
        email: meeting.organizer_email
      });
    }

    const nextMeetingDate = inferNextMeetingDate(meeting.start_time);

    const outcomes = await extractMeetingOutcomes({
      meeting: {
        id: meeting.id,
        title: meeting.title,
        start_time: meeting.start_time,
        timezone: meeting.timezone,
        organizer: { name: meeting.organizer_name, email: meeting.organizer_email },
        attendees: attendeeList,
        next_meeting_date: nextMeetingDate
      },
      transcript: transcriptSegments.length ? transcriptSegments : [{ speaker: "Speaker", start: 0, end: 0, text: transcriptText }]
    });

    const normalized = normalizeOutcomes(outcomes, attendeeList, nextMeetingDate, meeting.title);

    await createArtifact({
      meeting_id: meeting.id,
      decisions: normalized.decisions,
      action_items: normalized.action_items,
      followups: normalized.followups,
      internal_notes: normalized.internal_notes
    });

    if (meeting.organizer_email) {
      const meetingDate = meeting.start_time ? dayjs(meeting.start_time).format("YYYY-MM-DD") : null;
      await sendOrganizerEmail({
        organizerName: meeting.organizer_name,
        organizerEmail: meeting.organizer_email,
        meetingTitle: meeting.title,
        meetingDate,
        decisions: normalized.decisions,
        actionItems: normalized.action_items,
        followups: normalized.followups
      });
    }

    await updateRecordingStatus(recordingId, "emailed");
  } catch (err) {
    throw err;
  }
}
