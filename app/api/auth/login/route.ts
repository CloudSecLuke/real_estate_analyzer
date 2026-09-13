import { NextRequest, NextResponse } from "next/server";
import { verifyCredentials } from "@/lib/auth";
import {
  createSessionToken,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
} from "@/lib/session";

export async function POST(req: NextRequest) {
  let username = "";
  let password = "";
  try {
    const body = await req.json();
    username = String(body.username ?? "").trim().toLowerCase();
    password = String(body.password ?? "");
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!verifyCredentials(username, password)) {
    return NextResponse.json(
      { error: "Invalid username or password." },
      { status: 401 }
    );
  }

  const res = NextResponse.json({ user: username });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(username), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
