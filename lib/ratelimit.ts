import { createHash } from "node:crypto";
import { sql as getSql } from "@/lib/sql";
import type { NextRequest } from "next/server";

// Fixed-window rate limiting backed by Postgres (PROP-2). One atomic
// upsert per check: the row resets in place when its window has lapsed,
// so the table stays bounded by distinct (bucket, key) pairs. At this
// traffic level a ~10-30ms Neon round-trip is a fine price for limits
// that hold across serverless instances; swap for Upstash/WAF if scale
// ever demands it.
//
// Fails OPEN: if the DB is unreachable the request proceeds — a limiter
// outage must never lock customers out of login or paid analyses.



// Schema is managed by migrations (npm run db:migrate) — no runtime DDL.

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the window resets — only meaningful when blocked. */
  retryAfterSecs: number;
}

/**
 * Count a hit against `bucket`/`key` and report whether it is within
 * `limit` per `windowSecs`. The caller identifies the actor (IP hash,
 * username); this function only counts.
 */
export async function checkRateLimit(
  bucket: string,
  key: string,
  limit: number,
  windowSecs: number
): Promise<RateLimitResult> {
  if (!process.env.DATABASE_URL) return { allowed: true, retryAfterSecs: 0 };
  try {
    const rows = await getSql()`
      INSERT INTO rate_limits (bucket, key, window_start, count)
      VALUES (${bucket}, ${key}, now(), 1)
      ON CONFLICT (bucket, key) DO UPDATE SET
        count = CASE
          WHEN rate_limits.window_start < now() - make_interval(secs => ${windowSecs})
          THEN 1
          ELSE rate_limits.count + 1
        END,
        window_start = CASE
          WHEN rate_limits.window_start < now() - make_interval(secs => ${windowSecs})
          THEN now()
          ELSE rate_limits.window_start
        END
      RETURNING count,
        GREATEST(0, CEIL(EXTRACT(EPOCH FROM
          window_start + make_interval(secs => ${windowSecs}) - now()
        )))::int AS retry_after
    `;
    const row = (rows as Record<string, unknown>[])[0] as unknown as {
      count: number;
      retry_after: number;
    };
    return {
      allowed: row.count <= limit,
      retryAfterSecs: row.retry_after,
    };
  } catch (err) {
    console.error("rate_limit_check_failed", bucket, err);
    return { allowed: true, retryAfterSecs: 0 };
  }
}

/**
 * Stable, non-reversible key for a caller's IP. Vercel terminates TLS
 * and sets x-forwarded-for itself, so the first entry is trustworthy.
 */
export function ipKey(req: NextRequest): string {
  const ip =
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  return createHash("sha256").update(ip).digest("hex").slice(0, 24);
}

/** Standard 429 body + headers for a blocked request. */
export function tooMany(message: string, retryAfterSecs: number) {
  return new Response(JSON.stringify({ error: message }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(Math.max(1, retryAfterSecs)),
    },
  });
}
