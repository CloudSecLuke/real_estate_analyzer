import type {
  CanonicalAddress,
  ListingProvider,
  ListingRecord,
  PropertyDataProvider,
  PropertyRecord,
  ProviderRentEstimate,
  RentalComp,
  RentalDataProvider,
  SalesComp,
  SalesCompProvider,
  TaxProvider,
  TaxRecord,
} from "./types";
import { cachedValue, TTL } from "@/lib/providerCache";

// RentCast adapter (PROP-27; spec §6): property records + attributes + tax
// history, sale/rental listings, long-term rent AVM with comparables, sale
// comps. Docs: https://developers.rentcast.io — parsed defensively so a
// field rename degrades to missing-data, never a crash. Key server-side.

const BASE = "https://api.rentcast.io/v1";
const NAME = "rentcast";

function headers(): Record<string, string> {
  const key = process.env.RENTCAST_API_KEY;
  if (!key) throw new Error("RENTCAST_API_KEY is not set");
  return { "X-Api-Key": key, Accept: "application/json" };
}

function addrString(a: CanonicalAddress): string {
  return `${a.streetAddress}, ${a.city}, ${a.state}${a.postalCode ? " " + a.postalCode : ""}`;
}

async function rc<T>(
  path: string,
  params: Record<string, string | number | undefined>,
  ttlSeconds: number = TTL.rentcastRent
): Promise<T | null> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") qs.set(k, String(v));
  }
  return cachedValue("rentcast", `${path}?${qs}`, ttlSeconds, async () => {
    const res = await fetch(`${BASE}${path}?${qs}`, { headers: headers() });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`rentcast ${path} ${res.status}`);
    return (await res.json()) as T;
  });
}

// RentCast response shapes (subset, defensive)
interface RcProperty {
  id?: string;
  formattedAddress?: string;
  addressLine1?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  county?: string;
  latitude?: number;
  longitude?: number;
  bedrooms?: number;
  bathrooms?: number;
  squareFootage?: number;
  lotSize?: number;
  yearBuilt?: number;
  propertyType?: string;
  lastSaleDate?: string;
  lastSalePrice?: number;
  hoa?: { fee?: number };
  features?: { garageSpaces?: number; pool?: boolean; heating?: boolean; cooling?: boolean; floorCount?: number };
  taxAssessments?: Record<string, { year?: number; value?: number }>;
  propertyTaxes?: Record<string, { year?: number; total?: number }>;
}

function toAddress(p: RcProperty): CanonicalAddress {
  return {
    streetAddress: p.addressLine1 ?? p.formattedAddress?.split(",")[0] ?? "",
    city: p.city ?? "",
    state: p.state ?? "",
    postalCode: p.zipCode,
    county: p.county,
    latitude: p.latitude,
    longitude: p.longitude,
  };
}

function latestTax(p: RcProperty): { year?: number; total?: number } | undefined {
  const taxes = Object.values(p.propertyTaxes ?? {});
  return taxes.sort((a, b) => (b.year ?? 0) - (a.year ?? 0))[0];
}

export const rentcastProperty: PropertyDataProvider = {
  name: NAME,
  async getProperty(input): Promise<PropertyRecord | null> {
    const rows = await rc<RcProperty[]>("/properties", { address: addrString(input.address) }, TTL.attomProperty);
    const p = rows?.[0];
    if (!p) return null;
    const tax = latestTax(p);
    const assessments = Object.values(p.taxAssessments ?? {}).sort(
      (a, b) => (b.year ?? 0) - (a.year ?? 0)
    );
    return {
      provider: NAME,
      providerId: p.id,
      address: toAddress(p),
      bedrooms: p.bedrooms,
      bathrooms: p.bathrooms,
      livingAreaSqFt: p.squareFootage,
      lotSizeSqFt: p.lotSize,
      yearBuilt: p.yearBuilt,
      propertyType: p.propertyType,
      stories: p.features?.floorCount,
      garageSpaces: p.features?.garageSpaces,
      hasPool: p.features?.pool,
      hoaMonthly: p.hoa?.fee,
      assessedValue: assessments[0]?.value,
      lastSaleDate: p.lastSaleDate,
      lastSalePrice: p.lastSalePrice,
      taxAnnual: tax?.total,
      taxYear: tax?.year,
      raw: p,
    };
  },
};

interface RcListing extends RcProperty {
  status?: string;
  price?: number;
  listingType?: string;
  listedDate?: string;
  lastSeenDate?: string;
  daysOnMarket?: number;
}

