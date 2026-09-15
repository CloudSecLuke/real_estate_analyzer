# PropPencil — Property Intelligence & Automatic Data Ingestion (Platform Upgrade Spec)

> Founder directive, 2026-09-15. This is the canonical spec for the platform
> upgrade tracked by the PROP-23 epic. Implementation order and definition of
> done are at the bottom. Full original prompt preserved verbatim in spirit;
> condensed here for repo use without losing requirements.

## Product vision

The core experience must become: **paste a listing URL OR search an address →
PropPencil identifies the property → automatically gathers listing/property/
rental data → shows the user what it found → user confirms/corrects anything
uncertain → PropPencil underwrites the deal.** The user reviews PropPencil's
work instead of performing it. The app must stop requiring manual entry of
purchase price / rent / beds / baths / sqft when providers can resolve them.

**County/Census average rent must never be the primary property-level rent
estimate** — fallback/benchmark only, clearly labeled, with reduced confidence.

## Two first-class ingestion paths

- **Path A — address search**: autocomplete → canonical property selection →
  identity resolution → enrichment → listing discovery → rental data → sale
  comps → rental comps → taxes → insurance → Section 8 → underwriting.
- **Path B — listing URL**: URL normalization → provider resolution → listing
  extraction → canonical identity → enrichment → comps → taxes → insurance →
  Section 8 → underwriting. **Never** rely on scraping consumer sites; use
  licensed/authorized APIs. Never bypass robots.txt/auth/paywalls/anti-bot.
  If a consumer URL can't be legally resolved: extract the address if
  permitted, resolve it, search authorized providers, and say so honestly.

## Provider architecture (mandatory)

No business logic may depend directly on a vendor. Interfaces (conceptual):
`AddressProvider` (autocomplete/resolve), `ParcelProvider`,
`PropertyDataProvider`, `ListingProvider` (+ future `MlsProvider` for
RESO-compatible feeds), `RentalDataProvider` (rent estimate + comps),
`SalesCompProvider`, `TaxProvider`, `PhaProvider`. All provider responses are
normalized into internal schemas immediately; raw provider JSON never leaks
into UI or business logic. Raw payloads may be stored separately where terms
permit.

**Providers to implement:**
- **RentCast** (primary property/listing/rent): property records + attributes
  + tax history, sale/rental listings, rent AVM + rental comps, sale comps,
  value estimates. `RENTCAST_API_KEY`. Read current official docs; don't
  hard-code endpoint assumptions.
- **ATTOM** (secondary property/AVM): behind the same abstraction; app must
  work without the key. `ATTOM_API_KEY`. (Existing `lib/attom.ts` becomes an
  adapter inside this layer.)
- **Regrid** (address autocomplete + parcels): Typeahead API returns
  persistent `ll_uuid` parcel identifier + address + geometry + match score;
  parcel lookup by that id. `REGRID_API_KEY`. Keys server-side only — browser
  calls PropPencil's backend.
- **Mock providers** (demo mode): app MUST work with zero keys. Realistic
  Cincinnati fixtures spanning distinct profiles (older 3/1 SFR, renovated
  3/2, 4/2 suburban, duplex, Section 8 candidate, poor-cash-flow, strong
  cash-flow) so the demo shows why property-level comps matter.

**Provider config**: feature flags (`ENABLE_RENTCAST` etc.) and priority
lists per capability (property/rental/listing/parcel), configurable, not
hard-coded. App auto-uses whichever providers are configured.

## Canonical property identity + matching

`PropertyIdentity` with deterministic `canonicalPropertyKey` (hierarchy:
stable parcel/provider id → normalized address + geo → address fallback);
never raw user strings as sole id. Matching engine combines normalized
address, ZIP, city/state, parcel id/APN, coordinates, provider ids,
beds/baths/sqft/yearBuilt; stores `PropertyMatchResult` {canonicalPropertyId,
confidence, matchedBy[], conflicts[]}. Properties are reusable across
analyses — never duplicated per analysis.

## Autocomplete UX

Debounced, min-chars, stale-request cancellation, loading state, ranked
suggestions with city/state/ZIP, dedupe by parcel id, graceful no-results and
provider-failure, manual entry always possible. Suggestion shape: {provider,
providerId, displayAddress, city?, state?, postalCode?, lat?, lon?,
matchScore?}. Persist the provider id on selection — don't re-fuzzy-match.

