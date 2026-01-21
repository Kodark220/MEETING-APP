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

type TranscriptResult = {
  text: string;
  segments: any[];
};

function guessContentType(filename: string) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".webm")) return "audio/webm";
  return "application/octet-stream";
}

function isQuotaError(err: unknown) {
  if (!err || typeof err !== "object") return false;
  const anyErr = err as { status?: number; error?: { code?: string; type?: string }; code?: string; message?: string };
  if (anyErr.status === 429) return true;
  if (anyErr.code === "insufficient_quota") return true;
  if (anyErr.error?.code === "insufficient_quota") return true;
  if (anyErr.error?.type === "insufficient_quota") return true;
  if (typeof anyErr.message === "string" && anyErr.message.includes("insufficient_quota")) return true;
  return false;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function transcribeWithOpenAI(fileBuffer: Buffer, filename: string): Promise<TranscriptResult> {
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
}

async function transcribeWithDeepgram(fileBuffer: Buffer, contentType: string): Promise<TranscriptResult> {
  if (!env.DEEPGRAM_API_KEY) {
    throw new Error("DEEPGRAM_API_KEY is not set");
  }
  const url = new URL("https://api.deepgram.com/v1/listen");
  url.searchParams.set("model", env.DEEPGRAM_MODEL);
  url.searchParams.set("punctuate", "true");
  url.searchParams.set("smart_format", "true");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Token ${env.DEEPGRAM_API_KEY}`,
      "Content-Type": contentType
    },
    body: new Uint8Array(fileBuffer)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Deepgram error ${response.status}: ${text}`);
  }

  const data = await response.json() as {
    results?: {
      channels?: { alternatives?: { transcript?: string }[] }[];
    };
  };

  const transcriptText = data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";
  return { text: transcriptText, segments: [] };
}

async function transcribeWithAssemblyAI(fileBuffer: Buffer, contentType: string): Promise<TranscriptResult> {
  if (!env.ASSEMBLYAI_API_KEY) {
    throw new Error("ASSEMBLYAI_API_KEY is not set");
  }

  const uploadRes = await fetch("https://api.assemblyai.com/v2/upload", {
    method: "POST",
    headers: {
      authorization: env.ASSEMBLYAI_API_KEY,
      "content-type": contentType
    },
    body: new Uint8Array(fileBuffer)
  });

  if (!uploadRes.ok) {
    const text = await uploadRes.text();
    throw new Error(`AssemblyAI upload error ${uploadRes.status}: ${text}`);
  }

  const uploadData = await uploadRes.json() as { upload_url?: string };
  if (!uploadData.upload_url) {
    throw new Error("AssemblyAI upload missing upload_url");
  }

  const transcriptRes = await fetch("https://api.assemblyai.com/v2/transcript", {
    method: "POST",
    headers: {
      authorization: env.ASSEMBLYAI_API_KEY,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      audio_url: uploadData.upload_url,
      punctuate: true,
      format_text: true
    })
  });

  if (!transcriptRes.ok) {
    const text = await transcriptRes.text();
    throw new Error(`AssemblyAI transcript error ${transcriptRes.status}: ${text}`);
  }

  const transcriptData = await transcriptRes.json() as { id?: string };
  if (!transcriptData.id) {
    throw new Error("AssemblyAI transcript missing id");
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < env.ASSEMBLYAI_TIMEOUT_MS) {
    const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptData.id}`, {
      headers: { authorization: env.ASSEMBLYAI_API_KEY }
    });
    if (!pollRes.ok) {
      const text = await pollRes.text();
      throw new Error(`AssemblyAI poll error ${pollRes.status}: ${text}`);
    }
    const pollData = await pollRes.json() as { status?: string; text?: string; error?: string };
    if (pollData.status === "completed") {
      return { text: pollData.text || "", segments: [] };
    }
    if (pollData.status === "error") {
      throw new Error(`AssemblyAI error: ${pollData.error || "unknown"}`);
    }
    await sleep(env.ASSEMBLYAI_POLL_INTERVAL_MS);
  }

  throw new Error("AssemblyAI transcription timed out");
}

function getProviderOrder() {
  const order = env.TRANSCRIBE_PROVIDER === "assemblyai"
    ? ["assemblyai", "openai", "deepgram"]
    : env.TRANSCRIBE_PROVIDER === "deepgram"
      ? ["deepgram", "openai", "assemblyai"]
      : ["openai", "assemblyai", "deepgram"];

  return order.filter((provider) => {
    if (provider === "assemblyai") {
      return Boolean(env.ASSEMBLYAI_API_KEY);
    }
    if (provider === "deepgram") {
      return Boolean(env.DEEPGRAM_API_KEY);
    }
    return true;
  });
}

async function transcribeWithFallback(fileBuffer: Buffer, filename: string, contentType: string): Promise<TranscriptResult> {
  const order = getProviderOrder();
  let lastErr: unknown = null;
  for (const provider of order) {
    try {
      if (provider === "openai") {
        return await transcribeWithOpenAI(fileBuffer, filename);
      }
      if (provider === "assemblyai") {
        return await transcribeWithAssemblyAI(fileBuffer, contentType);
      }
      return await transcribeWithDeepgram(fileBuffer, contentType);
    } catch (err) {
      lastErr = err;
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`Transcription with ${provider} failed: ${message}`);
      if (provider === "openai" && !isQuotaError(err) && order.length === 1) {
        throw err;
      }
    }
  }

  throw lastErr ?? new Error("Transcription failed");
}

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
  const providerOrder = getProviderOrder();
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
        const segmentBuffer = await readFile(segmentPath);
        const contentType = guessContentType(segmentName);
        const segmentResult = await transcribeWithFallback(segmentBuffer, segmentName, contentType);

        combinedText += `${segmentResult.text}\n`;
        if (segmentResult.segments.length) {
          combinedSegments.push(...segmentResult.segments);
        }
      }

      return {
        text: combinedText.trim(),
        segments: combinedSegments
      };
    }

    const fileBuffer = await readFile(localPath);
    const contentType = guessContentType(filename);
    if (!providerOrder.length) {
      throw new Error("No transcription provider configured");
    }
    return await transcribeWithFallback(fileBuffer, filename, contentType);
  } finally {
    await Promise.all(
      tempDirs.map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined))
    );
  }
}
