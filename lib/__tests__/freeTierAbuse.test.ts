import { afterEach, describe, expect, it, vi } from "vitest";

// Drives freeTierBlocked (PROP-13) with a mocked sql client. The first query
// returns the user's signup row; the second returns the count of earlier
// same-IP accounts this week.
let userRow: { signup_ip_hash: string | null; created_at: string } | null = null;
let earlierCount = 0;

vi.mock("@/lib/sql", () => ({
  sql: () => (strings: TemplateStringsArray) => {
    const text = strings.join("?");
    if (text.includes("signup_ip_hash, created_at FROM users")) {
      return Promise.resolve(userRow ? [userRow] : []);
    }
    if (text.includes("count(*)")) {
      return Promise.resolve([{ n: earlierCount }]);
    }
    return Promise.resolve([]);
  },
}));

import { freeTierBlocked, FREE_PENCILS_PER_IP_WEEK } from "@/lib/users";

const now = new Date().toISOString();

afterEach(() => {
  delete process.env.FREE_PENCIL_IP_ALLOWLIST;
});

describe("freeTierBlocked (PROP-13)", () => {
  it("allows an account with no stored signup IP (legacy)", async () => {
    userRow = { signup_ip_hash: null, created_at: now };
    expect(await freeTierBlocked("legacy")).toBe(false);
  });

  it("allows the first accounts under the per-IP weekly cap", async () => {
    userRow = { signup_ip_hash: "abc", created_at: now };
    earlierCount = FREE_PENCILS_PER_IP_WEEK - 1; // this is the 3rd account
    expect(await freeTierBlocked("third")).toBe(false);
  });

  it("blocks the account past the per-IP weekly cap", async () => {
    userRow = { signup_ip_hash: "abc", created_at: now };
    earlierCount = FREE_PENCILS_PER_IP_WEEK; // 3 earlier → this is the 4th
    expect(await freeTierBlocked("fourth")).toBe(true);
  });

  it("never blocks an allowlisted IP hash (shared household)", async () => {
    process.env.FREE_PENCIL_IP_ALLOWLIST = "abc, def";
    userRow = { signup_ip_hash: "abc", created_at: now };
    earlierCount = 99;
    expect(await freeTierBlocked("housemate")).toBe(false);
  });

  it("returns false for an unknown user", async () => {
    userRow = null;
    expect(await freeTierBlocked("ghost")).toBe(false);
  });
});
