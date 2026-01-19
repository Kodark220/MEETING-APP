import { Pool } from "pg";
import { loadEnv } from "./config.js";

const env = loadEnv();

export const pool = new Pool({
  connectionString: env.DATABASE_URL
});

export async function query<T = unknown>(text: string, params?: unknown[]): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}

export async function withClient<T>(fn: (client: import("pg").PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
