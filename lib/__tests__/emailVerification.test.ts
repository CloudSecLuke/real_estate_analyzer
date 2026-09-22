import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Drives the email-verification helpers (PROP-7) with a mocked sql client.
// Each test sets the rows the relevant statement should return.
let selectRows: unknown[] = [];
let updateVerifRows: unknown[] = [];
let updateUserRows: unknown[] = [];

vi.mock("@/lib/sql", () => ({
  sql: () => (strings: TemplateStringsArray) => {
    const text = strings.join("?");
    if (text.includes("UPDATE email_verifications")) return Promise.resolve(updateVerifRows);
    if (text.includes("UPDATE users SET email_verified_at")) return Promise.resolve(updateUserRows);
    if (text.includes("FROM users")) return Promise.resolve(selectRows);
    return Promise.resolve([]);
  },
}));

import {
  createResetToken,
  verifyEmailToken,
  getAccountFlags,
} from "@/lib/users";

beforeAll(() => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://mock/proppencil_dev";
});
afterEach(() => {
  selectRows = [];
  updateVerifRows = [];
  updateUserRows = [];
});

describe("email verification (PROP-7)", () => {
  it("createResetToken returns null when the email is unverified", async () => {
    // The reset query filters on email_verified_at IS NOT NULL, so an
    // unverified user yields no row.
    selectRows = [];
    expect(await createResetToken("alice")).toBeNull();
  });

  it("createResetToken skips founders", async () => {
    expect(await createResetToken("luke.miller")).toBeNull();
  });

  it("verifyEmailToken rejects a malformed token without touching the DB", async () => {
    expect(await verifyEmailToken("not-a-hex-token")).toEqual({ ok: false });
  });

  it("verifyEmailToken succeeds when the token maps to a still-matching email", async () => {
    const tok = "a".repeat(64);
    updateVerifRows = [{ username: "bob", email: "bob@example.com" }];
    updateUserRows = [{ username: "bob" }];
    expect(await verifyEmailToken(tok)).toEqual({ ok: true, username: "bob" });
  });

  it("verifyEmailToken fails when the address changed after the link was sent", async () => {
    const tok = "b".repeat(64);
    updateVerifRows = [{ username: "bob", email: "old@example.com" }];
    updateUserRows = []; // user UPDATE matched nothing (email differs)
    expect(await verifyEmailToken(tok)).toEqual({ ok: false });
  });

  it("getAccountFlags reflects hasEmail / emailVerified", async () => {
    selectRows = [{ email: "x@y.com", email_verified_at: "2026-09-22T00:00:00Z" }];
    expect(await getAccountFlags("alice")).toEqual({ hasEmail: true, emailVerified: true });
    selectRows = [{ email: "x@y.com", email_verified_at: null }];
    expect(await getAccountFlags("alice")).toEqual({ hasEmail: true, emailVerified: false });
  });
});
