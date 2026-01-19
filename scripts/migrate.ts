import { Client } from "pg";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import dotenv from "dotenv";

async function main() {
  dotenv.config();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const dir = join(process.cwd(), "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    const sql = readFileSync(join(dir, file), "utf8");
    if (sql.trim().length === 0) continue;
    console.log(`Running ${file}`);
    await client.query(sql);
  }

  await client.end();
  console.log("Migrations complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
