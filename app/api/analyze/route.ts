import { NextRequest, NextResponse } from "next/server";
import { canPencil, recordPencil } from "@/lib/users";
import { runWithCallLog } from "@/lib/providerCache";
import { findOwnedFacts, recordAnalysis } from "@/lib/analyses";
import { FORMULA_VERSION } from "@/lib/metrics";
import { getAttomRentalAvm } from "@/lib/attom";
import { checkRateLimit, tooMany } from "@/lib/ratelimit";
import { reportError } from "@/lib/reportError";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";
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
  // metering: founders unlimited; paid plans get a monthly allowance;
  // everyone else gets one free pencil, then a 402 with the reason
  const user = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Burst guard per account — protects the paid ATTOM/Mashvisor quota
  // from scripted loops. The monthly pencil quota is enforced below.
  const rl = await checkRateLimit("analyze_user", user, 10, 60);
  if (!rl.allowed) {
    return tooMany(
      "That's a lot of pencils at once — wait a minute and try again.",
      rl.retryAfterSecs
    );
  }
  const permission = await canPencil(user)
    .catch((err) => {
      reportError(err, { event: "can_pencil_failed", severity: "error", username: user });
      return null;
    });
  if (!permission) {
    return NextResponse.json(
      { error: "Could not check your plan — try again." },
      { status: 500 }
    );
  }
  if (!permission.allowed) {
    return NextResponse.json(
      {
        error:
          permission.reason === "quota"
            ? "You've used this month's pencil allowance."
            : permission.reason === "verify_email"
              ? "Verify your email to unlock your free pencil."
              : permission.reason === "ip_capped"
                ? "Free analyses aren't available from this connection right now — subscribe to keep penciling."
                : "You've used your free pencil.",
        // verify_email gets its own client prompt; ip_capped shares the
        // upgrade CTA (any non-"quota"/"verify_email" → upgrade).
        paywall:
          permission.reason === "quota"
            ? "quota"
            : permission.reason === "verify_email"
              ? "verify_email"
              : "upgrade",
      },
      { status: 402 }
    );
  }

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
    const { result: payload, calls } = await runWithCallLog(async () => {
    const property = await geocodeAddress(address);

    // "312 WALNUT ST, CINCINNATI, OH, 45202" → street / city components
    const addrParts = property.matchedAddress.split(",").map((s) => s.trim());
    const street = addrParts[0] ?? "";
    const city = addrParts[1] ?? "";

    // Owned-market short-circuit (Phase 4 step 5): if this address resolves
    // to an owned auditor-backed property, its facts and tax bill come from
    // PropPencil data — the ATTOM property/tax call is skipped entirely
    // and ATTOM is used for the rental AVM only. Bedrooms come from the
    // source where it carries them (Greene); otherwise NULL/user.
    const ownedFacts = await findOwnedFacts(
      street,
      property.zip,
      property.countyFips ?? null
    ).catch(() => null);

    let fmr: FmrData | null = null;
    let fmrError: boolean | undefined;
    let attom: AttomData | null = null;
    let attomError: boolean | undefined;
    let mashvisor: MashvisorData | null = null;
    let mashvisorError: boolean | undefined;
    const [fmrResult, flood, attomResult, acsRent, tax, mashvisorResult, marketHealth] = await Promise.all([
      getFmr(property.countyFips, property.zip).catch((e: Error) => e),
      getFloodZone(property.lat, property.lon),
      (ownedFacts
        ? getAttomRentalAvm(property.matchedAddress)
        : getAttomData(property.matchedAddress)
      ).catch((e: Error) => e),
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
    // Provider failure details stay in server logs (and the founder
    // /api/health checks); the client only learns that a source was
    // unavailable, never why.
    if (fmrResult instanceof Error) {
      console.error("analyze_source_failed", "hud", fmrResult.message);
      fmrError = true;
    } else {
      fmr = fmrResult;
    }
    if (attomResult instanceof Error) {
      console.error("analyze_source_failed", "attom", attomResult.message);
      attomError = true;
    } else {
      attom = attomResult;
    }
    if (mashvisorResult instanceof Error) {
      console.error("analyze_source_failed", "mashvisor", mashvisorResult.message);
      mashvisorError = true;
    } else {
      mashvisor = mashvisorResult;
    }

    await recordPencil(user, permission.source).catch((err) => {
      // Metering write failure must never break the analysis — but it must
      // not be silent: a swallowed failure here gives away a free/paid pencil
      // that was never counted (revenue leak).
      reportError(err, {
        event: "record_pencil_failed",
        severity: "alert",
        username: user,
        extra: { source: permission.source },
      });
    });

    let factsProvenance: string | undefined;
    if (ownedFacts) {
      attom = {
        ...(attom ?? {}),
        beds: ownedFacts.beds ?? undefined,
        baths: ownedFacts.baths ?? undefined,
        sqft: ownedFacts.livingAreaSqft ?? undefined,
        yearBuilt: ownedFacts.yearBuilt ?? undefined,
        assessedValue: ownedFacts.assessedValue ?? undefined,
        annualTaxAmount: ownedFacts.annualTaxes ?? undefined,
        lastSalePrice: ownedFacts.lastSalePrice ?? undefined,
        lastSaleDate: ownedFacts.lastSaleDate ?? undefined,
      };
      attomError = undefined;
      factsProvenance = `${ownedFacts.county ?? "County"} County Auditor, file as of ${ownedFacts.factsAsOf ?? "latest load"}`;
    }

    const p: AnalyzeResponse = {
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
      factsProvenance,
    };
    return p;
    });

    // persist the pencil — never fail the request over bookkeeping
    await recordAnalysis({
      username: user,
      addressInput: address,
      matchedAddress: payload.property.matchedAddress,
      countyFips: payload.property.countyFips,
      state: payload.property.state,
      inputs: { address },
      result: payload,
      formulaVersion: FORMULA_VERSION,
      providerCalls: calls,
    }).catch((err) =>
      reportError(err, {
        event: "record_analysis_failed",
        severity: "error",
        username: user,
      })
    );

    return NextResponse.json(payload);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Analysis failed";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
