# PropPencil — Rental Cash Flow Analyzer

Analyze rental properties for **monthly cash flow** — the headline metric —
across two scenarios side by side:

- **Market rent** (baseline from HUD Fair Market Rents, overridable with a real comp)
- **Section 8** (HUD FMR × payment standard %, with lower vacancy)
- **Airbnb / short-term rental** (occupancy-adjusted revenue from Mashvisor,
  with STR-specific management % and owner-paid costs — shown when a
  Mashvisor key is configured)

Each scenario shows monthly cash flow after mortgage, cash-on-cash ROI, cap
rate, GRM, NOI, a 0-100 **Pencil Score** (weighted: cash flow 30, cash-on-cash
25, cap rate 15, debt coverage 15, price-vs-investor-value 15), and a
**sharpness** threshold rating (**Razor Sharp / Sharp / Pointed / Needs
Sharpening / Broken** — formerly Rare / Fantastic / Great / Good / Poor).
Break-even is treated as Poor by design — this tool is for finding deals that
cash flow.

Every analyzed property is saved automatically to the **Deal Map**
(Leaflet + OpenStreetMap — free, no API key): pins are color-coded by rating,
popups show cash flow for both scenarios, and you can toggle coloring by
Market vs Section 8 vs Airbnb, filter by rating, and manage the pin list in
the sorted table below the map. Pins and assumptions persist per-user in
Neon Postgres (localStorage is the offline fallback and one-time migration
source).

## Auth, accounts & billing

The app is gated by `proxy.ts` behind a signed session cookie (HMAC,
30-day expiry, httpOnly/Secure/SameSite=Lax). Accounts come in two
flavors: self-serve signups at `/signup` (scrypt hashes in a Neon
`users` table) and two founder accounts (`luke.miller`, `bart.miller`)
whose hashes live in env vars. Unauthenticated pages redirect to
`/login`; unauthenticated API calls get 401, which also protects the
paid ATTOM/Mashvisor quotas.

**Plans**: every new account gets **1 free pencil** (full analysis);
after that `/api/analyze` returns 402 and the app offers the
**Investor plan — $19/mo for 100 pencils** via Stripe Checkout
(hosted). A Stripe webhook (`/api/billing/webhook`) keeps the
`entitlements` table in sync; the customer portal handles cancel/card
changes. Founders are unlimited. Live keys run in the Vercel
production env; the development env uses Stripe sandbox keys.

Per-user state (map pins + assumptions + history + saved searches)
lives in a single `user_state` table (jsonb) in Neon Postgres, saved
with a debounce from the client.

## Issue tracking

Work is tracked as GitHub issues titled `PROP-<n>: …` with priority
labels `P0`/`P1`/`P2` and area labels (`security`, `reliability`,
`billing`, `infra`, `ux`, `legal`). The PROP number in the title is
the canonical ID (it may differ from the GitHub issue number). Start
with `gh issue list --label P0`, reference tickets in commits
("Resolves PROP-4"), and file new ideas as new PROP issues.

## Data sources

