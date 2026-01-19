import OpenAI from "openai";
import { toFile } from "openai/uploads";
import { loadEnv } from "../config.js";
import { getRecordingStream } from "./storage.js";

const env = loadEnv();
const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

export async function transcribeRecording(filePath: string, filename: string) {
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
}
