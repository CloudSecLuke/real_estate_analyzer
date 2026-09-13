import { NextResponse } from "next/server";
import { getMortgageRate } from "@/lib/rates";

export async function GET() {
  try {
    const rate = await getMortgageRate();
    return NextResponse.json({ rate });
  } catch {
    return NextResponse.json({ rate: null });
  }
}
