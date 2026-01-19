import dayjs from "dayjs";
import { ExtractionResult } from "./extraction.js";

const deadlineFormat = "YYYY-MM-DD";
const deadlineRegex = /^\\d{4}-\\d{2}-\\d{2}$/;

export function inferNextMeetingDate(startTime: string | null): string {
  if (!startTime) {
    return dayjs().add(7, "day").format(deadlineFormat);
  }
  return dayjs(startTime).add(7, "day").format(deadlineFormat);
}

export function normalizeOutcomes(
  outcomes: ExtractionResult,
  attendees: { name: string; email: string }[],
  nextMeetingDate: string | null,
  meetingTitle: string | null
): ExtractionResult {
  const attendeeEmails = new Set(attendees.map((a) => a.email.toLowerCase()));

  const normalizedActions = outcomes.action_items
    .filter((item) => attendeeEmails.has(item.owner.email.toLowerCase()))
    .map((item) => {
      const isValid = deadlineRegex.test(item.deadline) && dayjs(item.deadline).isValid();
      if (!isValid) {
        const inferred = nextMeetingDate || inferNextMeetingDate(null);
        return { ...item, deadline: inferred, deadline_inferred: true };
      }
      return item;
    });

  const followupMap = new Map<string, ExtractionResult["followups"][number]>();
  for (const followup of outcomes.followups) {
    if (attendeeEmails.has(followup.to.email.toLowerCase())) {
      followupMap.set(followup.to.email.toLowerCase(), followup);
    }
  }

  for (const item of normalizedActions) {
    if (!followupMap.has(item.owner.email.toLowerCase())) {
      const subject = `Follow-up from ${meetingTitle || "today's meeting"}`;
      const body = `Hey ${item.owner.name} - from today\'s meeting, you\'re owning ${item.text} by ${item.deadline}. Let me know if anything\'s blocking you.`;
      followupMap.set(item.owner.email.toLowerCase(), {
        to: item.owner,
        subject,
        body
      });
    }
  }

  return {
    ...outcomes,
    action_items: normalizedActions,
    followups: Array.from(followupMap.values())
  };
}
