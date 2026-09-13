import type { FmrData } from "./types";

// HUD Fair Market Rent API — free with a token from
// https://www.huduser.gov/portal/dataset/fmr-api.html
// County entity id = 5-digit state+county FIPS + "99999".
const HUD_URL = "https://www.huduser.gov/hudapi/public/fmr/data";

interface HudBedroomRow {
  zip_code?: string;
  Efficiency: number;
  "One-Bedroom": number;
  "Two-Bedroom": number;
  "Three-Bedroom": number;
  "Four-Bedroom": number;
  year?: string;
}

function toByBedroom(row: HudBedroomRow): FmrData["byBedroom"] {
  return {
    0: Number(row.Efficiency),
    1: Number(row["One-Bedroom"]),
    2: Number(row["Two-Bedroom"]),
    3: Number(row["Three-Bedroom"]),
    4: Number(row["Four-Bedroom"]),
  };
}

export async function getFmr(
  countyFips: string,
  zip: string
): Promise<FmrData> {
  const token = process.env.HUD_API_TOKEN;
  if (!token) {
    throw new Error(
      "HUD_API_TOKEN is not set. Get a free token at huduser.gov (Datasets → API) and add it to .env.local."
    );
  }
  const entityId = `${countyFips}99999`;
  const res = await fetch(`${HUD_URL}/${entityId}`, {
    headers: { Authorization: `Bearer ${token}` },
    next: { revalidate: 86400 },
  });
  if (res.status === 401) throw new Error("HUD API token was rejected (401).");
  if (!res.ok) throw new Error(`HUD FMR API returned ${res.status}`);
  const json = await res.json();
  const data = json?.data;
  if (!data?.basicdata) throw new Error("HUD FMR API returned no data for this county.");

  const year = Number(
    (Array.isArray(data.basicdata) ? data.basicdata[0]?.year : data.basicdata.year) ??
      new Date().getFullYear()
  );
  const areaName = data.area_name ?? data.county_name ?? "";

  // In Small Area FMR metros, basicdata is an array of per-ZIP rows.
  if (Array.isArray(data.basicdata)) {
    const zipRow = data.basicdata.find(
      (r: HudBedroomRow) => r.zip_code && r.zip_code === zip
    );
    if (zipRow) {
      return {
        year,
        areaName,
        smallAreaUsed: true,
        zip,
        byBedroom: toByBedroom(zipRow),
      };
    }
    // fall back to the metro-wide row (no zip_code) or the first row
    const metroRow =
      data.basicdata.find((r: HudBedroomRow) => !r.zip_code) ?? data.basicdata[0];
    return {
      year,
      areaName,
      smallAreaUsed: false,
      byBedroom: toByBedroom(metroRow),
    };
  }

  return {
    year,
    areaName,
    smallAreaUsed: false,
    byBedroom: toByBedroom(data.basicdata),
  };
}
