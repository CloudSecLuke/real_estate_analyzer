# PropPencil data-layer overhaul — execution brief for Claude Code

You are working in the `real_estate_analyzer` repo (PropPencil). Read
`CLAUDE.md` and `AGENTS.md` first and follow their conventions (PROP-n
issues, P0/P1/P2 labels, "Resolves PROP-n" in commits, `next dev` agent
rules block). Then read this brief in full before touching anything.

## Context you need

Three founder specs were written on 2026-09-15 (`docs/platform-upgrade-spec.md`
v1, `docs/data-network-spec.md` v2, `docs/technical-implementation-spec.md`
v3). They contradict each other. An external review on 2026-09-16 found:

1. Bulk public-record facts were being stored as raw jsonb payloads +
   EAV `data_points` rows, ingested one record at a time over the Neon
   HTTP driver (~12–18 round trips per parcel, no transactions). At
   Hamilton County scale (356,599 parcels) that is ~1 GB and 15–40 hours.
2. The `hamilton_county_auditor` source was marked `manual_only / do not
   scrape`. That was wrong. The Auditor publishes authorized bulk xlsx
   exports at https://hamiltoncountyauditor.org/hamilton/revalue.asp
   (`Monthly_tax_information.xlsx`, `HistoricSalesExport.xlsx`,
   `bldginfo.xlsx`, plus annual TaxYear exports 2002–2024).
3. A replacement design was built and tested against the real files on
   a local Postgres 16 + PostGIS: full county in 113 s, 413 MB on disk,
   idempotent re-run touches 0 rows.

The replacement files are in the `proppencil/` directory that has been
extracted to the repo root (or attached). They are the source of truth
for this task:

```
proppencil/migrations/0001_data_foundation.sql
proppencil/migrations/0002_hamilton_auditor_typed.sql
proppencil/scripts/db-migrate.ts
proppencil/scripts/ingest-hamilton-auditor.ts
proppencil/docs/hamilton-auditor-exports.md
proppencil/package.json            (reference for scripts + deps only)
```

**Where the existing code conflicts with these files, the existing code
loses.** Do not merge, reconcile, or "preserve" the old approach. Replace
it.

## Hard rules — read twice

- **Never deploy.** Do not run `vercel deploy`, `vercel --prod`, or push to
  a branch that auto-deploys. The founder deploys manually after review.
- **Never touch the production database.** `lib/dbUrl.ts` refuses `neondb`
  outside production; do not set `ALLOW_PROD_DB=1` for any reason. All DB
  work runs against `proppencil_dev`. If `DATABASE_URL` in `.env.local`
  points at `/neondb`, STOP and ask.
- **No scraping.** Do not fetch wedge.hcauditor.org, Zillow, Redfin,
  Craigslist, Apartments.com, or any consumer listing site. The only
  Auditor URLs you may fetch are the xlsx exports under
  `hamiltoncountyauditor.org/download/revalue/`.
- **Never store commercial provider responses past their TTL.** RentCast /
  ATTOM / Regrid terms prohibit building a copy. `provider_cache` rows
  expire; nothing from a paid provider is written to `auditor_*`,
  `properties`, or `data_points` as a durable fact.
- **Never invent data.** No bedroom counts derived from `total_rooms`, no
  ZIP guessed from street name, no rent from county medians labeled as
  property rent. Missing stays NULL and the UI says so.
- **No LLM calls in any financial calculation or ingestion path.**
- **Work in phases. Stop at each STOP line, summarize the diff, and wait
  for approval before continuing.** Do not batch phases.
- One commit per phase minimum; file a `PROP-<n>` issue for each phase if
  one does not exist; reference it in the commit.
- `npx tsc --noEmit`, `npm test`, and `npm run build` must be green at the
  end of every phase.

## Phase 0 — Environment check (no code changes)

1. Confirm `.env.local` has `DATABASE_URL` pointing at `proppencil_dev`
   and that it is a **direct (non-pooled) Neon connection string with
   `sslmode=require`**. The new migrator and loader use `pg` over TCP for
   `COPY` and transactions; the `@neondatabase/serverless` HTTP driver
   cannot do either. If it is a pooled/`-pooler` host, say so and stop.
