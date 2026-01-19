import { Worker } from "bullmq";
import { connection } from "./queues.js";
import { processRecording } from "./processRecording.js";
import { updateRecordingStatus } from "../services/store.js";

const worker = new Worker(
  "recording-processing",
  async (job) => {
    if (job.name === "process-recording") {
      await processRecording(job.data.recordingId);
    }
  },
  { connection }
);

worker.on("completed", (job) => {
  console.log(`Job completed: ${job.id}`);
});

worker.on("failed", (job, err) => {
  console.error(`Job failed: ${job?.id}`, err);
  if (job?.data?.recordingId) {
    const attempts = job.opts.attempts || 1;
    if (job.attemptsMade >= attempts) {
      updateRecordingStatus(job.data.recordingId, "failed").catch((updateErr) => {
        console.error("Failed to update recording status", updateErr);
      });
    }
  }
});
