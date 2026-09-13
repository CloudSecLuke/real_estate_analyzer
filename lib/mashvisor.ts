import type {
  CompareRequest,
  CompareResponse,
  HistoricalMonth,
  MashvisorData,
  RentByBedroom,
} from "./types";

// Mashvisor API — optional paid subscription ($129/mo tier). Powers the
// short-term-rental (Airbnb) scenario and the on-demand data-fidelity
// comparison. Docs: https://www.mashvisor.com/api-doc-v2
//
// Quota discipline: /api/analyze spends ONE Mashvisor call per address
// (rento-calculator/lookup); everything else runs only when the user
// clicks the compare button. Responses are cached for a day.
//
// NOTE: response parsing is tolerant (endpoints were wired before the key
// was purchased) — once live, tighten against real payloads.
const BASE = "https://api.mashvisor.com/v1.1/client";

/* eslint-disable @typescript-eslint/no-explicit-any */

function num(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function requireKey(): string {
  const key = process.env.MASHVISOR_API_KEY;
  if (!key) throw new Error("MASHVISOR_API_KEY is not set.");
  return key;
}

async function mvFetch(
  path: string,
  params: Record<string, string | number | undefined>,
  method: "GET" | "POST" = "GET"
): Promise<any> {
  const key = requireKey();
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") qs.set(k, String(v));
  }
  // POST endpoints (the ML models) read params from a form body, not the URL
  const res = await fetch(method === "GET" ? `${BASE}/${path}?${qs}` : `${BASE}/${path}`, {
    method,
    headers: {
      "x-api-key": key,
      Accept: "application/json",
      ...(method === "POST"
        ? { "Content-Type": "application/x-www-form-urlencoded" }
        : {}),
    },
    body: method === "POST" ? qs.toString() : undefined,
    next: { revalidate: 86400 },
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `Mashvisor API key rejected (${res.status}) — check the subscription is active.`
    );
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      `Mashvisor ${path} returned ${res.status}${
        json?.message ? `: ${json.message}` : ""
      }`
    );
  }
  if (json?.status && json.status !== "success") {
    throw new Error(`Mashvisor ${path}: ${json?.message ?? "request failed"}`);
  }
  return json?.content ?? null;
}

interface AddressParams {
  state: string;
  city: string;
  zip: string;
  address: string;
  lat: number;
  lon: number;
  beds?: number;
}

/**
 * Analyze-time lookups (two calls): the area's Airbnb performance and the
 * property's listing facts (beds/baths/sqft/list price) for auto-filling
 * the form. Returns null when no key is configured; each call fails
 * independently so partial data still comes through.
 */
export async function getMashvisorAnalyze(
  p: AddressParams
): Promise<MashvisorData | null> {
  if (!process.env.MASHVISOR_API_KEY) return null;
  const [strContent, propContent] = await Promise.all([
    mvFetch("rento-calculator/lookup", {
      state: p.state,
      city: p.city,
      zip_code: p.zip,
      address: p.address,
      lat: p.lat,
      lng: p.lon,
      beds: p.beds,
      resource: "airbnb",
    }).catch(() => null),
    mvFetch("traditional-property", {
      state: p.state,
      city: p.city,
      zip_code: p.zip,
      address: p.address,
    }).catch(() => null),
  ]);

  const out: MashvisorData = {};

  if (strContent) {
    const monthlyRevenue = num(
      strContent.adjusted_rental_income ?? strContent.median_rental_income
    );
    // occupancy may arrive as 0-1 or 0-100
    let occupancyPct = num(strContent.median_occupancy_rate);
    if (occupancyPct !== undefined && occupancyPct <= 1) occupancyPct *= 100;
    const str = {
      monthlyRevenue,
      occupancyPct,
      nightlyRate: num(strContent.median_night_rate),
      medianHomeValue: num(strContent.median_home_value),
      marketLabel: strContent.market
        ? [strContent.market.city, strContent.market.state]
            .filter(Boolean)
            .join(", ")
        : undefined,
    };
    if (str.monthlyRevenue || str.nightlyRate) out.str = str;
  }

  if (propContent) {
    // response may be the property object itself or nested under `property`
    const prop = propContent.property ?? propContent;
    // `price` is a SALE price only for sale listings — on rental records
    // (status "rented"/"for rent") it's the monthly rent. Verified live:
    // a Turbotenant rental came back with price=1200 (rent, not value).
    const status = String(prop?.status ?? "").toLowerCase();
    const isSaleListing = /active|sale|pending/.test(status);
    const listing = {
      beds: num(prop?.beds),
      baths: num(prop?.baths),
      sqft: num(prop?.sqft),
      yearBuilt: num(prop?.year_built),
      listPrice: isSaleListing
        ? num(prop?.price ?? prop?.list_price)
        : undefined,
      propertyType: prop?.property_type ?? prop?.property_sub_type ?? undefined,
    };
    if (Object.values(listing).some((v) => v !== undefined)) {
      out.listing = listing;
    }
  }

  return out.str || out.listing ? out : null;
}

