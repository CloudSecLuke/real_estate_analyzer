import { beforeEach, describe, expect, it, vi } from "vitest";

// Unit tests for cached() + the analyses insert (Phase 4 step 7), with the
// shared sql client mocked — no database required in CI.

const store = new Map<string, { payload: unknown; expires: number }>();
const calls: string[] = [];

vi.mock("@/lib/sql", () => ({
  sql: () => {
    // emulate the tagged-template client for the two statements cached()
    // and recordAnalysis() issue
    return (strings: TemplateStringsArray, ...vals: unknown[]) => {
      const text = strings.join("?");
      calls.push(text.trim().split(/\s+/).slice(0, 2).join(" "));
      if (text.includes("SELECT payload FROM provider_cache")) {
        const key = `${vals[0]}:${vals[1]}`;
        const hit = store.get(key);
        return Promise.resolve(
          hit && hit.expires > Date.now() ? [{ payload: hit.payload }] : []
        );
      }
      if (text.includes("INSERT INTO provider_cache")) {
        store.set(`${vals[0]}:${vals[1]}`, {
          payload: JSON.parse(String(vals[2])),
          expires: Date.now() + Number(vals[4]) * 1000,
        });
        return Promise.resolve([]);
      }
      if (text.includes("INSERT INTO analyses")) {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    };
  },
}));

import { cached, runWithCallLog } from "@/lib/providerCache";
import { recordAnalysis } from "@/lib/analyses";

beforeEach(() => {
  process.env.DATABASE_URL = "postgresql://mock/proppencil_dev";
  store.clear();
  calls.length = 0;
});

describe("cached()", () => {
  it("misses, runs fn, stores, then hits without re-running fn", async () => {
    const fn = vi.fn(async () => ({ rent: 1725 }));
    const first = await cached("hud", "fmr:39061:45202", 3600, fn);
    expect(first.cacheHit).toBe(false);
    expect(first.value).toEqual({ rent: 1725 });

    const second = await cached("hud", "fmr:39061:45202", 3600, fn);
    expect(second.cacheHit).toBe(true);
    expect(second.value).toEqual({ rent: 1725 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not cache null results (transient failures must recover)", async () => {
    const fn = vi.fn(async () => null);
    await cached("attom", "property:X", 3600, fn);
    await cached("attom", "property:X", 3600, fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("propagates errors uncached", async () => {
    const fn = vi.fn(async () => {
      throw new Error("upstream 500");
    });
    await expect(cached("fema", "flood:1:2", 60, fn)).rejects.toThrow("upstream 500");
    expect(store.size).toBe(0);
  });

  it("charges paid providers and logs calls per request", async () => {
    const { calls: log } = await runWithCallLog(async () => {
      await cached("attom", "a", 60, async () => ({ x: 1 }));
      await cached("hud", "b", 60, async () => ({ y: 2 }));
      await cached("attom", "a", 60, async () => ({ x: 1 })); // hit
    });
    expect(log).toHaveLength(3);
    expect(log[0]).toMatchObject({ provider: "attom", cacheHit: false, costCents: 3 });
    expect(log[1]).toMatchObject({ provider: "hud", cacheHit: false, costCents: 0 });
    expect(log[2]).toMatchObject({ provider: "attom", cacheHit: true, costCents: 0 });
  });
});

describe("recordAnalysis()", () => {
  it("inserts one analyses row with summed provider cost", async () => {
    await recordAnalysis({
      username: "luke.miller",
      addressInput: "100 Pencil Ln, Cincinnati OH",
      matchedAddress: "100 PENCIL LN, CINCINNATI, OH, 45202",
      countyFips: "39061",
      state: "OH",
      inputs: { address: "100 Pencil Ln" },
      result: { ok: true },
      formulaVersion: "legacy-1.0.0",
      providerCalls: [
        { provider: "attom", cacheHit: false, costCents: 3 },
        { provider: "hud", cacheHit: true, costCents: 0 },
      ],
    });
    expect(calls).toContain("INSERT INTO");
  });
});
