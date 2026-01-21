import OpenAI from "openai";
import https from "node:https";
import { toFile } from "openai/uploads";
import { loadEnv } from "../config.js";
import { getRecordingStream } from "./storage.js";
import { withOpenAiRetries } from "./openai-retry.js";

const env = loadEnv();
const openai = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
  maxRetries: 4,
  timeout: 10 * 60 * 1000,
  httpAgent: new https.Agent({ keepAlive: true, family: 4 })
});

export async function transcribeRecording(filePath: string, filename: string) {
  return withOpenAiRetries(async () => {
    const stream = await getRecordingStream(filePath);
    const file = await toFile(stream, filename);

    const transcription = await openai.audio.transcriptions.create({
      file,
      model: env.WHISPER_MODEL,
      response_format: "verbose_json"
    });

    return {
      text: transcription.text || "",
      segments: transcription.segments || []
    };
  }, { attempts: 4, baseDelayMs: 3000, maxDelayMs: 30000 });
}
