import { NextRequest, NextResponse } from "next/server";
import { getMashvisorCompare } from "@/lib/mashvisor";
import type { CompareRequest } from "@/lib/types";

// On-demand Mashvisor data-fidelity check (~6 API calls) — separate from
// /api/analyze so batch imports and casual analyses don't spend quota.
export async function POST(req: NextRequest) {
  if (!process.env.MASHVISOR_API_KEY) {
    return NextResponse.json(
      { error: "MASHVISOR_API_KEY is not set — add it to .env.local." },
      { status: 400 }
    );
  }

  let body: CompareRequest;
  try {
    body = (await req.json()) as CompareRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.state || !body.zip) {
    return NextResponse.json(
      { error: "state and zip are required" },
      { status: 400 }
    );
  }

  try {
    const result = await getMashvisorCompare(body);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Comparison failed";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
