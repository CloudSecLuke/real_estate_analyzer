# PropPencil Technical Implementation Spec (CANONICAL)

> Founder directive 2026-09-15 ("Part 2 technical contract"), revised
> 2026-09-16 after external review (see Revision section at bottom).
> This is the SINGLE canonical spec. v1/v2 are archived in `archive/`
> and apply only where nothing here contradicts them.

## Reframing vs v2

Nationwide SaaS FIRST: analyze properties anywhere via provider-agnostic
fallbacks; own data progressively in markets where demand justifies it
(Hamilton County = first "deep" market using the SAME provider contracts —
no Cincinnati branches in core code). Not a RentCast wrapper; not
Cincinnati-only; not ETL-before-users. Layers: acquisition → canonical
property → assumptions → underwriting → results → UI.

## Key contracts

- **Money**: integer cents (`MoneyCents`); rates as decimals (0.08=8%);
  never mix conventions. Existing dollar-float engine is legacy — new
  underwriting engine is cents-based pure functions (no IO/React/DB),
  formula-versioned (UNDERWRITING_FORMULA_VERSION etc.), snapshot-persisted
  analyses (reproducible forever).
- **SourcedValue<T>** {value, status verified/estimated/user_entered/
  unavailable/conflicting, confidence 0–1, source ref, methodology,
  alternatives[]}; **AnalysisValue<T>** = userOverride ?? sourcedValue ??
  default with effectiveSource; provenance never deleted. Confidence
  thresholds centralized (85/65/40 → High/Medium/Low/Insufficient).
- **ProviderContext** {requestId, budget, market, forceRefresh, signal} on
  every provider call. **ProviderBudget** (max cost/calls per analysis;
  DATA_PROVIDER_MONTHLY_BUDGET_CENTS, MAX_COST_PER_ANALYSIS_CENTS,
  MAX_CALLS, ALLOW_PAID_PROVIDER_FALLBACK env/config). Budget exhaustion →
  partial analysis + lower confidence + warning, never a crash or "API
  limit exceeded" UX.
- **Provider priority** (configurable): fresh owned/cached → market
  government source → approved public → cached commercial in TTL →
  cheapest commercial → pricier commercial → user input. Freshness policy
  config (facts 90d, parcel 180d, taxes 60d, listing 12h, rent est 14d,
  comps 7d); stale-while-revalidate; assumption changes NEVER trigger
  provider calls (enrichment ≠ recalculation).
- **Source registry** gains status: approved/review_required/restricted/
  disabled — only `approved` usable in production ingestion.
- **Markets**: coverage_level none/basic/standard/deep + per-capability
  source config; Hamilton = deep without special-casing core.
- **Critical fields** (identity, price, beds, type, rent, taxes,
  insurance) vs optional; resolver reports missingCriticalFields +
  needsUserInput.
- **Underwriting formulas** (§44–46): standard amortization (0% safe),
  GPR/vacancy/credit loss/EGI/OpEx (no debt service, income tax,
  depreciation in NOI)/NOI/cash flow/cap (label denominator)/CoC (guard
  zero-denominator)/DSCR (no-debt → null not ∞)/break-even occupancy;
  expense bases explicit (management % of collected rent, not price);
  maintenance ≠ CapEx ≠ immediate repairs. Max-price via bounded binary
  search. Scenario engine adjusts underlying assumptions (conservative:
  rent −5%, vacancy +3pp, maint/capex +15%, ins +10%; configurable), never
  multiplies outputs. Sensitivity matrix generic over variables. Pencil
  Score = explainable summary layer w/ configurable weights (cash flow 25 /
  CoC 20 / DSCR 15 / value position 15 / rent resilience 10 / expense risk
  10 / data confidence 5), grade guardrails (no top grade w/ negative cash
  flow or insufficient confidence), components + positives + risks +
  guardrailsTriggered in output. Risk engine deterministic break-even
  thresholds. NO LLM in any financial calculation.
- **S8/HCV**: separate engine; never one "section8Rent" field — FMR/SAFMR/
  payment standard/gross rent/utility allowance/contract rent/tenant
  contribution/HAP/rent reasonableness distinct; nothing "guaranteed".
- **Security**: SSRF-safe URL handling (protocol allowlist, block private
  IPs/localhost, size/redirect/timeout limits); keys server-side; typed
  errors (PropertyNotFoundError etc.), raw provider errors never shown.
- **UI**: entry = one field (address or listing URL) + Pencil It +
  autocomplete; real progress states; primary result = Does It Pencil /
  grade / monthly cash flow / max purchase price; Show Your Work; Data
  Confidence expandable per-field; What Could Break the Pencil (derived,
  severities); Sharpen the Pencil = instant recalc; overrides everywhere
  ("Use Estimate" vs "Enter My Number"); NEVER display $0 for missing.
- **Demo mode** exercises the REAL pipeline via fixture providers (good
  deal, bad deal, missing rent, conflicting facts, S8, high/low-confidence
  markets); no fake parallel path; no invented data ever.