2. `psql "$DATABASE_URL" -c "select version(), postgis_full_version();"`
   must succeed (PostGIS 3.x on Neon).
3. Report Neon plan and current storage used if you can see it; the
   design targets Free (0.5 GB/project) with little headroom.

STOP. Report findings.

## Phase 1 — Replace the data foundation with explicit migrations

1. Add `migrations/0001_data_foundation.sql` and
   `migrations/0002_hamilton_auditor_typed.sql` from `proppencil/`
   verbatim. Do not edit their DDL in this phase; if something in them
   fails against Neon, report the exact error rather than patching around
   it.
2. Replace `scripts/db-migrate.ts` with `proppencil/scripts/db-migrate.ts`.
3. Add dependencies: `pg`, `pg-copy-streams`, `exceljs`; dev:
   `@types/pg`, `@types/pg-copy-streams`, `tsx`. Keep
   `@neondatabase/serverless` for the request path.
4. In `package.json` scripts: `db:migrate` →
   `npx -y tsx scripts/db-migrate.ts`; add `data:ingest:hc-auditor` →
   `npx -y tsx scripts/ingest-hamilton-auditor.ts`.
5. **Remove lazy DDL from the request path.** In `lib/data/schema.ts`,
   delete `createAll()`/`seed()` and make `ensureDataSchema()` a no-op that
   returns a resolved promise (keep the export so callers compile), or
   delete the callers. Do the same for the `ensureSchema()` functions in
   `lib/db.ts`, `lib/users.ts`, `lib/ratelimit.ts`, `lib/health.ts`: move
   their `CREATE TABLE IF NOT EXISTS` statements into a new
   `migrations/0003_app_tables.sql` (`user_state`, `users`, `entitlements`,
   `password_resets`, `rate_limits`, `health_checks`) and delete the
   runtime DDL. Migrations are the only place DDL runs.
6. Consolidate the five separate `neon()` client instances into one
   `lib/sql.ts` exporting `sql()` (HTTP driver, request path). Update
   imports. Behavior must not change.
7. Run `npm run db:migrate` against `proppencil_dev`. Expect 0001, 0002,
   0003 to apply. Run it again; expect no-op.
8. Update `.github/workflows/ci.yml`: add a job that runs
   `npm run db:migrate` against a Neon branch or a `postgis/postgis:16`
   service container, so migrations are tested in CI. Do not put any real
   `DATABASE_URL` in the workflow file; use a secret or the service
   container URL.

STOP. Show the diff and the migration output.

## Phase 2 — Hamilton County Auditor bulk loader

1. Add `scripts/ingest-hamilton-auditor.ts` from `proppencil/` verbatim.
2. Add `docs/hamilton-auditor-exports.md` from `proppencil/` verbatim.
3. Add `.cache/` to `.gitignore` (the loader downloads xlsx there).
4. Run `npm run data:ingest:hc-auditor -- --as-of <date shown on
   revalue.asp as "File current as of">` against `proppencil_dev`.
   Expected: ~323k `auditor_parcels`, ~297k `auditor_dwellings`, ~293k
   `auditor_sales`, ~322k `properties` for `hamilton_county_oh`. Runtime
   on Neon will be longer than the 113 s local figure; report it.
5. Run it a second time. Expected: `upserted 0`, `new sale events 0`,
   `dwellings upserted 0`.
6. Report `pg_database_size` and per-table sizes after the load. If total
   exceeds ~450 MB, apply the trims listed in the doc (drop
   `owner_name_1` / `area_description` from `auditor_parcels`) via a new
   migration and report the new size. Do not delete anything else.
7. **Overwrite the old Hamilton provider.** Rewrite
   `lib/data/providers/hamilton/parcels.ts` and `scripts/ingest-hamilton.ts`
   so the CAGIS ArcGIS feature service is used **only** for parcel
   centroids (lat/lon → `properties.latitude/longitude/geom` and
   `property_parcels.centroid`), keyed by normalized parcel id, in
   batches of 1000 with one multi-row upsert per page over `pg`. Remove:
   the per-record `storeRawRecord` calls, the per-record `resolveProperty`
   calls, and all `data_points` writes from this file. Remove the
   hardcoded `, Cincinnati, OH` situs suffix (about half the county is not
   Cincinnati; municipality is `auditor_parcels.tax_district_desc`).
