import type { FloodData } from "./types";

// FEMA National Flood Hazard Layer — free ArcGIS REST service.
// Layer 28 = flood hazard zones.
const NFHL_URL =
  "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query";

export async function getFloodZone(lat: number, lon: number): Promise<FloodData> {
  const params = new URLSearchParams({
    geometry: `${lon},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "FLD_ZONE,ZONE_SUBTY",
    returnGeometry: "false",
    f: "json",
  });
  try {
    const res = await fetch(`${NFHL_URL}?${params}`, {
      next: { revalidate: 86400 },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`FEMA NFHL returned ${res.status}`);
    const json = await res.json();
    const attrs = json?.features?.[0]?.attributes;
    if (!attrs?.FLD_ZONE) {
      return { zone: null, highRisk: false, moderateRisk: false, source: "FEMA NFHL" };
    }
    const zone: string = attrs.FLD_ZONE;
    const subtype: string = attrs.ZONE_SUBTY ?? "";
    const highRisk = zone.startsWith("A") || zone.startsWith("V");
    const moderateRisk =
      zone === "X" && subtype.toUpperCase().includes("0.2 PCT");
    return { zone, highRisk, moderateRisk, source: "FEMA NFHL" };
  } catch {
    // Flood lookup is enrichment, not critical path — degrade gracefully.
    return {
      zone: null,
      highRisk: false,
      moderateRisk: false,
      source: "FEMA NFHL (lookup failed)",
    };
  }
}
