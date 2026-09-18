> **ARCHIVED (v2).** Superseded by `../technical-implementation-spec.md` (v3, canonical). Kept for history only.

# PropPencil Data Network — Cincinnati-First Proprietary Property Data (v2 spec)

> Founder directive 2026-09-15 (second revision). **Where this conflicts with
> `platform-upgrade-spec.md` (v1), THIS document takes precedence.** The one
> founder deviation from the original prompt: market expansion order (§67)
> inserts **Macon County, IL** immediately after the Ohio counties.

## Mission & business rule

Answer "Does it pencil?" **without paid commercial APIs as hard
dependencies**. Build PropPencil's own property intelligence network for
**Cincinnati / Hamilton County, OH** (market_id `hamilton_county_oh` — the
whole county, not just city limits) from public/government/open sources, user
input, and PropPencil's own observations. Commercial providers (RentCast,
Regrid, ATTOM, MLS) are **optional fallbacks** — the app must fully function
with zero commercial keys. Architecture expands to new markets via
configuration + source adapters (MarketConfig per market), never rewrites.

**Expansion order:** Hamilton OH → Butler OH → Warren OH → Clermont OH →
**Macon County, IL** → Kentucky counties → Indiana counties → national.

## Legal / sourcing rules (absolute)

No scraping sites that prohibit it; no CAPTCHA/auth/robots bypass; no
Zillow/Redfin/Realtor/MLS page scraping; no copying commercial databases; no
using RentCast/Regrid responses to build a competing dataset copy; no
invented data; no silent low-confidence substitution. Every source gets a
`data_sources` row with license/usage status — **never encode licensing
assumptions in code**. Before implementing any source adapter: find official
source, current docs, access method, terms; record in data_sources;
implement only the documented access method. If access/licensing is unclear:
STOP, mark `SOURCE_REVIEW_REQUIRED`, move on. If only a website exists (no
authorized machine interface): status `manual_only`, do NOT scrape.
**Known is better than guessed. Unknown is better than fake precision.**

## Primary sources (Cincinnati stack)

- **Hamilton County Auditor** (wedge.hcauditor.org): parcels, address, sales,
  year built, sqft, acreage, style, basement/garage, land use, appraisal —
  authoritative public record. Adapter with swappable access method.
- **Hamilton County parcel GIS** (public ArcGIS feature service, monthly):
  foundation of address→parcel→canonical-property identity. Store source
  parcel id, normalized id, FIPS, geometry, centroid, situs+mailing address,
  owner, land use, acreage, timestamps, source URL/version.
- **CAGIS**: zoning/GIS/permits/planning where authoritative → CagisProvider.
- **Cincinnati Open Data — Building Permits** (daily refresh, public-domain
  dataset; has PIN, cost, sqft, units, dates, status, work class, lat/lon,
  neighborhood): CincinnatiBuildingPermitProvider with **incremental**
  ingestion (source_record_id + source_updated_at + upserts; never
  full-redownload). Derives renovation/capital-improvement/condition signals.
- **Ohio OGRIP** statewide GIS (verify redistribution per dataset).
- **HUD**: FMR + SAFMR + income limits APIs; PHA registry → HudProvider +
  PhaProvider. Store by year/geography/bedroom; never overwrite prior years.
  FMR ≠ market rent; payment standard ≠ guaranteed landlord rent. Separate
  fields: market_rent, hud_fmr, hud_safmr, pha_payment_standard,
  utility_allowance, tenant_portion, estimated_hap.

## Core architecture: the Observation Graph

A property is a stable entity; everything else is observations over time.
Raw source payloads are ALWAYS retained (`raw_source_records` with
content_hash, parser_version, normalizer_version) so normalization changes
can reprocess without re-downloading (§83–84). Historical tables:
property_observations, property_sales, property_tax_records,
property_permits, property_listings, rental_observations,
property_ownership_history, property_value_observations, property snapshots.

**Schema (Postgres; prefer PostGIS for geometry/radius/comp-distance):**
markets, data_sources (license fields, priority, enabled, last_ingestion),
ingestion_runs (status/counts/cursor; idempotent by source_id+external_id or
content_hash; resumable from checkpoint), raw_source_records, properties (+
addresses/parcels/geometries), the observation tables, data_points
(field-level provenance: value, source, observed_at, confidence, method,
is_current, supersedes), data_conflicts (candidates, selected, reason),
user_property_overrides (old/new/user/when/why; originals never destroyed),
public_housing_agencies, pha_payment_standards, hud_fmr, hud_safmr,
rent_estimates, sale_value_estimates, property_condition_signals,
underwriting_scenarios/results, risk_flags, pencil_scores. Index parcel_id,
market_id, normalized address, per-table property_id + date columns, spatial.

**Identity:** county+parcel/APN → source parcel id → canonical
PropertyIdentity (UUID + sourceParcelIds[]); never lat/lon or raw strings as
canonical identity. Address normalization pipeline (normalizeAddress() with
100+ variant tests). Matching levels: parcel exact → address+ZIP → address+
city/state → geospatial → fuzzy; output match_score/method/candidates; never
silently accept weak fuzzy matches (ambiguous → return candidates).

**Field-level source precedence** (configurable per field, not one global
hierarchy): e.g. sqft: auditor > user_override > licensed provider; market
rent: user_actual_lease > subject_listing > proppencil_comps >
licensed_provider > market_model. Freshness status
(fresh/aging/stale/very_stale/unknown) with per-datatype thresholds.

## Intelligence layers

