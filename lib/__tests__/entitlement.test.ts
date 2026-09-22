import { describe, expect, it, vi } from "vitest";

// Drives getEntitlement's subscription-lifecycle policy (PROP-8) by feeding a
// controllable entitlements row through a mocked sql client.
let row: Record<string, unknown> | null = null;

vi.mock("@/lib/sql", () => ({
  sql: () => (strings: TemplateStringsArray) => {
    const text = strings.join("?");
    if (text.includes("FROM entitlements")) {
      return Promise.resolve(row ? [row] : []);
    }
    return Promise.resolve([]);
  },
}));

import { getEntitlement, PAST_DUE_GRACE_MS } from "@/lib/users";

const base = {
  free_pencils_used: 1,
  pencils_this_period: 10,
  period_start: new Date().toISOString(),
  plan: "investor",
  plan_status: "active",
  stripe_customer_id: "cus_1",
  past_due_since: null as string | null,
  cancel_at_period_end: false,
  current_period_end: null as string | null,
};

describe("getEntitlement subscription lifecycle (PROP-8)", () => {
  it("active investor has full access, not past due", async () => {
    row = { ...base };
    const e = await getEntitlement("alice");
    expect(e.plan).toBe("investor");
    expect(e.pastDue).toBe(false);
    expect(e.monthlyRemaining).toBe(90);
  });

  it("past_due within the grace window keeps access and flags pastDue", async () => {
    row = { ...base, plan_status: "past_due", past_due_since: new Date(Date.now() - 2 * 86400_000).toISOString() };
    const e = await getEntitlement("alice");
    expect(e.plan).toBe("investor"); // still penciling
    expect(e.pastDue).toBe(true);
    expect(e.graceEndsAt).not.toBeNull();
  });

  it("past_due past the grace window drops to free", async () => {
    const since = new Date(Date.now() - (PAST_DUE_GRACE_MS + 86400_000)).toISOString();
    row = { ...base, plan_status: "past_due", past_due_since: since };
    const e = await getEntitlement("alice");
    expect(e.plan).toBe("free");
    expect(e.pastDue).toBe(false);
    expect(e.monthlyRemaining).toBeNull();
  });

  it("unpaid drops to free immediately (no grace)", async () => {
    row = { ...base, plan_status: "unpaid", past_due_since: null };
    const e = await getEntitlement("alice");
    expect(e.plan).toBe("free");
    expect(e.pastDue).toBe(false);
  });

  it("canceled drops to free immediately", async () => {
    row = { ...base, plan_status: "canceled" };
    const e = await getEntitlement("alice");
    expect(e.plan).toBe("free");
  });

  it("cancel_at_period_end stays active until the period end", async () => {
    const end = new Date(Date.now() + 10 * 86400_000).toISOString();
    row = { ...base, cancel_at_period_end: true, current_period_end: end };
    const e = await getEntitlement("alice");
    expect(e.plan).toBe("investor");
    expect(e.cancelAtPeriodEnd).toBe(true);
    expect(e.currentPeriodEnd).toBe(end);
  });

  it("founders bypass all of it", async () => {
    row = null;
    const e = await getEntitlement("luke.miller");
    expect(e.plan).toBe("founder");
    expect(e.monthlyRemaining).toBeNull();
  });
});
