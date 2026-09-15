// Normalized internal schemas + provider capability interfaces for the
// property-intelligence layer (PROP-24; spec docs/platform-upgrade-spec.md
// §5, §10, §14, §16, §23). Provider adapters translate vendor JSON into
// these shapes at the boundary — vendor formats never travel further.

// ---------------------------------------------------------------------------
// Classification & provenance (spec §23, §58)

/** Every important value carries one of these labels — never implied. */
export type ValueClass =
  | "verified"
  | "estimated"
  | "calculated"
  | "user_provided"
  | "fallback"
  | "unknown";

export interface DataProvenance {
  sourceType:
    | "provider"
    | "government"
    | "listing"
    | "user"
    | "calculated"
    | "fallback";
  provider?: string;
  sourceName?: string;
  sourceRecordId?: string;
  sourceUrl?: string;
  retrievedAt: string; // ISO
  sourceUpdatedAt?: string;
  /** 0..1 */
  confidence: number;
  methodology?: string;
}

export interface DataPoint<T> {
  value: T;
  valueClass: ValueClass;
  provenance: DataProvenance;
}

// ---------------------------------------------------------------------------
// Addresses & identity (spec §8–10)

export interface CanonicalAddress {
  streetAddress: string;
  city: string;
  state: string;
  postalCode?: string;
  county?: string;
  countyFips?: string;
  latitude?: number;
  longitude?: number;
}

export interface AddressSuggestion {
  provider: string;
  providerId: string;
  displayAddress: string;
  city?: string;
  state?: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  matchScore?: number;
}

export interface ResolvedAddress extends CanonicalAddress {
  provider: string;
  providerId?: string;
  parcelId?: string;
  normalizedAddress: string;
}

export interface ParcelRecord {
  provider: string;
  providerId: string;
  parcelId?: string;
  apn?: string;
  address: CanonicalAddress;
  lotSizeSqFt?: number;
  landUse?: string;
}

// ---------------------------------------------------------------------------
// Property records (spec §22)

export interface PropertyRecord {
  provider: string;
  providerId?: string;
  address: CanonicalAddress;
  bedrooms?: number;
  bathrooms?: number;
  livingAreaSqFt?: number;
  lotSizeSqFt?: number;
  yearBuilt?: number;
  propertyType?: string;
  stories?: number;
  garageSpaces?: number;
  hasBasement?: boolean;
  hasPool?: boolean;
  heating?: string;
  cooling?: string;
  hoaMonthly?: number;
  assessedValue?: number;
  lastSaleDate?: string;
  lastSalePrice?: number;
  taxAnnual?: number;
  taxYear?: number;
  /** Raw vendor payload, retained only where provider terms permit. */
  raw?: unknown;
}

// ---------------------------------------------------------------------------
// Listings (spec §14)

export type ListingStatus =
  | "active"
  | "pending"
  | "sold"
  | "off_market"
  | "unknown";
export type ListingType = "sale" | "rent" | "unknown";

export interface ListingRecord {
  id: string;
  provider: string;
  providerListingId?: string;
  propertyId?: string;
  status: ListingStatus;
  listingType: ListingType;
  address: CanonicalAddress;
  listPrice?: number;
  listRent?: number;
  bedrooms?: number;
  bathrooms?: number;
  livingAreaSqFt?: number;
  propertyType?: string;
  yearBuilt?: number;
  listedAt?: string;
  lastSeenAt?: string;
  daysOnMarket?: number;
  description?: string;
  sourceUrl?: string;
  sourceUpdatedAt?: string;
  /** 0..1 — how sure we are this listing is the subject property. */
  confidence: number;
  raw?: unknown;
}

export interface ListingSearchQuery {
  address?: CanonicalAddress;
  latitude?: number;
  longitude?: number;
  radiusMiles?: number;
  listingType?: ListingType;
  status?: ListingStatus;
}

// ---------------------------------------------------------------------------
// Rentals (spec §16, §19)

export interface CompAdjustment {
  reason: string;
  amountMonthly: number;
}

