import dotenv from "dotenv";
import { z } from "zod";

let cachedEnv: Env | null = null;

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  BASE_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_PATH: z.string().default("storage"),
  S3_ENDPOINT: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_REGION: z.string().optional(),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  WHISPER_MODEL: z.string().default("whisper-1"),
  TRANSCRIBE_MAX_BYTES: z.coerce.number().default(24 * 1024 * 1024),
  TRANSCRIBE_SEGMENT_SECONDS: z.coerce.number().default(300),
  TRANSCRIBE_RESPONSE_FORMAT: z.enum(["json", "verbose_json", "text", "srt", "vtt"]).default("json"),
  EMAIL_PROVIDER: z.enum(["smtp", "postmark"]).default("smtp"),
  EMAIL_FROM: z.string().email(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  POSTMARK_API_KEY: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REDIRECT_URI: z.string().url(),
  ZOOM_CLIENT_ID: z.string().min(1),
  ZOOM_CLIENT_SECRET: z.string().min(1),
  ZOOM_REDIRECT_URI: z.string().url(),
  ZOOM_WEBHOOK_SECRET_TOKEN: z.string().optional(),
  MEET_SYNC_LOOKBACK_HOURS: z.coerce.number().default(24),
  INTERNAL_API_KEY: z.string().optional()
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  if (cachedEnv) return cachedEnv;
  dotenv.config();
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment:\n${issues}`);
  }
  cachedEnv = parsed.data;
  return cachedEnv;
}