function parseHistorical(c: any): {
  months: HistoricalMonth[];
  rentalIncomeYoYPct?: number;
  occupancyYoYPct?: number;
} {
  const rows: any[] = Array.isArray(c?.historical_performance)
    ? [...c.historical_performance].sort(
        (a, b) => Number(a.year) - Number(b.year) || Number(a.month) - Number(b.month)
      )
    : [];
  return {
    months: rows.map((r) => {
      let occ = num(r.occupancy);
      if (occ !== undefined && occ <= 1) occ *= 100;
      return {
        year: Number(r.year),
        month: Number(r.month),
        rentalIncome: num(r.rental_income),
        nightPrice: num(r.night_price),
        occupancyPct: occ,
      };
    }),
    rentalIncomeYoYPct: num(Math.abs(Number(c?.rental_income_yoy_changes)))
      ? Number(c.rental_income_yoy_changes)
      : undefined,
    occupancyYoYPct: num(Math.abs(Number(c?.occupancy_yoy_changes)))
      ? Number(c.occupancy_yoy_changes)
      : undefined,
  };
}

function parseRatesByBedroom(rates: any): RentByBedroom {
  return {
    0: num(rates?.studio_value ?? rates?.zero_room_value),
    1: num(rates?.one_room_value),
    2: num(rates?.two_room_value),
    3: num(rates?.three_room_value),
    4: num(rates?.four_room_value),
  };
}

