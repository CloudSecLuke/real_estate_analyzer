import type {
  AddressProvider,
  AddressSuggestion,
  CanonicalAddress,
  ListingProvider,
  ListingRecord,
  ParcelProvider,
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

// Demo-mode providers (PROP-24; spec §49). The app must work with ZERO
// external keys, and the demo must show why property-level comps matter:
// these Cincinnati fixtures span distinct profiles whose rents differ far
// more than any county average would suggest. Addresses are FICTIONAL by
// policy (no real addresses on pages) but geographically plausible.

interface Fixture {
  key: string;
  address: CanonicalAddress;
  property: Omit<PropertyRecord, "provider" | "address">;
  listing?: {
    status: "active" | "pending";
    listPrice: number;
    daysOnMarket: number;
  };
  rentAvm: { rent: number; low: number; high: number };
  compRents: number[]; // nearby comp rents; engine will score/trim
  taxAnnual: number;
}

const FIXTURES: Fixture[] = [
  {
    key: "100-pencil-ln",
    address: {
      streetAddress: "100 Pencil Ln",
      city: "Cincinnati",
      state: "OH",
      postalCode: "45202",
      county: "Hamilton County",
      countyFips: "39061",
      latitude: 39.1099,
      longitude: -84.5155,
    },
    property: {
      bedrooms: 3,
      bathrooms: 1,
      livingAreaSqFt: 1420,
      lotSizeSqFt: 4300,
      yearBuilt: 1912,
      propertyType: "Single Family",
      stories: 2,
      hasBasement: true,
      assessedValue: 94000,
      lastSaleDate: "2019-06-14",
      lastSalePrice: 87500,
      taxAnnual: 1876,
      taxYear: 2025,
    },
    listing: { status: "active", listPrice: 118000, daysOnMarket: 34 },
    rentAvm: { rent: 1275, low: 1180, high: 1390 },
    compRents: [1195, 1225, 1250, 1275, 1295, 1320, 1350, 2400],
    taxAnnual: 1876,
  },
  {
    key: "20-sharpener-ct",
    address: {
      streetAddress: "20 Sharpener Ct",
      city: "Covington",
      state: "KY",
      postalCode: "41011",
      county: "Kenton County",
      countyFips: "21117",
      latitude: 39.0837,
      longitude: -84.5086,
    },
    property: {
      bedrooms: 3,
      bathrooms: 2,
      livingAreaSqFt: 1650,
      yearBuilt: 1955,
      propertyType: "Single Family",
      stories: 1,
      garageSpaces: 1,
      assessedValue: 152000,
      lastSaleDate: "2023-03-02",
      lastSalePrice: 168000,
      taxAnnual: 2140,
      taxYear: 2025,
    },
    listing: { status: "active", listPrice: 189900, daysOnMarket: 12 },
    rentAvm: { rent: 1725, low: 1600, high: 1850 },
    compRents: [1595, 1650, 1700, 1725, 1750, 1795, 1850],
    taxAnnual: 2140,
  },
  {
    key: "7-eraser-way",
    address: {
      streetAddress: "7 Eraser Way",
      city: "Decatur",
      state: "IL",
      postalCode: "62521",
      county: "Macon County",
      countyFips: "17115",
      latitude: 39.8403,
      longitude: -88.9548,
    },
    property: {
      bedrooms: 3,
      bathrooms: 1,
      livingAreaSqFt: 1180,
      yearBuilt: 1948,
      propertyType: "Single Family",
      assessedValue: 41000,
      lastSaleDate: "2021-10-19",
      lastSalePrice: 52000,
      taxAnnual: 1420,
      taxYear: 2025,
    },
    listing: { status: "active", listPrice: 64900, daysOnMarket: 58 },
    rentAvm: { rent: 815, low: 750, high: 895 },
    compRents: [725, 765, 795, 815, 840, 870, 1600],
    taxAnnual: 1420,
  },
  {
    key: "42-graphite-ave",
    address: {
      streetAddress: "42 Graphite Ave",
      city: "Cincinnati",
      state: "OH",
      postalCode: "45208",
      county: "Hamilton County",
      countyFips: "39061",
      latitude: 39.1436,
      longitude: -84.4355,
    },
    property: {
      bedrooms: 4,
      bathrooms: 2.5,
      livingAreaSqFt: 2380,
      yearBuilt: 1994,
      propertyType: "Single Family",
      stories: 2,
      garageSpaces: 2,
      assessedValue: 372000,
      lastSaleDate: "2018-08-30",
      lastSalePrice: 349000,
      taxAnnual: 7480,
      taxYear: 2025,
    },
    listing: { status: "active", listPrice: 465000, daysOnMarket: 21 },
    rentAvm: { rent: 2850, low: 2650, high: 3050 },
    compRents: [2600, 2725, 2800, 2850, 2900, 2995, 3100],
    taxAnnual: 7480,
  },
  {
    key: "9-ferrule-st",
    address: {
      streetAddress: "9 Ferrule St",
      city: "Cincinnati",
      state: "OH",
      postalCode: "45225",
      county: "Hamilton County",
      countyFips: "39061",
      latitude: 39.1231,
      longitude: -84.5529,
    },
    property: {
      bedrooms: 2,
      bathrooms: 1,
      livingAreaSqFt: 980,
      yearBuilt: 1928,
      propertyType: "Duplex (per unit)",
      assessedValue: 68000,
      taxAnnual: 1310,
      taxYear: 2025,
    },
    // No active listing — exercises the couldn't-verify-a-price path.
    rentAvm: { rent: 995, low: 900, high: 1090 },
    compRents: [895, 940, 975, 995, 1020, 1075],
    taxAnnual: 1310,
  },
];

const MOCK = "mock";

function suggestionFor(f: Fixture): AddressSuggestion {
  return {
    provider: MOCK,
    providerId: f.key,
    displayAddress: `${f.address.streetAddress}, ${f.address.city}, ${f.address.state} ${f.address.postalCode}`,
    city: f.address.city,
    state: f.address.state,
    postalCode: f.address.postalCode,
    latitude: f.address.latitude,
    longitude: f.address.longitude,
    matchScore: 1,
  };
}

function findFixture(address: CanonicalAddress): Fixture | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  return FIXTURES.find(
    (f) =>
      norm(f.address.streetAddress) === norm(address.streetAddress) ||
      (address.postalCode === f.address.postalCode &&
        norm(address.streetAddress).includes(norm(f.address.streetAddress).slice(0, 8)))
  );
}

