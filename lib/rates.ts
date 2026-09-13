// Current 30-year fixed mortgage average (Freddie Mac PMMS via FRED's
// keyless CSV endpoint). Used to auto-fill the interest-rate assumption
// so analyses don't run on a stale hardcoded default.
const FRED_CSV =
  "https://fred.stlouisfed.org/graph/fredgraph.csv?id=MORTGAGE30US";

export interface MortgageRate {
  pct: number;
  asOf: string; // e.g. "2026-09-10"
}

export async function getMortgageRate(): Promise<MortgageRate | null> {
  const res = await fetch(FRED_CSV, { next: { revalidate: 86400 } });
  if (!res.ok) return null;
  const text = await res.text();
  const lines = text.trim().split("\n");
  for (let i = lines.length - 1; i > 0; i--) {
    const [date, value] = lines[i].split(",");
    const pct = Number(value);
    if (Number.isFinite(pct) && pct > 0.5 && pct < 25) {
      return { pct, asOf: date };
    }
  }
  return null;
}
