import { NextRequest, NextResponse } from "next/server";
import { geocodeAddress } from "@/lib/geocode";
import { getFmr } from "@/lib/hud";
import { getFloodZone } from "@/lib/fema";
import { estimateTaxRateForCounty } from "@/lib/tax";
import { getCountyMedianRent } from "@/lib/acs";
import { getMarketHealth } from "@/lib/market";
import { getAttomData } from "@/lib/attom";
import { getMashvisorAnalyze } from "@/lib/mashvisor";
import type {
  AnalyzeResponse,
  AttomData,
  FmrData,
  MashvisorData,
} from "@/lib/types";

export async function POST(req: NextRequest) {
  let address: string;
  try {
    const body = await req.json();
    address = String(body.address ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!address) {
    return NextResponse.json({ error: "address is required" }, { status: 400 });
  }

  try {
    const property = await geocodeAddress(address);

    // "312 WALNUT ST, CINCINNATI, OH, 45202" → street / city components
    const addrParts = property.matchedAddress.split(",").map((s) => s.trim());
    const street = addrParts[0] ?? "";
    const city = addrParts[1] ?? "";

    let fmr: FmrData | null = null;
    let fmrError: string | undefined;
    let attom: AttomData | null = null;
    let attomError: string | undefined;
    let mashvisor: MashvisorData | null = null;
    let mashvisorError: string | undefined;
    const [fmrResult, flood, attomResult, acsRent, tax, mashvisorResult, marketHealth] = await Promise.all([
      getFmr(property.countyFips, property.zip).catch((e: Error) => e),
      getFloodZone(property.lat, property.lon),
      getAttomData(property.matchedAddress).catch((e: Error) => e),
      getCountyMedianRent(property.countyFips, property.countyName).catch(
        () => null
      ),
      estimateTaxRateForCounty(
        property.countyFips,
        property.state,
        property.countyName
      ),
      getMashvisorAnalyze({
        state: property.state,
        city,
        zip: property.zip,
        address: street,
        lat: property.lat,
        lon: property.lon,
      }).catch((e: Error) => e),
      getMarketHealth(property.countyFips, property.countyName).catch(
        () => null
      ),
    ]);
    if (fmrResult instanceof Error) {
      fmrError = fmrResult.message;
    } else {
      fmr = fmrResult;
    }
    if (attomResult instanceof Error) {
      attomError = attomResult.message;
    } else {
      attom = attomResult;
    }
    if (mashvisorResult instanceof Error) {
      mashvisorError = mashvisorResult.message;
    } else {
      mashvisor = mashvisorResult;
    }

    const payload: AnalyzeResponse = {
      property,
      fmr,
      fmrError,
      flood,
      tax,
      acsRent,
      marketHealth,
      attom,
      attomError,
      mashvisor,
      mashvisorError,
    };
    return NextResponse.json(payload);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Analysis failed";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
