import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

// Playwright global teardown: tests name their batteries "E2E …"; remove them (plans cascade)
// so the shared demo database doesn't fill up with test data.
export default async function cleanup() {
  config({ path: ".env.local", quiet: true });
  if (!process.env.DATABASE_URL) return console.warn("e2e cleanup skipped: DATABASE_URL not set");
  const sql = neon(process.env.DATABASE_URL);
  const rows = await sql`delete from battery where name like 'E2E %' returning id`;
  console.log(`e2e cleanup: removed ${rows.length} test batteries`);
}
