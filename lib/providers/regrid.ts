import type {
  AddressProvider,
  AddressSuggestion,
  CanonicalAddress,
  ParcelProvider,
  ParcelRecord,
} from "./types";

// Regrid adapter (PROP-26; spec §8). Typeahead returns a persistent parcel
// identifier (ll_uuid) alongside the address — we persist that id so the
// same property is never fuzzy-matched twice. Token stays server-side.
// Docs: https://regrid.com/api — parse defensively; fields verified at
// integration time, and every parse failure degrades to "no suggestions".

const BASE = "https://app.regrid.com/api/v2";

function token(): string {
  const t = process.env.REGRID_API_KEY;
  if (!t) throw new Error("REGRID_API_KEY is not set");
  return t;
}

interface RegridTypeaheadHit {
  ll_uuid?: string;
  address?: string;
  context?: string; // "Cincinnati, OH 45202"
  centroid?: { lon?: number; lat?: number };
  score?: number;
}

function parseContext(context?: string): {
  city?: string;
  state?: string;
  postalCode?: string;
} {
  if (!context) return {};
  const m = context.match(/^(.*?),\s*([A-Z]{2})\s*(\d{5})?/);
  return m
    ? { city: m[1], state: m[2], postalCode: m[3] }
    : { city: context };
}

export const regridAddressProvider: AddressProvider = {
  name: "regrid",
  async autocomplete(query, signal): Promise<AddressSuggestion[]> {
    const url = `${BASE}/typeahead.json?query=${encodeURIComponent(query)}&token=${token()}`;
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`regrid typeahead ${res.status}`);
    const json = (await res.json()) as { data?: RegridTypeaheadHit[] } | RegridTypeaheadHit[];
    const hits = Array.isArray(json) ? json : (json.data ?? []);
    const seen = new Set<string>();
    const out: AddressSuggestion[] = [];
    for (const h of hits) {
      if (!h.ll_uuid || !h.address || seen.has(h.ll_uuid)) continue;
      seen.add(h.ll_uuid);
      const ctx = parseContext(h.context);
      out.push({
        provider: "regrid",
        providerId: h.ll_uuid,
        displayAddress: [h.address, h.context].filter(Boolean).join(", "),
        ...ctx,
        latitude: h.centroid?.lat,
        longitude: h.centroid?.lon,
        matchScore: h.score,
      });
    }
    return out;
  },
  async resolve(s) {
    const parcel = await regridParcelProvider.getParcelById(s.providerId);
    const a: CanonicalAddress = parcel?.address ?? {
      streetAddress: s.displayAddress.split(",")[0] ?? s.displayAddress,
      city: s.city ?? "",
      state: s.state ?? "",
      postalCode: s.postalCode,
      latitude: s.latitude,
      longitude: s.longitude,
    };
    return {
      ...a,
      provider: "regrid",
      providerId: s.providerId,
      parcelId: parcel?.parcelId,
      normalizedAddress:
        `${a.streetAddress}, ${a.city}, ${a.state}${a.postalCode ? " " + a.postalCode : ""}`.toUpperCase(),
    };
  },
};

interface RegridParcelFeature {
  properties?: {
    headline?: string;
    fields?: {
      parcelnumb?: string;
      address?: string;
      scity?: string;
      state2?: string;
      szip?: string;
      county?: string;
      ll_gissqft?: number;
      usedesc?: string;
      lat?: string | number;
      lon?: string | number;
    };
  };
}

export const regridParcelProvider: ParcelProvider = {
  name: "regrid",
  async getParcelById(id): Promise<ParcelRecord | null> {
    const res = await fetch(`${BASE}/parcels/${encodeURIComponent(id)}.json?token=${token()}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`regrid parcel ${res.status}`);
    const json = (await res.json()) as {
      parcels?: { features?: RegridParcelFeature[] };
      features?: RegridParcelFeature[];
    };
    const feature = json.parcels?.features?.[0] ?? json.features?.[0];
    const f = feature?.properties?.fields;
    if (!f) return null;
    return {
      provider: "regrid",
      providerId: id,
      parcelId: f.parcelnumb,
      apn: f.parcelnumb,
      address: {
        streetAddress: f.address ?? "",
        city: f.scity ?? "",
        state: f.state2 ?? "",
        postalCode: f.szip,
        county: f.county,
        latitude: f.lat != null ? Number(f.lat) : undefined,
        longitude: f.lon != null ? Number(f.lon) : undefined,
      },
      lotSizeSqFt: f.ll_gissqft,
      landUse: f.usedesc,
    };
  },
  async resolveAddress() {
    // Regrid resolution goes through typeahead → ll_uuid; direct
    // address→parcel search is a follow-up if needed.
    return null;
  },
};

export const regridProviders = {
  address: regridAddressProvider,
  parcel: regridParcelProvider,
};
