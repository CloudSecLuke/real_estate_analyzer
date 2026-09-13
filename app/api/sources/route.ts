import { NextResponse } from "next/server";

// Read-only data-source status, derived from which env vars are actually
// set. Drives the sidebar chips and the analyzing screen's skipped states —
// the UI never simulates or toggles these.
export async function GET() {
  return NextResponse.json({
    census: true,
    fema: true,
    hud: Boolean(process.env.HUD_API_TOKEN),
    attom: Boolean(process.env.ATTOM_API_KEY),
    mashvisor: Boolean(process.env.MASHVISOR_API_KEY),
    countyData: Boolean(process.env.CENSUS_API_KEY),
    persistence: Boolean(process.env.DATABASE_URL),
  });
}
