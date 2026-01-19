import OpenAI from "openai";
import { z } from "zod";
import { loadEnv } from "../config.js";

const env = loadEnv();
const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

const outputSchema = z.object({
  decisions: z.array(
    z.object({
      topic: z.string(),
      items: z.array(
        z.object({
          text: z.string(),
          explicit: z.boolean(),
          confidence: z.number().min(0).max(1)
        })
      )
    })
  ),
  action_items: z.array(
    z.object({
      text: z.string(),
      owner: z.object({
        name: z.string(),
        email: z.string().email()
      }),
      deadline: z.string(),
      deadline_inferred: z.boolean(),
      confidence: z.number().min(0).max(1)
    })
  ),
  followups: z.array(
    z.object({
      to: z.object({
        name: z.string(),
        email: z.string().email()
      }),
      subject: z.string(),
      body: z.string()
    })
  ),
  internal_notes: z.object({
    omitted_actions: z.array(z.string()),
    ambiguities: z.array(z.string())
  })
});

export type ExtractionResult = z.infer<typeof outputSchema>;

export async function extractMeetingOutcomes(input: {
  meeting: {
    id: string;
    title: string | null;
    start_time: string | null;
    timezone: string | null;
    organizer: { name: string | null; email: string | null };
    attendees: { name: string; email: string }[];
    next_meeting_date: string | null;
  };
  transcript: { speaker: string; start: number; end: number; text: string }[];
}): Promise<ExtractionResult> {
  const attendeeList = input.meeting.attendees
    .map((a) => `${a.name} <${a.email}>`)
    .join(", ");

  const transcriptBlock = input.transcript
    .map((t) => `${t.speaker}: ${t.text}`)
    .join("\n");
  const maxChars = 60000;
  const trimmedTranscript = transcriptBlock.length > maxChars
    ? transcriptBlock.slice(transcriptBlock.length - maxChars)
    : transcriptBlock;

  const prompt = `You extract decisions, action items, and follow-up drafts from meeting transcripts.

Rules:
- Decisions are in past tense and grouped by topic.
- Action items start with a verb and must have an owner from the attendee list.
- Deadlines must be YYYY-MM-DD. If no deadline is mentioned, infer it as the next meeting date if provided.
- If the owner is unclear, omit the action item and add it to internal_notes.omitted_actions.
- Do not include transcript quotes in any user-facing field.

Attendees: ${attendeeList || "None"}
Meeting title: ${input.meeting.title || "Untitled"}
Meeting start: ${input.meeting.start_time || "Unknown"}
Meeting timezone: ${input.meeting.timezone || "Unknown"}
Next meeting date: ${input.meeting.next_meeting_date || "Unknown"}

Transcript:
${trimmedTranscript}`;

  const response = await openai.responses.create({
    model: env.OPENAI_MODEL,
    input: [
      { role: "system", content: "You are a precise meeting outcomes extractor." },
      { role: "user", content: prompt }
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "meeting_outcomes",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            decisions: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  topic: { type: "string" },
                  items: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        text: { type: "string" },
                        explicit: { type: "boolean" },
                        confidence: { type: "number" }
                      },
                      required: ["text", "explicit", "confidence"]
                    }
                  }
                },
                required: ["topic", "items"]
              }
            },
            action_items: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  text: { type: "string" },
                  owner: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      name: { type: "string" },
                      email: { type: "string" }
                    },
                    required: ["name", "email"]
                  },
                  deadline: { type: "string" },
                  deadline_inferred: { type: "boolean" },
                  confidence: { type: "number" }
                },
                required: ["text", "owner", "deadline", "deadline_inferred", "confidence"]
              }
            },
            followups: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  to: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      name: { type: "string" },
                      email: { type: "string" }
                    },
                    required: ["name", "email"]
                  },
                  subject: { type: "string" },
                  body: { type: "string" }
                },
                required: ["to", "subject", "body"]
              }
            },
            internal_notes: {
              type: "object",
              additionalProperties: false,
              properties: {
                omitted_actions: { type: "array", items: { type: "string" } },
                ambiguities: { type: "array", items: { type: "string" } }
              },
              required: ["omitted_actions", "ambiguities"]
            }
          },
          required: ["decisions", "action_items", "followups", "internal_notes"]
        }
      }
    }
  });

  const content = response.output_text || "{}";
  const parsed = outputSchema.safeParse(JSON.parse(content));
  if (!parsed.success) {
    throw new Error(`Extraction failed: ${parsed.error.message}`);
  }

  return parsed.data;
}
