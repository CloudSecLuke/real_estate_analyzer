import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Layer-2 gate: the free pencil requires a verified email (PROP-13/PROP-7).
// Route mocked sql by statement so canPencil's three lookups are controllable.
let emailVerifiedAt: string | null = null;
let signupIpHash: string | null = null;

vi.mock("@/lib/sql", () => ({
  sql: () => (strings: TemplateStringsArray) => {
    const text = strings.join("?");
    if (text.includes("FROM entitlements")) {
      // free-tier row: not investor, no free pencils used yet
      return Promise.resolve([
        {
          free_pencils_used: 0,
          pencils_this_period: 0,
          period_start: new Date().toISOString(),
          plan: "free",
          plan_status: "none",
          stripe_customer_id: null,
          past_due_since: null,
          cancel_at_period_end: false,
          current_period_end: null,
        },
      ]);
    }
    if (text.includes("email, email_verified_at FROM users")) {
      return Promise.resolve([{ email: "x@y.com", email_verified_at: emailVerifiedAt }]);
    }
    if (text.includes("signup_ip_hash, created_at FROM users")) {
      return Promise.resolve([{ signup_ip_hash: signupIpHash, created_at: new Date().toISOString() }]);
    }
    return Promise.resolve([]);
  },
}));

import { canPencil, setUserEmail } from "@/lib/users";

beforeAll(() => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://mock/proppencil_dev";
});
afterEach(() => {
  emailVerifiedAt = null;
  signupIpHash = null;
  delete process.env.FREE_PENCIL_REQUIRES_VERIFIED_EMAIL;
});

describe("free pencil verified-email gate (PROP-13 layer 2)", () => {
  it("blocks a free pencil when email is unverified (gate on by default)", async () => {
    emailVerifiedAt = null;
    expect(await canPencil("alice")).toEqual({ allowed: false, reason: "verify_email" });
  });

  it("allows a free pencil once the email is verified", async () => {
    emailVerifiedAt = "2026-09-22T00:00:00Z";
    expect(await canPencil("alice")).toEqual({ allowed: true, source: "free" });
  });

  it("does not gate when the flag is disabled", async () => {
    process.env.FREE_PENCIL_REQUIRES_VERIFIED_EMAIL = "0";
    emailVerifiedAt = null;
    expect(await canPencil("alice")).toEqual({ allowed: true, source: "free" });
  });

  it("founders are never gated", async () => {
    emailVerifiedAt = null;
    expect(await canPencil("luke.miller")).toEqual({ allowed: true, source: "founder" });
  });

  it("setUserEmail rejects a malformed address", async () => {
    expect(await setUserEmail("alice", "not-an-email")).toEqual({
      ok: false,
      error: "Enter a valid email address.",
    });
  });

  it("setUserEmail accepts a valid address", async () => {
    expect(await setUserEmail("alice", "New@Example.com ")).toEqual({ ok: true });
  });
});
