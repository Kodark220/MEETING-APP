type RetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
};

const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);
const RETRYABLE_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
  "ECONNREFUSED",
  "EPIPE"
]);

function getStatus(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const anyErr = err as { status?: number; cause?: { status?: number } };
  if (typeof anyErr.status === "number") return anyErr.status;
  if (typeof anyErr.cause?.status === "number") return anyErr.cause.status;
  return undefined;
}

function getCode(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const anyErr = err as { code?: string; cause?: { code?: string } };
  if (typeof anyErr.code === "string") return anyErr.code;
  if (typeof anyErr.cause?.code === "string") return anyErr.cause.code;
  return undefined;
}

function getMessage(err: unknown): string {
  if (!err || typeof err !== "object") return "";
  const anyErr = err as { message?: string };
  return typeof anyErr.message === "string" ? anyErr.message : "";
}

function isRetryable(err: unknown): boolean {
  const status = getStatus(err);
  if (status && RETRYABLE_STATUS.has(status)) return true;
  const code = getCode(err);
  if (code && RETRYABLE_CODES.has(code)) return true;
  const message = getMessage(err);
  return message.includes("ECONNRESET") || message.includes("ETIMEDOUT");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withOpenAiRetries<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const attempts = options.attempts ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 2000;
  const maxDelayMs = options.maxDelayMs ?? 20000;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      const isLastAttempt = attempt >= attempts - 1;
      if (isLastAttempt || !isRetryable(err)) {
        throw err;
      }
      const jitter = Math.floor(Math.random() * 250);
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt) + jitter;
      await sleep(delay);
    }
  }

  throw new Error("OpenAI request failed after retries.");
}
