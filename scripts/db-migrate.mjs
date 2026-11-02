import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required. Set it in Vercel project settings or your shell.");
  process.exit(1);
}
const sql = postgres(url, { max: 1, prepare: false });
const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(here, "..", "db", "schema.sql"), "utf8");
try {
  await sql.unsafe(schema);
  console.log("Migration applied: schema is up to date.");
} catch (err) {
  console.error("Migration failed:", err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
