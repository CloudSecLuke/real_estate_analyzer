import { sql } from "@/lib/sql";
import type { ProviderCall } from "@/lib/providerCache";

// Persisted analyses (CLAUDE_CODE_BRIEF Phase 4 step 4). Every pencil is
// recorded: reproducibility (formula_version + full result snapshot),
// repeat-analysis economics, and the market-demand signal that decides
// which county gets owned coverage next. The insert must never fail the
// user's request — callers wrap it like recordPencil.

export interface AnalysisRecord {
  username: string;
  addressInput: string;
  matchedAddress?: string | null;
  countyFips?: string | null;
  state?: string | null;
  inputs: unknown;
  result: unknown;
  formulaVersion: string;
  providerCalls: ProviderCall[];
}

// Injectable for tests; defaults to the shared HTTP client.
type SqlRunner = ReturnType<typeof sql>;

export async function recordAnalysis(
  a: AnalysisRecord,
  runner: SqlRunner = sql()
): Promise<void> {
  const cost = a.providerCalls.reduce((s, c) => s + c.costCents, 0);
  await runner`
    INSERT INTO analyses
      (username, address_input, matched_address, county_fips, state,
       inputs, result, formula_version, provider_calls, provider_cost_cents)
    VALUES
      (${a.username}, ${a.addressInput}, ${a.matchedAddress ?? null},
       ${a.countyFips ?? null}, ${a.state ?? null},
       ${JSON.stringify(a.inputs)}::jsonb, ${JSON.stringify(a.result)}::jsonb,
       ${a.formulaVersion}, ${JSON.stringify(a.providerCalls)}::jsonb, ${cost})
  `;
}

function isoDate(v: unknown): string {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

export interface HamiltonFacts {
  propertyId: string;
  streetAddress: string | null;
  city: string | null;
  postalCode: string | null;
  livingAreaSqft: number | null;
  baths: number | null;
  yearBuilt: number | null;
  annualTaxes: number | null; // dollars/yr
  assessedValue: number | null; // dollars
  lastSaleDate: string | null;
  lastSalePrice: number | null; // dollars
  rentalRegistered: boolean | null;
  factsAsOf: string | null;
}

/** Hamilton short-circuit lookup (Phase 4 step 5): geocoded street line →
 *  owned auditor-backed property. Exact normalized street match first,
 *  ZIP-scoped; the fuzzy matcher is deliberately NOT used here — a wrong
 *  bulk match is worse than a paid provider call. */
export async function findHamiltonFacts(
  streetLine: string,
  zip: string | null,
  runner: SqlRunner = sql()
): Promise<HamiltonFacts | null> {
  const norm = streetLine.toUpperCase().replace(/\s+/g, " ").trim();
  const rows = (await runner`
    SELECT p.id, p.street_address, p.city, p.postal_code,
           p.living_area_sqft, p.baths, p.year_built,
           p.annual_taxes_cents, p.assessed_value_cents,
           p.last_sale_date, p.last_sale_cents, p.rental_registered,
           p.facts_as_of
    FROM properties p
    WHERE p.market_id = 'hamilton_county_oh'
      AND p.street_address = ${norm}
      AND (${zip}::text IS NULL OR p.postal_code IS NULL OR p.postal_code = ${zip})
    LIMIT 2
  `) as Record<string, unknown>[];
  if (rows.length !== 1) return null; // ambiguous or missing → no shortcut
  const r = rows[0];
  return {
    propertyId: String(r.id),
    streetAddress: (r.street_address as string) ?? null,
    city: (r.city as string) ?? null,
    postalCode: (r.postal_code as string) ?? null,
    livingAreaSqft: r.living_area_sqft == null ? null : Number(r.living_area_sqft),
    baths: r.baths == null ? null : Number(r.baths),
    yearBuilt: r.year_built == null ? null : Number(r.year_built),
    annualTaxes: r.annual_taxes_cents == null ? null : Number(r.annual_taxes_cents) / 100,
    assessedValue: r.assessed_value_cents == null ? null : Number(r.assessed_value_cents) / 100,
    lastSaleDate: r.last_sale_date == null ? null : isoDate(r.last_sale_date),
    lastSalePrice: r.last_sale_cents == null ? null : Number(r.last_sale_cents) / 100,
    rentalRegistered: r.rental_registered == null ? null : Boolean(r.rental_registered),
    factsAsOf: r.facts_as_of == null ? null : isoDate(r.facts_as_of),
  };
}
