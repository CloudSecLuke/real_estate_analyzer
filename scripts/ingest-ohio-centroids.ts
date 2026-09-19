// GeOhio statewide centroid sweep for an owned Ohio market.
//   npm run data:ingest:oh-centroids -- --county Greene --market greene_county_oh
//   [--limit N] [--offset N]
import { existsSync, readFileSync } from "node:fs";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_0-9]+)="?([^"]*)"?$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

import { ingestOhioCentroids } from "../lib/data/providers/ohio/statewideCentroids";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const county = arg("--county");
  const marketId = arg("--market");
  if (!county || !marketId) throw new Error("--county and --market are required");
  const r = await ingestOhioCentroids({
    county,
    marketId,
    maxRecords: arg("--limit") ? Number(arg("--limit")) : undefined,
    startOffset: arg("--offset") ? Number(arg("--offset")) : undefined,
  });
  console.log(JSON.stringify(r, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
