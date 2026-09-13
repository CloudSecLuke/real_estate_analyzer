import { NextRequest, NextResponse } from "next/server";
import { getUserState, isDbConfigured, saveUserState } from "@/lib/db";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import type { SavedPin } from "@/lib/types";

// Per-user persisted state (map pins + assumptions). proxy.ts already gates
// these routes, but re-verify here so the user identity comes from the
// signed cookie, never from the request body.
async function sessionUser(req: NextRequest): Promise<string | null> {
  return verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
}

export async function GET(req: NextRequest) {
  const user = await sessionUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isDbConfigured()) {
    return NextResponse.json({
      user,
      persistent: false,
      pins: [],
      assumptions: null,
    });
  }
  try {
    const state = await getUserState(user);
    return NextResponse.json({ user, persistent: true, ...state });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Database error";
    return NextResponse.json(
      { user, persistent: false, pins: [], assumptions: null, error: message },
      { status: 200 }
    );
  }
}

export async function PUT(req: NextRequest) {
  const user = await sessionUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isDbConfigured()) {
    return NextResponse.json(
      { error: "Persistence is not configured (DATABASE_URL missing)." },
      { status: 503 }
    );
  }
  let pins: SavedPin[];
  let assumptions;
  try {
    const body = await req.json();
    if (!Array.isArray(body.pins)) throw new Error("pins must be an array");
    pins = body.pins;
    assumptions = body.assumptions ?? null;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Invalid JSON body";
    return NextResponse.json({ error: message }, { status: 400 });
  }
  try {
    await saveUserState(user, { pins, assumptions });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Database error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
