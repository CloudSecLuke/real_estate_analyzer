// Apply the Data Network schema (idempotent). Usage: npm run db:migrate
// Runs against DATABASE_URL from the environment — .env.local is loaded
// here because plain Node scripts don't auto-load it (only Next.js does).
// The lib/dbUrl guard still applies: touching the production DB from a
// local shell requires ALLOW_PROD_DB=1 deliberately.
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_0-9]+)="?([^"]*)"?$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

import { ensureDataSchema } from "../lib/data/schema";

async function main() {
  await ensureDataSchema();
  console.log("data-network schema ensured (markets, data_sources, ingestion_runs, raw_source_records, properties, property_parcels, data_points, data_conflicts, user_property_overrides)");
}

main().catch((e) => { console.error(e); process.exit(1); });
