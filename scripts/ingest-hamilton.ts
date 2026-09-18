// Hamilton County CAGIS centroid sweep (centroids ONLY — facts come from
// npm run data:ingest:hc-auditor). Usage:
//   npm run data:ingest:hamilton              # full sweep
//   npm run data:ingest:hamilton -- --limit 5000
import { existsSync, readFileSync } from "node:fs";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_0-9]+)="?([^"]*)"?$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

import { ingestHamiltonCentroids } from "../lib/data/providers/hamilton/parcels";

async function main() {
  const i = process.argv.indexOf("--limit");
  const maxRecords = i >= 0 ? Number(process.argv[i + 1]) : undefined;
  const o = process.argv.indexOf("--offset");
  const startOffset = o >= 0 ? Number(process.argv[o + 1]) : undefined;
  console.log(`sweeping CAGIS centroids${maxRecords ? ` (limit ${maxRecords})` : ""}${startOffset ? ` from offset ${startOffset}` : ""}...`);
  const r = await ingestHamiltonCentroids({ maxRecords, startOffset });
  console.log(JSON.stringify(r, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