/** Haversine-free nearest pick — fine at neighborhood scale. */
function nearestNeighborhood(list: any[], lat: number, lon: number): any {
  let best = list[0];
  let bestD = Infinity;
  for (const n of list) {
    const nlat = Number(n.latitude ?? n.lat);
    const nlon = Number(n.longitude ?? n.lng ?? n.lon);
    if (!Number.isFinite(nlat) || !Number.isFinite(nlon)) continue;
    const d = (nlat - lat) ** 2 + (nlon - lon) ** 2;
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

/**
 * On-demand deep comparison (~6 calls). Each section fails independently
 * into `errors` so one bad endpoint doesn't sink the panel.
 */
export async function getMashvisorCompare(
  req: CompareRequest
): Promise<CompareResponse> {
  requireKey();
  const errors: Record<string, string> = {};
  const grab = async <T>(
    section: string,
    fn: () => Promise<T>
  ): Promise<T | null> => {
    try {
      return await fn();
    } catch (e) {
      errors[section] = e instanceof Error ? e.message : "request failed";
      return null;
    }
  };

  const loc = { state: req.state, city: req.city, zip_code: req.zip };

  const [traditionalRates, strHistorical, traditionalHistorical, comps, likelihood, neighborhoodHistorical] =
    await Promise.all([
      grab("traditionalRates", async () => {
        const c = await mvFetch("rental-rates", { ...loc, source: "traditional" });
        const byBedroom = parseRatesByBedroom(c?.retnal_rates ?? c?.rental_rates);
        return { byBedroom, sampleCount: num(c?.sample_count) };
      }),
      grab("strHistorical", async () => {
        const c = await mvFetch("rento-calculator/historical-performance", {
          state: req.state,
          city: req.city,
          zip_code: req.zip,
          address: req.address,
          lat: req.lat,
          lng: req.lon,
          beds: req.beds,
          resource: "airbnb",
        });
        return parseHistorical(c);
      }),
      grab("traditionalHistorical", async () => {
        const c = await mvFetch("rento-calculator/historical-performance", {
          state: req.state,
          city: req.city,
          zip_code: req.zip,
          address: req.address,
          lat: req.lat,
          lng: req.lon,
          beds: req.beds,
          resource: "traditional",
        });
        return parseHistorical(c);
      }),
      grab("comps", async () => {
        const c = await mvFetch("long-term-comps", {
          state: req.state,
          city: req.city,
          zipcode: req.zip,
          min_beds: Math.max(1, req.beds - 1),
          max_beds: Math.min(5, req.beds + 1),
          exclude_rented: 0,
          limit: 10,
        });
        const props: any[] = c?.properties ?? [];
        const rents = props
          .map((p) => num(p.price))
          .filter((n): n is number => n !== undefined)
          .sort((a, b) => a - b);
        return {
          count: num(c?.total_results) ?? props.length,
          medianRent: rents.length
            ? rents[Math.floor(rents.length / 2)]
            : undefined,
          items: props.slice(0, 5).map((p) => ({
            address: [p.address, p.city].filter(Boolean).join(", "),
            rent: num(p.price),
            beds: num(p.beds),
            sqft: num(p.sqft),
          })),
        };
      }),
      grab("likelihood", async () => {
        // Feed OUR computed metrics to their ML model — it scores inputs,
        // it doesn't look up addresses.
        if (!req.traditionalRent) {
          throw new Error("no traditional rent computed to score");
        }
        const c = await mvFetch(
          "ml/investment-likelihood",
          {
            airbnb_ROI: req.strCoc ?? 0,
            airbnb_rental: req.strRent ?? 0,
            traditional_ROI: req.traditionalCoc ?? 0,
            traditional_rental: req.traditionalRent,
            beds: req.beds,
            baths: req.baths ?? 1,
            sqft: req.sqft ?? 1200,
            list_price: req.price,
            days_on_market: 30,
            home_type: "Single Family Residential",
          },
          "POST"
        );
        const contact = c?.contact ?? c;
        return {
          prediction: Number(contact?.prediction?.Value ?? NaN) || undefined,
          likelihoodPct: num(contact?.prediction_likelihood?.Value),
        };
      }),
      grab("neighborhoodHistorical", async () => {
        const c = await mvFetch(
          `city/neighborhoods/${encodeURIComponent(req.state)}/${encodeURIComponent(req.city)}`,
          {}
        );
        const list: any[] = Array.isArray(c)
          ? c
          : c?.results ?? c?.neighborhoods ?? [];
        if (!list.length) throw new Error("no neighborhoods found for city");
        const hood = nearestNeighborhood(list, req.lat, req.lon);
        const h = await mvFetch(`neighborhood/${hood.id}/historical/traditional`, {
          state: req.state,
          beds: Math.min(4, Math.max(0, req.beds)),
        });
        const months: any[] = h?.months ?? [];
        return {
          neighborhoodName: hood.name,
          averages: h?.averages ? parseRatesByBedroom(h.averages) : undefined,
          months: months.slice(-12).map((m) => ({
            year: Number(m.year),
            month: Number(m.month),
            byBedroom: parseRatesByBedroom(m),
          })),
        };
      }),
    ]);

  return {
    traditionalRates,
    strHistorical,
    traditionalHistorical,
    comps,
    likelihood,
    neighborhoodHistorical,
    errors,
  };
}