function jitter(base: number, i: number, spreadPct: number): number {
  // Deterministic pseudo-variation so fixtures look organic but tests
  // stay reproducible (no Math.random).
  const t = Math.sin(i * 12.9898) * 43758.5453;
  return Math.round(base * (1 + ((t - Math.floor(t)) - 0.5) * 2 * spreadPct));
}

const nowIso = () => new Date().toISOString();

export const mockProviders: {
  address: AddressProvider;
  parcel: ParcelProvider;
  property: PropertyDataProvider;
  listing: ListingProvider;
  rental: RentalDataProvider;
  salesComp: SalesCompProvider;
  tax: TaxProvider;
} = {
  address: {
    name: MOCK,
    async autocomplete(query) {
      const q = query.toLowerCase();
      if (q.length < 3) return [];
      return FIXTURES.filter((f) =>
        `${f.address.streetAddress} ${f.address.city} ${f.address.state} ${f.address.postalCode}`
          .toLowerCase()
          .includes(q.trim())
      ).map(suggestionFor);
    },
    async resolve(s) {
      const f = FIXTURES.find((x) => x.key === s.providerId);
      if (!f) throw new Error("unknown mock property");
      return {
        ...f.address,
        provider: MOCK,
        providerId: f.key,
        parcelId: `MOCK-${f.key}`,
        normalizedAddress: suggestionFor(f).displayAddress.toUpperCase(),
      };
    },
  },

  parcel: {
    name: MOCK,
    async getParcelById(id) {
      const f = FIXTURES.find((x) => `MOCK-${x.key}` === id || x.key === id);
      if (!f) return null;
      return {
        provider: MOCK,
        providerId: f.key,
        parcelId: `MOCK-${f.key}`,
        address: f.address,
        lotSizeSqFt: f.property.lotSizeSqFt,
      };
    },
    async resolveAddress(address) {
      const f = findFixture(address);
      return f ? this.getParcelById(f.key) : null;
    },
  },

  property: {
    name: MOCK,
    async getProperty(input) {
      const f =
        FIXTURES.find((x) => x.key === input.providerId) ??
        findFixture(input.address);
      if (!f) return null;
      return { provider: MOCK, address: f.address, providerId: f.key, ...f.property };
    },
  },

  listing: {
    name: MOCK,
    async findListings(query) {
      const f = query.address ? findFixture(query.address) : undefined;
      if (!f?.listing) return [];
      const l: ListingRecord = {
        id: `mock-listing-${f.key}`,
        provider: MOCK,
        providerListingId: `L-${f.key}`,
        status: f.listing.status,
        listingType: "sale",
        address: f.address,
        listPrice: f.listing.listPrice,
        bedrooms: f.property.bedrooms,
        bathrooms: f.property.bathrooms,
        livingAreaSqFt: f.property.livingAreaSqFt,
        propertyType: f.property.propertyType,
        yearBuilt: f.property.yearBuilt,
        daysOnMarket: f.listing.daysOnMarket,
        lastSeenAt: nowIso(),
        confidence: 0.98,
      };
      return [l];
    },
    async resolveListingUrl(url) {
      // Demo URL format: https://demo.proppencil.com/listing/<fixture-key>
      const m = url.pathname.match(/listing\/([a-z0-9-]+)/);
      const f = m ? FIXTURES.find((x) => x.key === m[1]) : undefined;
      if (!f) return null;
      const [l] = await this.findListings!({ address: f.address });
      return l ?? null;
    },
  },

  rental: {
    name: MOCK,
    async getRentEstimate(input): Promise<ProviderRentEstimate | null> {
      const f = findFixture(input.address);
      if (!f) return null;
      return {
        provider: MOCK,
        rent: f.rentAvm.rent,
        low: f.rentAvm.low,
        high: f.rentAvm.high,
        compCount: f.compRents.length,
        retrievedAt: nowIso(),
      };
    },
    async getRentalComps(input): Promise<RentalComp[]> {
      const f = findFixture(input.address);
      if (!f) return [];
      return f.compRents.map((rent, i) => ({
        id: `mock-comp-${f.key}-${i}`,
        provider: MOCK,
        rent,
        bedrooms: f.property.bedrooms! + (i % 3 === 2 ? 1 : 0) * (i % 2 ? 1 : -1),
        bathrooms: f.property.bathrooms,
        livingAreaSqFt: jitter(f.property.livingAreaSqFt ?? 1400, i, 0.12),
        propertyType: f.property.propertyType,
        yearBuilt: (f.property.yearBuilt ?? 1950) + (i - 3) * 4,
        distanceMiles: Math.round((0.2 + i * 0.28) * 10) / 10,
        listingDate: new Date(Date.now() - (20 + i * 25) * 86400000)
          .toISOString()
          .slice(0, 10),
        confidence: 0.9,
      }));
    },
  },

  salesComp: {
    name: MOCK,
    async getSalesComps(input): Promise<SalesComp[]> {
      const f = findFixture(input.address);
      if (!f?.listing) return [];
      return [0.93, 0.97, 1.0, 1.04, 1.08].map((mult, i) => ({
        id: `mock-sale-${f.key}-${i}`,
        provider: MOCK,
        salePrice: Math.round((f.listing!.listPrice * mult) / 500) * 500,
        saleDate: new Date(Date.now() - (30 + i * 40) * 86400000)
          .toISOString()
          .slice(0, 10),
        bedrooms: f.property.bedrooms,
        bathrooms: f.property.bathrooms,
        livingAreaSqFt: jitter(f.property.livingAreaSqFt ?? 1400, i + 7, 0.1),
        distanceMiles: Math.round((0.3 + i * 0.35) * 10) / 10,
        confidence: 0.85,
      }));
    },
  },

  tax: {
    name: MOCK,
    async getPropertyTaxes(input): Promise<TaxRecord | null> {
      const f =
        FIXTURES.find((x) => x.key === input.providerId) ??
        findFixture(input.address);
      if (!f) return null;
      return {
        provider: MOCK,
        annualAmount: f.taxAnnual,
        year: 2025,
        assessedValue: f.property.assessedValue,
        confidence: 0.95,
      };
    },
  },
};

/** Exposed for tests and the demo landing. */
export const MOCK_FIXTURE_KEYS = FIXTURES.map((f) => f.key);
