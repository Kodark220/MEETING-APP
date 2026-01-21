import OpenAI from "openai";
import https from "node:https";
import { toFile } from "openai/uploads";
import { createReadStream, createWriteStream } from "fs";
import { mkdir, readdir, readFile, rm, stat } from "fs/promises";
import { tmpdir } from "os";
import { basename, dirname, join } from "path";
import { pipeline } from "stream/promises";
import { spawn } from "child_process";
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

const transcribeClient = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
  maxRetries: 0,
  timeout: env.TRANSCRIBE_TIMEOUT_MS,
  httpAgent: new https.Agent({ keepAlive: false, family: 4 })
});

async function runFfmpeg(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", (err) => {
      reject(new Error(`ffmpeg failed: ${err.message}`));
    });
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg failed with code ${code}: ${stderr.slice(-500)}`));
      }
    });
  });
}

async function streamToFile(source: NodeJS.ReadableStream, filePath: string) {
  await mkdir(dirname(filePath), { recursive: true });
  const dest = createWriteStream(filePath);
  await pipeline(source, dest);
}

async function getLocalPath(filePath: string, filename: string, tempDirs: string[]) {
  if (!filePath.startsWith("s3://")) {
    return filePath;
  }
  const dir = join(tmpdir(), `meeting-audio-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const localPath = join(dir, basename(filename));
  const stream = await getRecordingStream(filePath);
  await streamToFile(stream, localPath);
  return localPath;
}

export async function transcribeRecording(filePath: string, filename: string) {
  const tempDirs: string[] = [];
  try {
    const localPath = await getLocalPath(filePath, filename, tempDirs);
    const fileInfo = await stat(localPath);
    const maxBytes = env.TRANSCRIBE_MAX_BYTES;
    console.log(`Transcription source size: ${fileInfo.size} bytes`);

    if (fileInfo.size > maxBytes) {
      console.log(`Audio exceeds ${maxBytes} bytes, splitting into segments`);
      const segmentDir = join(tmpdir(), `meeting-segments-${Date.now()}`);
      await mkdir(segmentDir, { recursive: true });
      tempDirs.push(segmentDir);
      const outputPattern = join(segmentDir, "chunk-%03d.mp3");
      await runFfmpeg([
        "-y",
        "-i",
        localPath,
        "-ac",
        "1",
        "-ar",
        "16000",
        "-b:a",
        "32k",
        "-f",
        "segment",
        "-segment_time",
        String(env.TRANSCRIBE_SEGMENT_SECONDS),
        "-reset_timestamps",
        "1",
        outputPattern
      ]);

      const segmentFiles = (await readdir(segmentDir))
        .filter((name) => name.startsWith("chunk-") && name.endsWith(".mp3"))
        .sort();

      if (segmentFiles.length === 0) {
        throw new Error("No audio segments generated");
      }

      let combinedText = "";
      const combinedSegments: any[] = [];

      for (const segmentName of segmentFiles) {
        const segmentPath = join(segmentDir, segmentName);
        const segmentStream = createReadStream(segmentPath);
        const segmentFile = await toFile(segmentStream, segmentName);
        const segmentTranscription = await withOpenAiRetries(async () => {
          return transcribeClient.audio.transcriptions.create({
            file: segmentFile,
            model: env.WHISPER_MODEL,
            response_format: env.TRANSCRIBE_RESPONSE_FORMAT
          });
        }, { attempts: 4, baseDelayMs: 3000, maxDelayMs: 30000 });

        const segmentText = (segmentTranscription as { text?: string }).text || "";
        combinedText += `${segmentText}\n`;
        if (env.TRANSCRIBE_RESPONSE_FORMAT === "verbose_json") {
          const segs = (segmentTranscription as { segments?: any[] }).segments || [];
          combinedSegments.push(...segs);
        }
      }

      return {
        text: combinedText.trim(),
        segments: combinedSegments
      };
    }

    const fileBuffer = await readFile(localPath);
    return withOpenAiRetries(async () => {
      const file = await toFile(fileBuffer, filename);

      const transcription = await transcribeClient.audio.transcriptions.create({
        file,
        model: env.WHISPER_MODEL,
        response_format: env.TRANSCRIBE_RESPONSE_FORMAT
      });

      const transcriptionText = (transcription as { text?: string }).text || "";
      return {
        text: transcriptionText,
        segments: env.TRANSCRIBE_RESPONSE_FORMAT === "verbose_json"
          ? (transcription as { segments?: any[] }).segments || []
          : []
      };
    }, { attempts: 4, baseDelayMs: 3000, maxDelayMs: 30000 });
  } finally {
    await Promise.all(
      tempDirs.map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined))
    );
  }
}