| Source | What it provides | Key needed |
|---|---|---|
| [Census Bureau Geocoder](https://geocoding.geo.census.gov/) | Address validation, lat/lon, county FIPS | None |
| [HUD FMR API](https://www.huduser.gov/portal/dataset/fmr-api.html) | Fair Market Rents (county + Small Area by ZIP) | Free token |
| [FEMA NFHL](https://hazards.fema.gov/) | Flood zone at the property location | None |
| [Census ACS](https://api.census.gov/) | County tax rate, median rents by bedroom, rental vacancy, population/value trends | Free key |
| [BLS](https://www.bls.gov/) | County unemployment rate | None |
| [FRED](https://fred.stlouisfed.org/) | Current 30-yr mortgage average (auto-fills the rate default) | None |
| Embedded statewide tax table | Tax-rate fallback when no Census key | None |
| [ATTOM Data](https://api.developer.attomdata.com/) *(optional)* | Beds/baths/sqft, **actual tax bill**, value AVM, rental AVM, sale history | Free trial, paid after |
| [Mashvisor](https://www.mashvisor.com/api-doc-v2) *(optional)* | Airbnb occupancy/nightly rate/revenue, rental comps, market historicals, ML deal score | Paid ($129/mo) |

The free path is fully functional on its own. When `ATTOM_API_KEY` is set,
each analysis upgrades itself: the actual tax bill replaces the statewide
rate estimate, the real bedroom count picks the FMR row, and ATTOM's rental
AVM becomes the market-rent baseline (a manual override still wins; Section 8
always keys off FMR). If ATTOM has no record or the call fails, the analysis
silently falls back to the free path.

When `MASHVISOR_API_KEY` is set, two more things light up:

- **Airbnb (STR) scenario** — a third card next to Market and Section 8,
  using occupancy-adjusted revenue for the area (one Mashvisor call per
  analysis, so batch imports stay quota-friendly).
- **Data fidelity check** — an on-demand panel (~6 API calls per click)
  that benchmarks our rent numbers against Mashvisor's traditional rental
  rates, long-term comps, neighborhood historicals, STR seasonality, and
  their ML investment-likelihood score fed with our computed metrics.

Mashvisor data is used live per-analysis and short-term cached only — it is
not bulk-stored or redistributed, per their API terms.

## Setup

1. `cp .env.local.example .env.local` and add your free HUD token
   (register at huduser.gov → Datasets → FMR API). Optionally add an
   ATTOM API key.
2. `npm install`
3. `npm run dev` and open http://localhost:3000

Without a HUD token the app still works — enter a manual rent override under
advanced assumptions.

## How the numbers work

```
gross income   = rent + other income                    (monthly)
operating exp  = taxes + insurance + maintenance
               + management% + vacancy% + other         (monthly)
NOI            = (gross income − operating exp) × 12
mortgage P&I   = amortized from price − down payment
cash flow/mo   = gross income − operating exp − P&I     ← headline
cash invested  = down payment + closing costs + rehab
cash-on-cash   = (cash flow × 12) ÷ cash invested
cap rate       = NOI ÷ price
GRM            = price ÷ annual rent
```

Defaults (all editable in the UI): 20% down, 7.25% / 30yr, 3% closing costs,
0.5%/yr insurance (+40% in FEMA high-risk flood zones, +15% moderate),
1%/yr maintenance reserve, 10% management, 5% vacancy market / 2% Section 8,
Section 8 payment standard 110% of FMR.

### Sharpness thresholds (per unit)

| Sharpness | Monthly cash flow | Cash-on-cash | Cap rate |
|---|---|---|---|
| Razor Sharp *(was Rare)* | ≥ $400 | ≥ 12% | ≥ 8% |
| Sharp *(was Fantastic)* | ≥ $250 | ≥ 10% | — |
| Pointed *(was Great)* | ≥ $150 | ≥ 8% | — |
| Needs Sharpening *(was Good)* | > $50 | ≥ 5% | — |
| Broken *(was Poor)* | anything else (incl. break-even) | | |

**Near-miss nuance:** a deal that misses the next tier by a small margin
(within $50/mo cash flow, 1.5% CoC, or 1% cap rate on every failing metric)
gets a dashed **"Almost \<tier\>"** badge with the exact shortfall — e.g.
*Fantastic · Almost Rare, +$14/mo cash flow away* — because $14/mo should not
decide a purchase. On the map, near-miss pins wear a ring in the next tier's
color.

## Batch import

Upload a CSV (button below the analyze form; `public/sample-batch.csv` shows
the format) with columns `address` (required), `price`, `bedrooms`, `rent` —
header row optional, missing values fall back to the form defaults. Rows are
analyzed sequentially (throttled ~1/sec to be polite to the free Census
geocoder) with a progress bar and per-row error reporting, and every
successful row is pinned to the Deal Map.

## Disclaimer

All figures are estimates from public data. Verify rents with local comps,
taxes with the county auditor, and insurance with real quotes before making
an offer. Not professional advice.
