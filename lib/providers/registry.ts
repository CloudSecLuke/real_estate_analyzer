import type {
  AddressProvider,
  ListingProvider,
  ParcelProvider,
  PropertyDataProvider,
  RentalDataProvider,
  SalesCompProvider,
  TaxProvider,
} from "./types";
import { mockProviders } from "./mock";

// Provider registry (PROP-24; spec §50–51). Which vendors are active is
// decided here — by configured keys and env flags — and priority order is
// configuration, not code scattered through the app. The mock provider is
// always registered last so the app works with zero keys (demo mode).

type Capability =
  | "address"
  | "parcel"
  | "property"
  | "listing"
  | "rental"
  | "salesComp"
  | "tax";

function enabled(flag: string, keyVar: string): boolean {
  // Explicit flag wins; otherwise presence of the key enables the provider.
  const f = process.env[flag];
  if (f === "0" || f === "false") return false;
  if (f === "1" || f === "true") return Boolean(process.env[keyVar]);
  return Boolean(process.env[keyVar]);
}

export const providerFlags = {
  rentcast: () => enabled("ENABLE_RENTCAST", "RENTCAST_API_KEY"),
  attom: () => enabled("ENABLE_ATTOM", "ATTOM_API_KEY"),
  regrid: () => enabled("ENABLE_REGRID", "REGRID_API_KEY"),
  mls: () => enabled("ENABLE_MLS", "MLS_PROVIDER_API_KEY"),
};

/** Priority per capability — first configured provider wins, rest are
 *  fallbacks (spec §51). Overridable via PROVIDER_PRIORITY_JSON env. */
const DEFAULT_PRIORITY: Record<Capability, string[]> = {
  // Regrid is parked (Phase 5): owned typeahead serves our deep market;
  // re-enable Regrid per-capability via PROVIDER_PRIORITY_JSON if needed.
  address: ["owned", "mock"],
  parcel: ["mock"],
  property: ["rentcast", "attom", "mock"],
  listing: ["mls", "rentcast", "mock"],
  rental: ["rentcast", "attom", "mock"],
  salesComp: ["rentcast", "mock"],
  tax: ["rentcast", "attom", "mock"],
};

export function providerPriority(): Record<Capability, string[]> {
  const raw = process.env.PROVIDER_PRIORITY_JSON;
  if (!raw) return DEFAULT_PRIORITY;
  try {
    return { ...DEFAULT_PRIORITY, ...JSON.parse(raw) };
  } catch {
    console.error("provider_priority_json_invalid");
    return DEFAULT_PRIORITY;
  }
}

// Lazy adapter loading keeps unused vendor code out of the hot path and
// lets adapters read env at call time (works in every deploy environment).
async function loadAdapters(): Promise<Record<string, Partial<AdapterSet>>> {
  const out: Record<string, Partial<AdapterSet>> = { mock: mockProviders };
  {
    const { ownedProviders } = await import("./ownedAddress");
    out.owned = ownedProviders;
  }
  if (providerFlags.regrid()) {
    const { regridProviders } = await import("./regrid");
    out.regrid = regridProviders;
  }
  if (providerFlags.rentcast()) {
    const { rentcastProviders } = await import("./rentcast");
    out.rentcast = rentcastProviders;
  }
  if (providerFlags.attom()) {
    const { attomProviders } = await import("./attomAdapter");
    out.attom = attomProviders;
  }
  return out;
}

export interface AdapterSet {
  address: AddressProvider;
  parcel: ParcelProvider;
  property: PropertyDataProvider;
  listing: ListingProvider;
  rental: RentalDataProvider;
  salesComp: SalesCompProvider;
  tax: TaxProvider;
}

/** Ordered, configured providers for one capability. Always non-empty
 *  (mock is unconditional). */
export async function providersFor<K extends Capability>(
  capability: K
): Promise<NonNullable<AdapterSet[K]>[]> {
  const adapters = await loadAdapters();
  const order = providerPriority()[capability];
  const list = order
    .map((name) => adapters[name]?.[capability])
    .filter((p): p is NonNullable<AdapterSet[K]> => Boolean(p));
  if (list.length === 0) {
    list.push(mockProviders[capability] as NonNullable<AdapterSet[K]>);
  }
  return list;
}

/** Try providers in priority order until one returns a usable value.
 *  A provider failure logs and falls through — never crashes the caller
 *  (spec §38). Returns null only when every provider came up empty. */
export async function firstResult<K extends Capability, T>(
  capability: K,
  run: (provider: NonNullable<AdapterSet[K]>) => Promise<T | null>
): Promise<{ result: T; provider: string } | null> {
  for (const provider of await providersFor(capability)) {
    try {
      const result = await run(provider);
      if (result !== null && result !== undefined) {
        return { result, provider: (provider as { name: string }).name };
      }
    } catch (err) {
      console.error(
        "provider_failed",
        capability,
        (provider as { name: string }).name,
        err instanceof Error ? err.message : err
      );
    }
  }
  return null;
}
