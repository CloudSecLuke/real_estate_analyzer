// Greene County, OH ingestion (single-source facts + geometry).
//   npm run data:ingest:greene              # full residential sweep
//   npm run data:ingest:greene -- --limit 2000
//   npm run data:ingest:greene -- --offset 40000
import { existsSync, readFileSync } from "node:fs";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_0-9]+)="?([^"]*)"?$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

import { ingestGreene } from "../lib/data/providers/greene/parcels";

async function main() {
  const l = process.argv.indexOf("--limit");
  const o = process.argv.indexOf("--offset");
  const r = await ingestGreene({
    maxRecords: l >= 0 ? Number(process.argv[l + 1]) : undefined,
    startOffset: o >= 0 ? Number(process.argv[o + 1]) : undefined,
  });
  console.log(JSON.stringify(r, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
