import type { AcsRentData } from "./types";

// County-level median gross rent BY BEDROOM COUNT from Census ACS 5-year
// (table B25031). This is the local reality check on HUD FMR: FMR is a
// 40th-percentile *FMR-area* figure that can carry adjustment factors
// borrowed from larger geographies (e.g. Decatur's FY2026 FMR includes a
// 1.17 recent-mover factor from the Chicago-dominated IL metro portion,
// per HUD's own FMR documentation), so in soft markets FMR lands far above
// what local units actually rent for.

// ACS 2019-2023 medians are "as of" ~2023; inflate to the current fiscal
// year the same way HUD does (gross-rent inflation ≈1.065 × trend ≈1.076
// for FY2026 per the Decatur FMR doc). Round figure, clearly labeled.
const ACS_YEAR = 2023;
const INFLATION_TO_CURRENT = 1.15;

const ACS_URL = `https://api.census.gov/data/${ACS_YEAR}/acs/acs5`;

export async function getCountyMedianRent(
  countyFips: string,
  countyName: string
): Promise<AcsRentData | null> {
  const key = process.env.CENSUS_API_KEY;
  if (!key || !/^\d{5}$/.test(countyFips)) return null;

  const geo = {
    for: `county:${countyFips.slice(2)}`,
    in: `state:${countyFips.slice(0, 2)}`,
    key,
  };
  const params = new URLSearchParams({
    // B25031_002E..006E: median gross rent for 0,1,2,3,4-bedroom units
    get: "B25031_002E,B25031_003E,B25031_004E,B25031_005E,B25031_006E",
    ...geo,
  });
  // DP04_0005E: the county's actual rental vacancy rate
  const vacancyParams = new URLSearchParams({ get: "DP04_0005E", ...geo });
  const [res, vacancyRes] = await Promise.all([
    fetch(`${ACS_URL}?${params}`, { next: { revalidate: 2592000 } }),
    fetch(`${ACS_URL}/profile?${vacancyParams}`, {
      next: { revalidate: 2592000 },
    }).catch(() => null),
  ]);
  if (!res.ok) return null;
  const json = await res.json().catch(() => null);
  const row: unknown[] | undefined = json?.[1];
  if (!row) return null;

  let rentalVacancyPct: number | undefined;
  if (vacancyRes?.ok) {
    const vjson = await vacancyRes.json().catch(() => null);
    const v = Number(vjson?.[1]?.[0]);
    if (Number.isFinite(v) && v >= 0 && v < 50) rentalVacancyPct = v;
  }

  const byBedroom: AcsRentData["byBedroom"] = {};
  ([0, 1, 2, 3, 4] as const).forEach((bed, i) => {
    const n = Number(row[i]);
    // ACS uses negative sentinels for suppressed/unavailable estimates
    if (Number.isFinite(n) && n > 100) {
      byBedroom[bed] = Math.round(n * INFLATION_TO_CURRENT);
    }
  });
  if (Object.keys(byBedroom).length === 0) return null;

  return {
    byBedroom,
    acsYear: ACS_YEAR,
    inflationFactor: INFLATION_TO_CURRENT,
    source: `${countyName} median gross rent by bedrooms (Census ACS ${ACS_YEAR}, inflated ×${INFLATION_TO_CURRENT})`,
    rentalVacancyPct,
  };
}
