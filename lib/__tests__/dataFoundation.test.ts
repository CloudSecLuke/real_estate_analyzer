import { describe, expect, it } from "vitest";
import { assertSourceFields, contentHash, IngestError } from "@/lib/data/ingest";

// Pure-unit coverage for the Stage 1 ingestion framework (PROP-37).
// DB-backed integration checks live in scripts/verify-stage1.ts and run
// against the dev database, not in CI (no DATABASE_URL there).

describe("contentHash", () => {
  it("is deterministic and content-sensitive", () => {
    const a = contentHash({ parcel: "123", sqft: 1428 });
    expect(a).toBe(contentHash({ parcel: "123", sqft: 1428 }));
    expect(a).not.toBe(contentHash({ parcel: "123", sqft: 1500 }));
    expect(a).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("schema-change detection (spec §105)", () => {
  it("passes when required fields exist", () => {
    expect(() =>
      assertSourceFields({ parcel_id: "x", addr: "y" }, ["parcel_id"], "src")
    ).not.toThrow();
  });

  it("fails ingestion safely when an expected field disappears", () => {
    try {
      assertSourceFields({ parcelNumber: "x" }, ["parcel_id"], "hamilton_county_parcels");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(IngestError);
      expect((err as IngestError).kind).toBe("source_schema_changed");
      expect((err as IngestError).message).toContain("parcel_id");
    }
  });
});
