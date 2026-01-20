import { Queue } from "bullmq";
import IORedis from "ioredis";
import { loadEnv } from "../config.js";

const env = loadEnv();

export const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

export const recordingQueue = new Queue("recording-processing", {
  connection
});

export async function enqueueRecording(recordingId: string) {
  await recordingQueue.add("process-recording", { recordingId }, {
    attempts: 5,
    backoff: { type: "exponential", delay: 30_000 }
  });
}
