import { afterEach, describe, expect, it, vi } from "vitest";
import { reportError } from "@/lib/reportError";

describe("reportError", () => {
  afterEach(() => vi.restoreAllMocks());

  it("emits a single structured ERROR_REPORT line with event + severity", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    reportError(new Error("boom"), {
      event: "stripe_webhook_apply_failed",
      severity: "alert",
      username: "luke.miller",
      extra: { stripeEventId: "evt_123" },
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.tag).toBe("ERROR_REPORT");
    expect(parsed.event).toBe("stripe_webhook_apply_failed");
    expect(parsed.severity).toBe("alert");
    expect(parsed.username).toBe("luke.miller");
    expect(parsed.stripeEventId).toBe("evt_123");
    expect(parsed.error.message).toBe("boom");
    expect(typeof parsed.error.stack).toBe("string");
  });

  it("defaults severity to error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    reportError("plain string", { event: "record_analysis_failed" });
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.severity).toBe("error");
    expect(parsed.error.message).toBe("plain string");
  });

  it("never throws, even if console.error throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => {
      throw new Error("logging is down");
    });
    expect(() =>
      reportError(new Error("x"), { event: "record_pencil_failed" })
    ).not.toThrow();
  });
});
