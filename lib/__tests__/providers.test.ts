import { describe, expect, it } from "vitest";
import { mockProviders, MOCK_FIXTURE_KEYS } from "@/lib/providers/mock";
import { firstResult, providerPriority, providersFor } from "@/lib/providers/registry";

// PROP-24: keyless demo mode must fully work, and the registry must fall
// back to mock when no vendor keys are configured (the CI condition).

const PENCIL_LN = {
  streetAddress: "100 Pencil Ln",
  city: "Cincinnati",
  state: "OH",
  postalCode: "45202",
};

describe("mock providers (demo mode)", () => {
  it("autocompletes fixtures by fragment", async () => {
    const got = await mockProviders.address.autocomplete("pencil ln");
    expect(got.length).toBeGreaterThan(0);
    expect(got[0].providerId).toBe("100-pencil-ln");
    expect(got[0].displayAddress).toContain("Cincinnati");
  });

  it("resolves a suggestion to a canonical address with parcel id", async () => {
    const [s] = await mockProviders.address.autocomplete("100 pencil");
    const r = await mockProviders.address.resolve(s);
    expect(r.parcelId).toBe("MOCK-100-pencil-ln");
    expect(r.normalizedAddress).toContain("100 PENCIL LN");
  });

  it("returns property record, active listing, rent AVM, comps and taxes", async () => {
    const prop = await mockProviders.property.getProperty({ address: PENCIL_LN });
    expect(prop?.bedrooms).toBe(3);
    expect(prop?.yearBuilt).toBe(1912);

    const listings = await mockProviders.listing.findListings({ address: PENCIL_LN });
    expect(listings[0]?.status).toBe("active");
    expect(listings[0]?.listPrice).toBe(118000);

    const avm = await mockProviders.rental.getRentEstimate({ address: PENCIL_LN });
    expect(avm?.rent).toBe(1275);

    const comps = await mockProviders.rental.getRentalComps({ address: PENCIL_LN });
    expect(comps.length).toBeGreaterThanOrEqual(6);
    // fixture deliberately contains one outlier for the rent engine to trim
    expect(Math.max(...comps.map((c) => c.rent))).toBeGreaterThan(2000);

    const tax = await mockProviders.tax.getPropertyTaxes({ address: PENCIL_LN });
    expect(tax?.annualAmount).toBe(1876);
  });

  it("handles the no-active-listing fixture honestly", async () => {
    const listings = await mockProviders.listing.findListings({
      address: { streetAddress: "9 Ferrule St", city: "Cincinnati", state: "OH", postalCode: "45225" },
    });
    expect(listings).toEqual([]);
  });

  it("resolves demo listing URLs", async () => {
    const l = await mockProviders.listing.resolveListingUrl!(
      new URL("https://demo.proppencil.com/listing/20-sharpener-ct")
    );
    expect(l?.listPrice).toBe(189900);
  });

  it("ships the full fixture spread", () => {
    expect(MOCK_FIXTURE_KEYS.length).toBeGreaterThanOrEqual(5);
  });
});

describe("provider registry", () => {
  it("always ends priority lists at mock", () => {
    for (const list of Object.values(providerPriority())) {
      expect(list[list.length - 1]).toBe("mock");
    }
  });

  it("falls back to mock with zero keys configured", async () => {
    // CI has no vendor keys, so this exercises the real keyless path.
    const providers = await providersFor("rental");
    expect(providers.map((p) => p.name)).toContain("mock");
  });

  it("firstResult skips empty providers and reports the source", async () => {
    const hit = await firstResult("rental", (p) =>
      p.getRentEstimate({ address: PENCIL_LN })
    );
    expect(hit?.result.rent).toBe(1275);
    expect(hit?.provider).toBe("mock");
  });

  it("firstResult returns null when every provider is empty", async () => {
    const miss = await firstResult("rental", (p) =>
      p.getRentEstimate({
        address: { streetAddress: "1 Nowhere Rd", city: "X", state: "ZZ" },
      })
    );
    expect(miss).toBeNull();
  });
});