function toListing(l: RcListing, listingType: "sale" | "rent"): ListingRecord {
  const active = (l.status ?? "").toLowerCase() === "active";
  return {
    id: `rentcast-${listingType}-${l.id ?? l.formattedAddress}`,
    provider: NAME,
    providerListingId: l.id,
    status: active ? "active" : (l.status ?? "unknown").toLowerCase() === "inactive" ? "off_market" : "unknown",
    listingType,
    address: toAddress(l),
    listPrice: listingType === "sale" ? l.price : undefined,
    listRent: listingType === "rent" ? l.price : undefined,
    bedrooms: l.bedrooms,
    bathrooms: l.bathrooms,
    livingAreaSqFt: l.squareFootage,
    propertyType: l.propertyType,
    yearBuilt: l.yearBuilt,
    listedAt: l.listedDate,
    lastSeenAt: l.lastSeenDate,
    daysOnMarket: l.daysOnMarket,
    confidence: 0.9,
    raw: l,
  };
}

export const rentcastListing: ListingProvider = {
  name: NAME,
  async findListings(query): Promise<ListingRecord[]> {
    if (!query.address) return [];
    const type = query.listingType === "rent" ? "rent" : "sale";
    const path = type === "rent" ? "/listings/rental/long-term" : "/listings/sale";
    const rows = await rc<RcListing[] | RcListing>(path, {
      address: addrString(query.address),
    });
    const list = rows == null ? [] : Array.isArray(rows) ? rows : [rows];
    return list.map((l) => toListing(l, type));
  },
};

type RcComparable = RcListing & { distance?: number; correlation?: number };

interface RcAvm {
  rent?: number;
  rentRangeLow?: number;
  rentRangeHigh?: number;
  comparables?: RcComparable[];
}

export const rentcastRental: RentalDataProvider = {
  name: NAME,
  async getRentEstimate(input): Promise<ProviderRentEstimate | null> {
    const avm = await rc<RcAvm>("/avm/rent/long-term", {
      address: addrString(input.address),
      bedrooms: input.bedrooms,
      bathrooms: input.bathrooms,
      squareFootage: input.livingAreaSqFt,
      propertyType: input.propertyType,
    });
    if (!avm?.rent) return null;
    return {
      provider: NAME,
      rent: avm.rent,
      low: avm.rentRangeLow,
      high: avm.rentRangeHigh,
      compCount: avm.comparables?.length,
      retrievedAt: new Date().toISOString(),
    };
  },
  async getRentalComps(input): Promise<RentalComp[]> {
    const avm = await rc<RcAvm>(
      "/avm/rent/long-term",
      {
        address: addrString(input.address),
        bedrooms: input.bedrooms,
        bathrooms: input.bathrooms,
        squareFootage: input.livingAreaSqFt,
        propertyType: input.propertyType,
      },
      TTL.rentcastComps
    );
    return (avm?.comparables ?? [])
      .filter((c) => typeof c.price === "number" && c.price! > 0)
      .map((c, i) => ({
        id: `rentcast-comp-${c.id ?? i}`,
        provider: NAME,
        providerListingId: c.id,
        address: toAddress(c),
        latitude: c.latitude,
        longitude: c.longitude,
        rent: c.price!,
        bedrooms: c.bedrooms,
        bathrooms: c.bathrooms,
        livingAreaSqFt: c.squareFootage,
        propertyType: c.propertyType,
        yearBuilt: c.yearBuilt,
        listingDate: c.listedDate,
        lastSeenDate: c.lastSeenDate,
        distanceMiles: c.distance,
        similarityScore: c.correlation,
        confidence: 0.85,
      }));
  },
};

export const rentcastSalesComp: SalesCompProvider = {
  name: NAME,
  async getSalesComps(input): Promise<SalesComp[]> {
    const avm = await rc<{ price?: number; comparables?: RcComparable[] }>(
      "/avm/value",
      {
        address: addrString(input.address),
        bedrooms: input.bedrooms,
        bathrooms: input.bathrooms,
        squareFootage: input.livingAreaSqFt,
        propertyType: input.propertyType,
      }
    );
    return (avm?.comparables ?? [])
      .filter((c) => typeof c.price === "number" && c.price! > 0)
      .map((c, i) => ({
        id: `rentcast-sale-${c.id ?? i}`,
        provider: NAME,
        address: toAddress(c),
        salePrice: c.price!,
        saleDate: c.lastSeenDate,
        bedrooms: c.bedrooms,
        bathrooms: c.bathrooms,
        livingAreaSqFt: c.squareFootage,
        distanceMiles: c.distance,
        similarityScore: c.correlation,
        confidence: 0.8,
      }));
  },
};

export const rentcastTax: TaxProvider = {
  name: NAME,
  async getPropertyTaxes(input): Promise<TaxRecord | null> {
    const record = await rentcastProperty.getProperty(input);
    if (!record?.taxAnnual) return null;
    return {
      provider: NAME,
      annualAmount: record.taxAnnual,
      year: record.taxYear,
      assessedValue: record.assessedValue,
      confidence: 0.9,
    };
  },
};

export const rentcastProviders = {
  property: rentcastProperty,
  listing: rentcastListing,
  rental: rentcastRental,
  salesComp: rentcastSalesComp,
  tax: rentcastTax,
};