export interface RentalComp {
  id: string;
  provider: string;
  providerListingId?: string;
  propertyId?: string;
  address?: CanonicalAddress;
  latitude?: number;
  longitude?: number;
  rent: number;
  bedrooms?: number;
  bathrooms?: number;
  livingAreaSqFt?: number;
  propertyType?: string;
  yearBuilt?: number;
  listingDate?: string;
  lastSeenDate?: string;
  distanceMiles?: number;
  sourceUrl?: string;
  similarityScore?: number;
  adjustments?: CompAdjustment[];
  /** Outlier handling decision, set by the rent engine (spec §18). */
  treatment?: { status: "included" | "excluded" | "down_weighted"; reason: string; weight?: number };
  confidence: number;
}

export interface ProviderRentEstimate {
  provider: string;
  rent: number;
  low?: number;
  high?: number;
  compCount?: number;
  retrievedAt: string;
}

export type RentMethodology =
  | "actual_subject_rent"
  | "subject_listing"
  | "comparable_analysis"
  | "provider_avm"
  | "blended"
  | "market_fallback";

export interface RentEstimate {
  recommendedRent: number;
  lowRent: number;
  highRent: number;
  confidence: "high" | "medium" | "low";
  methodology: RentMethodology;
  comps: RentalComp[];
  providerEstimates: ProviderRentEstimate[];
  explanation: string[];
  calculatedAt: string;
}

export interface RentEstimateRequest {
  address: CanonicalAddress;
  bedrooms?: number;
  bathrooms?: number;
  livingAreaSqFt?: number;
  propertyType?: string;
}

export interface RentalCompQuery extends RentEstimateRequest {
  radiusMiles?: number;
  maxComps?: number;
}

// ---------------------------------------------------------------------------
// Sales comps & taxes

export interface SalesComp {
  id: string;
  provider: string;
  address?: CanonicalAddress;
  salePrice: number;
  saleDate?: string;
  bedrooms?: number;
  bathrooms?: number;
  livingAreaSqFt?: number;
  distanceMiles?: number;
  similarityScore?: number;
  confidence: number;
}

export interface SalesCompQuery extends RentEstimateRequest {
  radiusMiles?: number;
  maxComps?: number;
}

export interface TaxRecord {
  provider: string;
  annualAmount: number;
  year?: number;
  assessedValue?: number;
  effectiveRatePct?: number;
  confidence: number;
}

export interface PropertyLookup {
  address: CanonicalAddress;
  providerId?: string;
  parcelId?: string;
}

// ---------------------------------------------------------------------------
// Capability interfaces (spec §5)

export interface AddressProvider {
  readonly name: string;
  autocomplete(query: string, signal?: AbortSignal): Promise<AddressSuggestion[]>;
  resolve(suggestion: AddressSuggestion): Promise<ResolvedAddress>;
}

export interface ParcelProvider {
  readonly name: string;
  getParcelById(id: string): Promise<ParcelRecord | null>;
  resolveAddress(address: CanonicalAddress): Promise<ParcelRecord | null>;
}

export interface PropertyDataProvider {
  readonly name: string;
  getProperty(input: PropertyLookup): Promise<PropertyRecord | null>;
}

export interface ListingProvider {
  readonly name: string;
  resolveListingUrl?(url: URL): Promise<ListingRecord | null>;
  findListings(query: ListingSearchQuery): Promise<ListingRecord[]>;
}

/** RESO is a standard, not a provider (spec §53); this is the future
 *  authorized-MLS surface. */
export interface MlsProvider extends ListingProvider {
  getMetadata(): Promise<{ mlsName: string; coverage: string }>;
}

export interface RentalDataProvider {
  readonly name: string;
  getRentEstimate(input: RentEstimateRequest): Promise<ProviderRentEstimate | null>;
  getRentalComps(input: RentalCompQuery): Promise<RentalComp[]>;
}

export interface SalesCompProvider {
  readonly name: string;
  getSalesComps(input: SalesCompQuery): Promise<SalesComp[]>;
}

export interface TaxProvider {
  readonly name: string;
  getPropertyTaxes(input: PropertyLookup): Promise<TaxRecord | null>;
}
