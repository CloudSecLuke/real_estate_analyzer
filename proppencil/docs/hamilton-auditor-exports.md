# Hamilton County Auditor bulk exports — source notes

Verified 2026-09-16 against the live files. This replaces the
`hamilton_county_auditor` "manual_only / do not scrape" entry: the Auditor
publishes authorized bulk downloads (formerly delivered on magnetic tape).

Page: https://hamiltoncountyauditor.org/hamilton/revalue.asp
("File current as of 08/31/2026" at time of writing; refreshed monthly.)

## Files

| File | Rows × cols | What it is | Size (xlsx) |
|---|---|---|---|
| `Monthly_tax_information.xlsx` | 356,599 × 64 | Every parcel: class, situs street, owner + mailing, acreage, last transfer, market values, annual taxes, rental-registration flag, homestead/foreclosure/BOR flags | 120 MB |
| `HistoricSalesExport.xlsx` | 297,415 × 43 | **One row per parcel** (most recent transfer) + dwelling characteristics: style, grade, rooms, full/half baths, year built, finished sqft, garage, basement, heating, A/C | 63 MB |
| `bldginfo.xlsx` | 258,621 × 10 | Sqft by floor, basement/attic sqft, story height, year built | 13 MB |
| `TaxYear<YYYY>Pay<YYYY+1>Export.xlsx` (2002–2024) | ~350k each | Annual snapshots of the tax file — diffing `transfer_date`/`sale_amount` across them backfills ~20 years of sales | ~100 MB each |
| Rental Registration Export | — | Linked from the same page (`tax_rentalregistration.asp`); not yet inspected | — |

Also on the page: New Construction exports 2017–2020, Board of Revision,
TIF/abated/exempt, special assessments, unpaid accounts.

## Gaps you must plan around

- **No bedroom count anywhere** (`total_rooms`, `full_bath`, `half_bath`
  only). Bedrooms drive the HUD FMR row. Options, in order: user input;
  RentCast/ATTOM property record for that one parcel (cached); never
  derive from total_rooms silently.
- **`location_city`, `location_state`, `location_zip` are empty in every
  row** of the tax file. Situs is street-only. Municipality is derivable
  from `tax_district_desc` (e.g. `CINTI CORP-CINTI CSD`). ZIP and lat/lon
  must come from the CAGIS parcel centroid (existing provider) plus a
  one-time spatial join to Census ZCTA polygons, or from the Census batch
  geocoder (free, 10k addresses per request).
- **`HistoricSalesExport` is not a history.** 297,415 rows = 297,415
  distinct parcels. History accrues by loading monthly and upserting into
  `auditor_sales`, or by backfilling from the annual TaxYear exports.
- **Sale prices of 0** mean conveyance-fee exempt (the `(EX)` instrument
  types): quit-claims, affidavits, probate, related-party. Not market
  sales. `likely_arms_length` = warranty/survivorship/fiduciary/trustee
  deed with price > 0 — a heuristic, configurable in the loader, shown to
  the user.
- `location_house_number` contains ranges (`6242-6268`) and occasional
  garbage (`Zoey112003`). Loader keeps the raw value and the leading number.
- ~9% of parcels are non-investable classes (streets, government, churches);
  the loader keeps prop_class_code 400–599 only (323,339 rows).

## Licensing status

- Home page: "Data on our website is public record as defined by Ohio
  Public Records Law 149.43 of the Ohio Revised Code. We do not sell your
  data to anyone, nor do we endorse use of our data for any commercial
  purpose."
- Public-record-request page: "Information on this site is believed to be
  accurate but is not guaranteed. The Hamilton County Auditor disclaims any
  liability for errors or omissions."
- Reading: ORC 149.43 does not let a records custodian restrict downstream
  use, and "do not endorse" is a statement, not a license term. This is
  not legal advice; the `data_sources` rows stay at `commercial_use_allowed
  = 'verify'` until counsel confirms. Attribute as "Hamilton County
  Auditor, file as of <date>" in the UI regardless.

## Load results (local Postgres 16 + PostGIS, 2026-09-16)

`npm run data:ingest:hc-auditor -- --dir ./hc --as-of 2026-08-31`

| Step | Time | Result |
|---|---|---|
| tax → `auditor_parcels` + `properties` | 65 s | 323,339 investable parcels |
| sales → `auditor_dwellings` + `auditor_sales` | 42 s | 297,415 dwellings, 293,516 sale events |
| bldginfo → gap-fill | 13 s | 257,845 rows |
| second run (unchanged files) | ~115 s | 0 / 0 / 0 rows changed |

Coverage: 214,514 single-family parcels with sqft + baths + year built;
29,764 parcels flagged rental-registered; 32,180 likely-arms-length sales
since 2024-01-01 (median $272k).

On-disk after `VACUUM FULL`: **413 MB total** — auditor_parcels 128 MB,
properties 146 MB (93 table + 53 index, incl. trigram + GIST), dwellings
66 MB, sales 59 MB, PostGIS `spatial_ref_sys` 7 MB. That is under Neon
Free's 0.5 GB but with little headroom, and the dev database shares the
project quota. Expect Launch (~$0.15–0.50/mo of storage) once the second
market lands. Cheapest trims if needed: drop `owner_name_1`/
`area_description` from `auditor_parcels` (~25 MB), stop duplicating
facts into `properties` and view-join instead (~100 MB).

Compare with the previous design at the same coverage: raw jsonb
payloads (~600 MB) + EAV `data_points` (~400 MB) + 15–40 h of per-row
round trips.

## Monthly cadence

1. Check the "File current as of" date on revalue.asp (or `HEAD` the xlsx
   and compare `Last-Modified`).
2. `npm run data:ingest:hc-auditor -- --as-of <that date>` from a laptop or
   a GitHub Actions cron (files download in ~1 min; load ~2 min).
3. Keep the three xlsx in R2/Blob under `hc-auditor/<as-of>/` if you want
   to reprocess later; Postgres holds only sha256 + as-of in
   `ingestion_runs.metadata`.