## Listing discovery & normalization

After resolution, discover the current sale listing automatically ("Searching
current listings…" → "We found this property — For Sale $289,900 · 3bd 2ba
1,842 sqft · [Use this listing] [Not this property]"). Rank multiple
candidates by identity match > active status > address match > parcel match >
recency > provider confidence. Listing price priority: authorized MLS feed →
licensed listing provider → property-data provider → user-provided → none.
Never fabricate a price; if unverified, say so and offer manual entry.
`ListingRecord` normalized: status (active/pending/sold/off_market/unknown),
listingType (sale/rent/unknown), price/rent, attributes, dates, daysOnMarket,
sourceUrl, confidence. `ListingUrlResolver` interface with provider-specific
resolvers; honest sourcing statements.

## Rent Intelligence Engine (core component)

Hierarchy (never silently skip levels): 1 actual user-supplied lease → 2
subject property's current rental listing → 3 high-quality nearby rental
comps → 4 primary provider AVM → 5 secondary AVM → 6 broad market stats →
7 configurable fallback. UI must label fallbacks.

- **Comp model**: normalized `RentalComp` with rent, attributes, distance,
  dates, similarityScore, adjustments, confidence, sourceUrl.
- **Explainable scoring** (configurable weights, not hard-coded): bedroom 20,
  bathroom 15, propertyType 15, sqft 15, distance 15, recency 10, yearBuilt
  5, features 5 (starting point).
- **Outlier handling**: median/MAD/IQR/percentile trimming; never plain
  average; store included/excluded/down-weighted per comp with reason.
- **Blending**: when multiple quality sources exist, weight by freshness,
  subject-specificity, comp count, provider confidence, similarity → single
  "PropPencil Recommended Rent"; store the full calculation.
- **Output**: `RentEstimate` {recommendedRent, low, high, confidence
  high/medium/low, methodology (actual_subject_rent | subject_listing |
  comparable_analysis | provider_avm | blended | market_fallback), comps,
  providerEstimates, explanation[], assumptions[], calculatedAt}.
- **Validation**: fixtures for Cincinnati/Columbus/Cleveland/Atlanta/Dallas/
  Phoenix/Chicago; tests for matching, comp selection, outliers, ranges,
  confidence, provider disagreement, fallbacks. No accuracy claims without
  measurement.

Distinguish and never conflate: actual advertised rent vs estimated market
rent vs user's actual lease. Underwriting lets the investor pick; default is
explicit.

## Enrichment

Auto-retrieve beds/baths/sqft/lot/yearBuilt/type/stories/parking/basement/
HVAC/pool/HOA/tax history/sale history/assessed value/last sale. Ask the user
only when providers can't resolve. Independent enrichment jobs run
concurrently after identity resolution (property data, listing search, rent
AVM, rent comps, sale comps, tax, PHA, market data); aggregate; real progress
states in UI (not fake spinners).

## Provenance, conflicts, overrides, quality

- `DataProvenance` {sourceType provider|government|listing|user|calculated|
  fallback, provider?, sourceName?, sourceRecordId?, sourceUrl?, retrievedAt,
  sourceUpdatedAt?, confidence, methodology?} attached via `DataPoint<T>`.
  UI must answer "where did this number come from?" — reusable Data Source
  Drawer component.
- **Conflicts**: material disagreement (e.g. sqft 1,842 vs 1,910 vs 1,876) is
  surfaced, deterministic default chosen by hierarchy + confidence, user can
  pick, resolution stored.
- **Overrides**: every auto value editable with source/confidence/reset;
  store original + override + user + timestamp + optional reason; never
  destroy originals.
- **Data Confidence score**: overall % + per-field breakdown (identity,
  price, characteristics, rent, taxes, insurance, assumptions).
- **Classification rule**: every value is Verified | Estimated | Calculated |
  User Provided | Fallback | Unknown. Never fabricate; never imply certainty;
  never silently convert market average→property estimate, listing price→
  verified price, FMR→achievable S8 rent, AVM→appraisal, estimate→fact.

## Section 8 engine (separate from general rent)

Incorporate HUD FMR, SAFMR where applicable, PHA payment standards, utility
allowances, bedroom count, gross rent, tenant-paid utilities, HAP/PHA split,
rent reasonableness, inspection standards, PHA policies. FMR and payment
standards are NOT guaranteed rents. Show HUD benchmark / payment standard /
estimated achievable gross rent / utility allowance / tenant portion / HAP
with confidence + sources.

## Expenses

Taxes: government records → provider → configurable local fallback.
Insurance: configurable estimation model, shown as a range + confidence —
never fake a quote. Maintenance: configurable by age/type/condition/value/
locale. CapEx separate from maintenance; no double-counting.

## Underwriting (deterministic, unit-tested — largely exists)

Inputs: price, rent, other income, vacancy, taxes, insurance, utilities,
management, maintenance, capex, HOA, licensing, pest, landscaping, financing,
down payment, rate, term, closing, reserves, rehab. Outputs: GPR, EGI, OpEx,
NOI, debt service, cash flow, cap, CoC, DSCR, break-even occupancy, cash
needed, investor value, max buy price, walk-away price, Pencil Score, risk
score, confidence. Market Value ≠ Investor Value (central distinction). Max
Buy Price solves for investor requirements (min CoC / min DSCR / min cash
flow). Pencil Score explainable with signed contributors. Risk engine =
sensitivity analysis ("rent below $1,720", "insurance above $2,400", …).
Scenario engine: base/conservative/optimistic/custom, full recalc each.

## Data model (relational, follow existing stack — Neon + hand-rolled SQL)

Property, PropertyIdentity, PropertySource, Listing, ListingSource,
RentalComp, SaleComp, RentEstimate, RentEstimateSource, PropertyTax,
PropertyAttribute, DataPoint, DataConflict, UserOverride, Assumption,
Analysis, Scenario, UnderwritingResult, PencilScore, RiskFactor,
ProviderRequest, ProviderResponse.

## Provider infrastructure

- **Cache** with per-datatype configurable TTLs (autocomplete seconds-minutes;
  active listings hours; rentals hours-day; property records days-weeks; tax
  weeks-months; sales days-weeks; AVMs hours-days).
- **Failure handling**: primary → secondary → cached (labeled with age) →
  approved source → honest missing-data state. Never crash, never fabricate.
- **Rate limiting**: dedupe, retries with backoff, timeouts, circuit breaker,
  per-provider concurrency; debounced autocomplete.
- **Observability**: log every provider request (provider, endpoint, ts,
  latency, status, correlation id, success, cache hit/miss, error category);
  no secrets, no unnecessary PII.

## API surface (adapt to existing app-router conventions)

property/resolve, address/autocomplete, listing/resolve, property/:id (+
listings, rent, rent-comps, sale-comps, taxes), analysis CRUD + scenario +
override.

## Compliance

`docs/data-sources.md` documenting per provider: data, endpoints, key
requirements, caching/display/attribution requirements, commercial use,
retention, raw vs derived storage, terms. Publicly-visible ≠ scrapable. RESO
is a standard, not a provider — build the `MlsProvider` abstraction now for
future authorized MLS access.

## Testing

Unit: address normalization, matching, provider resolution, listing matching,
comp selection/scoring, outliers, blending, confidence, conflicts, fallback
hierarchy, caching, provider failure, underwriting, max price, Pencil Score,
scenarios. Integration (mocked providers, no paid keys in CI): address→
property→enrichment→analysis and listingURL→listing→property→enrichment→
analysis. Acceptance scenarios: A address flow, B listing-URL flow, C
provider failure cascade, D conflicting sqft, E poor rent data (no fake
precision; fallback + reduced confidence + honest UI).

## Docs to produce

docs/property-resolution.md, docs/rent-estimation.md, docs/data-sources.md,
docs/provider-architecture.md, docs/data-provenance.md,
docs/underwriting-methodology.md.

## Implementation order

P1 inspect repo → P2 canonical identity + normalized models → P3 autocomplete
→ P4 property resolution → P5 RentCast → P6 listing discovery → P7 rental
AVM + comps → P8 comp scoring + PropPencil rent estimate → P9 ATTOM →
P10 provenance/conflicts/overrides → P11 automatic underwriting integration →
P12 low-friction UI → P13 mock/demo mode → P14 tests → P15 lint/typecheck/
tests/build all green.

## Definition of done (fail conditions)

Not done if: user must type a price when a listing price is findable; user
must type rent when comps exist; county/Census rent is primary; no
autocomplete; provider JSON in UI components; keys exposed to browser; no
provenance; no fallbacks; provider failure crashes; no tests; scaffolding
only; demo mode broken; build fails.