- **Rent engine**: estimateMarketRent hierarchy (user lease → subject listing
  → high-confidence comps → historical subject rent → neighborhood comps →
  market model → commercial fallback), explainable comp scoring (type 20 /
  beds 20 / baths 10 / sqft 15 / distance 15 / recency 10 / year 5 /
  amenities 5, configurable), robust outliers (median/MAD/IQR/winsorize,
  removed comps retained + reasons), confidence tiers by comp count/quality,
  ALWAYS estimate+low+high+confidence+methodology; insufficient data →
  honest "not confidently available", never invented rent. Rental
  observations network: rental_observations + probabilistic dedupe clusters
  (score ≥.90 same, .75–.89 review, <.75 separate; configurable) + full
  listing HISTORY per property (the eventual moat).
- **Value engine**: transparent sale-comp scoring (weights configurable),
  arms-length classification of transfers (classifySale + confidence; family/
  quitclaim/foreclosure/estate ≠ market sales), "PropPencil Estimated Market
  Value" (never "appraisal"). No protected-class or demographic-proxy
  factors.
- **Condition signals** from permits (intelligence, not inspection: "recent
  permit activity suggests recent improvement", never "property is in good
  condition" without a source).
- **Tax engine**: historical records, trends, effective rate; configurable
  forecast strategies (current / historical growth / post-sale reassessment
  / override) — default conservative + transparent; assessed ≠ market value.
- **Section 8 engine** (separate): market rent vs FMR vs SAFMR vs payment
  standard vs utility allowance vs tenant portion vs HAP, uncertainty
  communicated ("Estimated HCV-supported rent ceiling … subject to PHA
  payment standard, utility allowance, rent reasonableness, inspection").
- **Underwriting** (deterministic; existing engine): GPR/EGI/NOI/cap/debt
  service/cash flow/CoC/DSCR/break-even occupancy (debt service and income
  tax NOT in NOI); market value ≠ investor value; max buy price from investor
  requirements with shown math; explainable Pencil Score (configurable
  weights/thresholds); **Data Confidence separate from Pencil Score**;
  risk_flags with severity/explanation/evidence/action; sensitivity engine →
  "What could break the pencil?" break-even thresholds.

## Engineering requirements

DataProvider interface (id, capabilities, supportsMarket, healthCheck,
ingest); ingestion runner with runs/checkpoints/incremental cursors;
error taxonomy (not_found/temporary/rate_limited/unauthorized/forbidden/
malformed/schema_changed/partial — never just "API failed"); **schema-change
detection fails ingestion safely + alerts** (no silent null parcel ids);
per-provider rate limit/backoff+jitter/timeout/circuit breaker (gentle on
government endpoints); HTTP cache w/ configurable TTLs (address 24h, parcel
7d, tax 7d, permits 24h, HUD 30d, rental 6–24h); job queue (idempotent,
retryable, observable): property.resolve/enrich, *.ingest, hud.refresh,
recalculates; async enrichment (return known data fast, enqueue jobs,
progress UI); admin data-quality dashboard (sources, runs, coverage,
freshness, conflicts, match/dup rates — never fabricated numbers) + admin
controls (run/pause/retry/reprocess/disable source); market_coverage
metrics; UI NEVER calls sources directly (backend chooses providers); no
provider keys in browser; user assumptions stay private (no mixing into
global data without explicit anonymized aggregation); audit trail on all
user changes; validation rules flag (not delete) suspicious records; every
estimate LABELED ("PropPencil estimated market rent", never bare "Rent:");
meaningful provenance display ("Hamilton County Auditor, observed March
2026", never "Source: Internal"); commercial data disclosed as such.

## Directory conventions

Adapt spec §121 to this repo: `lib/data/` (providers/{core,hamilton,
cincinnati,hud,commercial}, normalization, matching, ingestion, provenance),
`lib/intelligence/` (rent, value, taxes, section8, condition, risk, pencil),
existing `lib/` underwriting stays. API under app/api (properties/search,
properties/:id, properties/:id/refresh queueing jobs, admin/*).

## Implementation stages (do in order — do NOT overbuild)

1 data foundation (tables+migrations+tests) → 2 identity (normalize/match)
→ 3 Hamilton County providers+ingestion → 4 Cincinnati permits → 5 property
page UI (facts/parcel/tax/sales/permit timeline/provenance) → 6 rental
observations/dedupe/comps/estimator (fixtures first) → 7 HUD/SAFMR/PHA/S8
→ 8 underwriting wiring → 9 commercial fallbacks (RentCast/Regrid/ATTOM/MLS
— ALREADY partially built in lib/providers/, keep as optional). Tier goal:
excellent data for one market, not mediocre national data.

## Acceptance tests (§109–117, abridged)

Full pipeline for a Cincinnati address; everything works with zero
commercial keys ("Unavailable — optional provider not configured"); double
ingestion → zero duplicate canonical records; two same-property rental
observations → 1 cluster + 2 retained observations; auditor sqft 1428 +
user 1500 → official record intact, underwriting uses override w/
provenance; no comps → honest insufficient-data (no invented rent); outlier
$4,500 in $1,6xx comps → excluded; high-upside/high-risk property → score
shows both; demo fixtures A–J (strong parcel match, parcel-only match,
sqft conflict, dup rental, outlier rental, no comps, multi-sale, recent
permits, stale data, user override) clearly marked DEMO DATA.

## Docs to maintain

data-architecture, data-sources (licensing table with verify-before-
confirm statuses), provider-development, property-identity, provenance,
rental-engine, section8, market-expansion, licensing.
