import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { createReadStream } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { loadEnv } from "../config.js";

export type StoredFile = {
  path: string;
  storage: "local" | "s3";
  contentType?: string | null;
};

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (s3Client) return s3Client;
  const env = loadEnv();
  s3Client = new S3Client({
    region: "us-east-1",
    endpoint: env.S3_ENDPOINT || undefined,
    credentials: env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY ? {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY
    } : undefined
  });
  return s3Client;
}

export async function saveRecordingBuffer(buffer: ArrayBuffer | Uint8Array, extension: string, contentType: string): Promise<StoredFile> {
  const env = loadEnv();
  const filename = `${Date.now()}-${randomUUID()}.${extension}`;
  const payload = Buffer.isBuffer(buffer)
    ? buffer
    : buffer instanceof ArrayBuffer
      ? Buffer.from(buffer)
      : Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  if (env.STORAGE_DRIVER === "s3") {
    if (!env.S3_BUCKET) {
      throw new Error("S3_BUCKET is required for s3 storage");
    }
    const key = `recordings/${filename}`;
    const client = getS3Client();
    await client.send(new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: payload,
      ContentType: contentType
    }));
    return { path: `s3://${env.S3_BUCKET}/${key}`, storage: "s3", contentType };
  }

  const dir = join(process.cwd(), env.STORAGE_LOCAL_PATH, "recordings");
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, filename);
  await writeFile(filePath, payload);
  return { path: filePath, storage: "local", contentType };
}

export async function getRecordingStream(storedPath: string) {
  const env = loadEnv();
  if (env.STORAGE_DRIVER === "s3") {
    if (!env.S3_BUCKET) {
      throw new Error("S3_BUCKET is required for s3 storage");
    }
    const prefix = `s3://${env.S3_BUCKET}/`;
    if (!storedPath.startsWith(prefix)) {
      throw new Error("Unexpected S3 path");
    }
    const key = storedPath.slice(prefix.length);
    const client = getS3Client();
    const res = await client.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    if (!res.Body) {
      throw new Error("S3 object has no body");
    }
    return res.Body as NodeJS.ReadableStream;
  }

  return createReadStream(storedPath);
}
