import { getAttomData } from "@/lib/attom";
import type {
  PropertyDataProvider,
  PropertyRecord,
  ProviderRentEstimate,
  RentalComp,
  RentalDataProvider,
  TaxProvider,
  TaxRecord,
} from "./types";

// ATTOM as a secondary provider behind the abstraction (PROP-24/spec §7).
// Wraps the existing lib/attom.ts fetcher (allevents + rental AVM) rather
// than reimplementing it; the legacy analyze route keeps using lib/attom.ts
// directly until it migrates onto the provider layer.

const NAME = "attom";

function addr(input: { address: { streetAddress: string; city: string; state: string; postalCode?: string } }): string {
  const a = input.address;
  return `${a.streetAddress}, ${a.city}, ${a.state}${a.postalCode ? ", " + a.postalCode : ""}`;
}

export const attomProperty: PropertyDataProvider = {
  name: NAME,
  async getProperty(input): Promise<PropertyRecord | null> {
    const d = await getAttomData(addr(input));
    if (!d) return null;
    return {
      provider: NAME,
      address: input.address,
      bedrooms: d.beds,
      bathrooms: d.baths,
      livingAreaSqFt: d.sqft,
      yearBuilt: d.yearBuilt,
      propertyType: d.propertyType,
      assessedValue: d.assessedValue,
      lastSalePrice: d.lastSalePrice,
      lastSaleDate: d.lastSaleDate,
      taxAnnual: d.annualTaxAmount,
      taxYear: d.taxYear,
      raw: d,
    };
  },
};

export const attomRental: RentalDataProvider = {
  name: NAME,
  async getRentEstimate(input): Promise<ProviderRentEstimate | null> {
    const d = await getAttomData(addr(input));
    if (!d?.rentalAvm) return null;
    return {
      provider: NAME,
      rent: d.rentalAvm,
      low: d.rentalAvmLow,
      high: d.rentalAvmHigh,
      retrievedAt: new Date().toISOString(),
    };
  },
  async getRentalComps(): Promise<RentalComp[]> {
    return []; // ATTOM rental AVM endpoint doesn't return comps in our tier
  },
};

export const attomTax: TaxProvider = {
  name: NAME,
  async getPropertyTaxes(input): Promise<TaxRecord | null> {
    const d = await getAttomData(addr(input));
    if (!d?.annualTaxAmount) return null;
    return {
      provider: NAME,
      annualAmount: d.annualTaxAmount,
      year: d.taxYear,
      assessedValue: d.assessedValue,
      confidence: 0.9,
    };
  },
};

export const attomProviders = {
  property: attomProperty,
  rental: attomRental,
  tax: attomTax,
};
