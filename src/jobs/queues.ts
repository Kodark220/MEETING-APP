import { Queue } from "bullmq";
import IORedis from "ioredis";
import { loadEnv } from "../config.js";

const env = loadEnv();

export const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
connection.on("connect", () => {
  console.log("Redis connected");
});
connection.on("error", (err) => {
  console.error("Redis connection error", err);
});

export const recordingQueue = new Queue("recording-processing", {
  connection
});

export async function enqueueRecording(recordingId: string) {
  const job = await recordingQueue.add("process-recording", { recordingId }, {
    attempts: 5,
    backoff: { type: "exponential", delay: 30_000 }
  });
  console.log(`Enqueued recording job ${job.id} for ${recordingId}`);
}