- **Cost/demand analytics**: provider_requests w/ cost cents + cache_hit;
  market demand metrics (searches, analyses, cost, confidence by
  county/state) → customer-driven market expansion decisions.

## Phase order (v3 §110)

1 domain boundaries → 2 cents-based underwriting engine + tests → 3
resolver (cache/registry/priority/cost/conflicts; mock-first) → 4 entry UI
→ 5 results UI → 6 rent engine → 7 real adapters (wrap existing) → 8
Hamilton deep-market adapter → 9 S8 → 10 cost/demand analytics.

## Acceptance scenarios (abridged)

Atlanta address works with zero owned data (fallback providers/cache/user
input); Hamilton looks identical but cheaper + higher confidence; repeat
analysis reuses cache with zero provider calls on assumption changes;
budget exhaustion degrades gracefully; conflicting beds → both kept +
resolution recorded + overridable; $7,800 outlier comp handled; interest
rate change recalcs everything instantly; min-cash-flow target → traceable
max purchase price.

## Status when v3 arrived (2026-09-15)

Already built and conformant: Stage 1 foundation schema (data_sources —
needs status column, markets, ingestion_runs, raw_source_records,
properties, data_points, conflicts, overrides; PostGIS), Stage 2 address
normalization + 5-level matcher, provider capability layer + registry +
mock/RentCast/Regrid/ATTOM adapters (lib/providers), Hamilton County
parcel provider smoke-verified (10 real parcels ingested, idempotent
re-run = 0 dupes; CAGIS ArcGIS endpoint + as-is license recorded in
data_sources). Legacy analyze pipeline (lib/metrics etc.) keeps serving
production until the new engine replaces it.

## Revision 2026-09-16 (external review — implemented in CLAUDE_CODE_BRIEF phases)

- **Bulk government facts live in typed tables** (`auditor_parcels`,
  `auditor_dwellings`, `auditor_sales`, typed columns on `properties`)
  with row-level provenance (`facts_source_id`, `facts_as_of`,
  `content_hash`). `data_points` is reserved for cross-source conflicts
  and user overrides only — never for every fact.
- **Raw payloads are not stored for government bulk sources.** The loader
  records file sha256 + as-of date in `ingestion_runs.metadata`; keep the
  source xlsx in object storage if reprocessability is wanted.
  `raw_source_records` remains for paid-provider payloads where terms
  permit.
- **`provider_cache` replaces the Next.js Data Cache** for every external
  call (visible, deploy-surviving, cost-accounted; expired rows deleted
  nightly; commercial responses never outlive their TTL). **`analyses`
  persists every pencil** (formula_version, full snapshot, provider call
  log + cost) — repeat analyses are near-free and reproducible, and the
  `analyses` table drives market-expansion decisions, not the spec
  (`/api/admin/demand`).
- **Hamilton facts source is the Auditor bulk exports**
  (`docs/hamilton-auditor-exports.md`; monthly load via
  `npm run data:ingest:hc-auditor`). CAGIS supplies **centroids only**
  (`npm run data:ingest:hamilton`). Hamilton analyses short-circuit to
  owned facts with provenance and call ATTOM for the rental AVM only.
- **Regrid is parked** (adapter kept, out of default priority; owned
  trigram typeahead serves the deep market). **RentCast is the
  nationwide rent fallback**, cached per TTL, never accumulated into a
  durable dataset.
- Schema is managed exclusively by `migrations/` via `npm run db:migrate`
  (idempotent, CI-tested); all runtime DDL was removed.

## Revision 2026-09-19 (second owned market: Greene County OH)

- **Greene County (Dayton/WPAFB corridor) is owned market #2**
  (`greene_county_oh`, FIPS 39057). Single source: the county's open
  ArcGIS parcels layer (`greene_county_parcels`) carries full facts —
  including **bedrooms** (which Hamilton lacks), baths, living area,
  year built, annual tax bill, appraised value, sale + validity flag,
  and situs city/ZIP. Residential filter `Class='RESIDENTIAL'`
  (63,835 of 77,807 parcels). Loader:
  `lib/data/providers/greene/parcels.ts`.
- **Geometry comes from the GeOhio Statewide Parcels layer**
  (`geohio_statewide_parcels`): the county MapServer suppresses all
  geometry (`supportsReturningGeometry: None`). The statewide sweep
  (`lib/data/providers/ohio/statewideCentroids.ts`) is county-generic —
  it joins `normalizeParcelId(LocalParcelID)` to
  `canonical_parcel_id` — and is the intended geometry path for future
  Ohio counties (Montgomery next, pending a facts source).
- **ZCTA join generalized**: `scripts/geo-zcta-join.ts` takes
  `--market`, `--envelope`, and `--fill-only` (fill NULL ZIPs only —
  county situs ZIPs are more accurate than ZCTA and are never
  overwritten).
- **The analyze short-circuit is market-generic**: `findOwnedFacts`
  (`lib/analyses.ts`) joins `markets` on `county_fips` for any enabled
  market; provenance copy derives from `markets.county`. Owned `beds`
  flows into the result where the source provides it (Greene yes,
  Hamilton stays NULL). The owned typeahead searches all owned markets.
