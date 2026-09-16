// Hamilton County parcel ingestion runner.
// Usage: npm run data:ingest:hamilton -- --limit 100   (omit limit = full)
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_0-9]+)="?([^"]*)"?$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

import { ingestHamiltonParcels } from "../lib/data/providers/hamilton/parcels";

async function main() {
  const limitArg = process.argv.indexOf("--limit");
  const maxRecords = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : undefined;
  const offsetArg = process.argv.indexOf("--offset");
  const startOffset = offsetArg >= 0 ? Number(process.argv[offsetArg + 1]) : undefined;
  console.log(`ingesting Hamilton County parcels${maxRecords ? ` (limit ${maxRecords})` : " (full)"}...`);
  const r = await ingestHamiltonParcels({ maxRecords, startOffset });
  console.log(JSON.stringify(r, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