8. Update the `hamilton_county_parcels` row in `data_sources` (via
   migration or the loader's seed, not by hand) to say it supplies
   centroids only.
9. Delete the now-dead code path: `lib/data/ingest.ts` `storeRawRecord`
   stays (it is still correct for paid-provider raw payloads) but remove
   any Hamilton-specific callers. `raw_source_records` rows with
   `source_id = 'hamilton_county_parcels'` in `proppencil_dev` may be
   deleted.
10. Update `scripts/verify-stage1.ts` / `verify-stage2.ts` so they still
    pass against the new schema, or delete them if they only tested the
    removed EAV path and say which.

STOP. Show the diff, both load runs' output, and table sizes.

## Phase 3 — ZIP and coordinates (the Auditor file has neither)

`location_city/state/zip` are empty in every row of the tax file. After
Phase 2 step 7, `properties` has centroids. Now:

1. Add a one-time script `scripts/geo-zcta-join.ts` that downloads the
   Census TIGER ZCTA5 shapefile for Ohio (free, public domain), loads it
   into a `zcta_oh` table with `shp2pgsql` or `ogr2ogr` if available,
   otherwise via a GeoJSON conversion, and sets `properties.postal_code`
   by `ST_Contains(zcta.geom, properties.geom)` in one `UPDATE … FROM`.
   Record the download URL, vintage, and license in `data_sources`.
2. Set `properties.city` from `auditor_parcels.tax_district_desc` using a
   small, explicit mapping table (`hc_tax_district_city`) that you
   populate from the distinct values in the data and mark unknowns NULL.
   Do not guess.
3. Report: count of properties with `postal_code`, with `city`, with both.

STOP.

## Phase 4 — Request path: cache + persisted analyses

1. Create `lib/providerCache.ts`: `cached(provider, key, ttlSeconds, fn)`
   reads `provider_cache`, calls `fn` on miss, writes the row with
   `expires_at = now() + ttl` and `cost_cents` (0 for free sources; a
   constant per provider for paid ones, configurable via env). Returns
   `{ value, cacheHit, costCents }`.
2. Wrap every external call in `lib/hud.ts`, `lib/acs.ts`, `lib/fema.ts`,
   `lib/market.ts`, `lib/rates.ts`, `lib/tax.ts`, `lib/geocode.ts`,
   `lib/attom.ts`, `lib/mashvisor.ts`, and the RentCast/Regrid adapters
   with `cached(...)`. Remove the `next: { revalidate }` options; the table
   is now the cache. TTLs: address 24h, HUD 30d, ACS 30d, FEMA 30d, BLS 7d,
   FRED 24h, ATTOM property 90d, RentCast rent estimate 14d, RentCast
   comps 7d, Mashvisor 24h. **Paid-provider TTLs must not exceed what the
   provider's terms allow; check `docs/provider-architecture.md` and the
   vendor docs, and note the source of each TTL in a comment.**
3. Add a nightly cleanup: `DELETE FROM provider_cache WHERE expires_at <
   now()` in the existing `/api/health` cron handler (see Phase 5 for its
   schedule).
4. In `app/api/analyze/route.ts`: after computing the payload, insert a
   row into `analyses` (username, address_input, matched_address,
   county_fips, state, inputs, result, formula_version, provider_calls,
   provider_cost_cents). `formula_version` comes from a new exported
   constant in `lib/metrics.ts` (e.g. `"legacy-1.0.0"`). The insert must
   not fail the request (wrap like `recordPencil`).
5. **Hamilton short-circuit:** before calling ATTOM for property facts,
   look up `properties` by the geocoded address in `hamilton_county_oh`
   (parcel-id match first via `auditor_parcels.situs_address` +
   `properties.street_address`, then the existing matcher). If found, use
   `annual_taxes_cents`, `living_area_sqft`, `baths`, `year_built`,
   `assessed_value_cents`, `last_sale_*`, `rental_registered` from the
   owned data with provenance "Hamilton County Auditor, file as of
   <facts_as_of>", and skip the ATTOM property/tax call. Bedrooms remain
   whatever the user supplied or NULL. ATTOM/RentCast may still be called
   for rent only.
6. Add `app/api/admin/demand/route.ts` (founder-only, same guard as
   `/api/health`): `SELECT county_fips, state, count(*), sum(provider_cost_cents)
   FROM analyses WHERE created_at > now() - interval '90 days' GROUP BY 1,2
   ORDER BY 3 DESC`. This is the input to every future "which county next"
   decision.
7. Tests: unit-test `cached()` with a mocked `sql`; add a test that the
   analyze route inserts an `analyses` row (mock DB).

STOP.

## Phase 5 — Operational fixes (small, independent)

1. `vercel.json`: change the health cron from `0 */6 * * *` to
   `0 9 * * *` (daily). It spends paid quota on every run.
2. `app/api/billing/webhook/route.ts`: on any DB write failure return
   HTTP 500 so Stripe retries; record `event.id` in a new
   `stripe_events (id text primary key, type text, received_at
   timestamptz)` table (add via migration) and skip already-seen ids.
3. `lib/db.ts` `saveUserState`: cap `history` to the most recent 200
   entries server-side before writing.
4. `lib/providers/registry.ts`: keep the Regrid adapter file but remove
   `regrid` from `DEFAULT_PRIORITY.address` and `.parcel`; add an
   `ownedAddress` provider that serves typeahead from `properties` using
   the `properties_street_trgm_idx` (`street_address ILIKE`/`%` similarity,
   market-scoped). Mock remains last.
5. Delete `property_parcels.geom` (MultiPolygon) via migration; it was
   never populated. Keep `centroid`.

STOP.

## Phase 6 — Documentation reconciliation

1. Make `docs/technical-implementation-spec.md` (v3) the single canonical
   spec. Append a dated "Revision 2026-09-16" section stating:
   - bulk government facts live in typed tables with row-level provenance;
     `data_points` is for cross-source conflicts and user overrides only;
   - raw payloads are not stored for government bulk sources (file
     sha256 + as-of in `ingestion_runs.metadata`; files may be kept in
     object storage);
   - `provider_cache` replaces the Next.js Data Cache; `analyses` persists
     every pencil; `analyses` drives market expansion, not the spec;
   - Hamilton facts source is the Auditor bulk exports (link to
     `docs/hamilton-auditor-exports.md`); CAGIS is centroids only;
   - Regrid is parked; RentCast is the nationwide rent fallback, cached
     per TTL, never accumulated.
2. Move `docs/platform-upgrade-spec.md` and `docs/data-network-spec.md`
   to `docs/archive/` with a one-line header pointing to v3. Do not delete
   them.
3. Update `README.md` "Data sources" table: add the three Auditor exports,
   mark Regrid as parked, and note that county/Census rent is a benchmark
   only.
4. Update `CLAUDE.md` production notes: `npm run db:migrate` is now
   mandatory before deploy; lazy DDL is gone; loader cadence is monthly.

STOP. Final summary: list every file added, replaced, moved, or deleted,
and every migration applied to `proppencil_dev`.

## Acceptance criteria (the founder will check these)

- `git grep -n "CREATE TABLE" lib/ app/` returns nothing.
- `npm run db:migrate` is idempotent and runs in CI.
- `npm run data:ingest:hc-auditor` loads the county and is a no-op on
  re-run.
- `SELECT count(*) FROM properties WHERE market_id='hamilton_county_oh'
  AND living_area_sqft IS NOT NULL AND baths IS NOT NULL` ≳ 250,000.
- `SELECT count(*) FROM properties WHERE market_id='hamilton_county_oh'
  AND postal_code IS NOT NULL` ≳ 300,000 after Phase 3.
- Analyzing a Hamilton County address in dev shows Auditor-sourced taxes
  and sqft with provenance text, makes zero ATTOM property calls, and
  writes one `analyses` row.
- Re-analyzing the same address within TTL makes zero external calls.
- `raw_source_records` contains no rows from Auditor or CAGIS sources.
- No file under `lib/` or `app/` imports `exceljs` or `pg-copy-streams`
  (bulk tooling stays in `scripts/`).
- Nothing was deployed. Production `neondb` was never connected to.

## If you disagree with something in this brief

Say so at the STOP line with the specific reason and the alternative,
then wait. Do not silently do something different, and do not do both.
