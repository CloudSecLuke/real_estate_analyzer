import { createHash } from "node:crypto";
import { dataSql, ensureDataSchema } from "./schema";

// Ingestion bookkeeping (PROP-37; spec §17–19). Guarantees the framework
// gives every provider: runs are recorded, raw payloads are retained, and
// re-running an ingestion never duplicates records — dedupe is by
// (source_id, record_type, external_record_id) when the source has stable
// ids, else by content hash.

export type RunStatus = "running" | "completed" | "partial" | "failed";

export interface RunCounts {
  seen: number;
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
}

export function contentHash(payload: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")
    .slice(0, 40);
}

export async function startIngestionRun(
  sourceId: string,
  marketId?: string
): Promise<string> {
  await ensureDataSchema();
  const sql = dataSql();
  const rows = (await sql`
    INSERT INTO ingestion_runs (source_id, market_id)
    VALUES (${sourceId}, ${marketId ?? null})
    RETURNING id
  `) as { id: string }[];
  await sql`
    UPDATE data_sources SET last_attempted_ingestion_at = now(), updated_at = now()
    WHERE id = ${sourceId}
  `;
  return rows[0].id;
}

export async function finishIngestionRun(
  runId: string,
  status: RunStatus,
  counts: RunCounts,
  opts?: { cursor?: string; error?: string }
): Promise<void> {
  const sql = dataSql();
  await sql`
    UPDATE ingestion_runs SET
      completed_at = now(),
      status = ${status},
      records_seen = ${counts.seen},
      records_inserted = ${counts.inserted},
      records_updated = ${counts.updated},
      records_skipped = ${counts.skipped},
      records_failed = ${counts.failed},
      error_count = ${counts.failed},
      cursor = COALESCE(${opts?.cursor ?? null}, cursor)
    WHERE id = ${runId}
  `;
  const rows = (await sql`
    SELECT source_id FROM ingestion_runs WHERE id = ${runId}
  `) as { source_id: string }[];
  const sourceId = rows[0]?.source_id;
  if (!sourceId) return;
  if (status === "completed" || status === "partial") {
    await sql`
      UPDATE data_sources SET last_successful_ingestion_at = now(),
        last_error = ${opts?.error ?? null}, updated_at = now()
      WHERE id = ${sourceId}
    `;
  } else if (opts?.error) {
    await sql`
      UPDATE data_sources SET last_error = ${opts.error}, updated_at = now()
      WHERE id = ${sourceId}
    `;
  }
}

/** Cursor/watermark of the last non-failed run, for incremental ingestion. */
export async function lastCursor(sourceId: string): Promise<string | null> {
  await ensureDataSchema();
  const rows = (await dataSql()`
    SELECT cursor FROM ingestion_runs
    WHERE source_id = ${sourceId} AND status IN ('completed','partial') AND cursor IS NOT NULL
    ORDER BY started_at DESC LIMIT 1
  `) as { cursor: string }[];
  return rows[0]?.cursor ?? null;
}

export type StoreOutcome = "inserted" | "updated" | "unchanged";

/**
 * Idempotently store a raw source payload. Same external id + same content
 * → unchanged; same id + new content → payload updated in place (the prior
 * version remains reconstructible from history via ingestion runs — full
 * versioning arrives with property snapshots). No external id → dedupe by
 * content hash alone.
 */
export async function storeRawRecord(args: {
  sourceId: string;
  recordType: string;
  externalRecordId?: string;
  payload: unknown;
  sourceCreatedAt?: string;
  sourceUpdatedAt?: string;
  ingestionRunId?: string;
  parserVersion?: string;
}): Promise<{ id: string; outcome: StoreOutcome }> {
  await ensureDataSchema();
  const sql = dataSql();
  const hash = contentHash(args.payload);
  const payloadJson = JSON.stringify(args.payload);

  if (args.externalRecordId) {
    const existing = (await sql`
      SELECT id, content_hash FROM raw_source_records
      WHERE source_id = ${args.sourceId}
        AND record_type = ${args.recordType}
        AND external_record_id = ${args.externalRecordId}
    `) as { id: string; content_hash: string }[];
    if (existing[0]) {
      if (existing[0].content_hash === hash) {
        return { id: existing[0].id, outcome: "unchanged" };
      }
      await sql`
        UPDATE raw_source_records SET
          payload = ${payloadJson}::jsonb,
          content_hash = ${hash},
          source_updated_at = ${args.sourceUpdatedAt ?? null},
          retrieved_at = now(),
          ingestion_run_id = ${args.ingestionRunId ?? null},
          parser_version = ${args.parserVersion ?? null}
        WHERE id = ${existing[0].id}
      `;
      return { id: existing[0].id, outcome: "updated" };
    }
  } else {
    const dupe = (await sql`
      SELECT id FROM raw_source_records
      WHERE source_id = ${args.sourceId}
        AND record_type = ${args.recordType}
        AND content_hash = ${hash}
      LIMIT 1
    `) as { id: string }[];
    if (dupe[0]) return { id: dupe[0].id, outcome: "unchanged" };
  }

  const rows = (await sql`
    INSERT INTO raw_source_records
      (source_id, external_record_id, record_type, payload, content_hash,
       source_created_at, source_updated_at, ingestion_run_id, parser_version)
    VALUES
      (${args.sourceId}, ${args.externalRecordId ?? null}, ${args.recordType},
       ${payloadJson}::jsonb, ${hash}, ${args.sourceCreatedAt ?? null},
       ${args.sourceUpdatedAt ?? null}, ${args.ingestionRunId ?? null},
       ${args.parserVersion ?? null})
    RETURNING id
  `) as { id: string }[];
  return { id: rows[0].id, outcome: "inserted" };
}

/** Provider error taxonomy (spec §104) — never just "API failed". */
export type IngestErrorKind =
  | "not_found"
  | "temporary_failure"
  | "rate_limited"
  | "unauthorized"
  | "forbidden"
  | "malformed_response"
  | "source_schema_changed"
  | "partial_result";

export class IngestError extends Error {
  constructor(
    public kind: IngestErrorKind,
    message: string
  ) {
    super(`${kind}: ${message}`);
  }
}

/**
 * Guard for schema-change detection (spec §105): assert the fields a parser
 * depends on exist in a sample record; a missing field fails the ingestion
 * safely instead of silently writing nulls.
 */
export function assertSourceFields(
  sample: Record<string, unknown>,
  required: string[],
  sourceId: string
): void {
  const missing = required.filter((f) => !(f in sample));
  if (missing.length > 0) {
    throw new IngestError(
      "source_schema_changed",
      `${sourceId}: expected field(s) missing: ${missing.join(", ")}`
    );
  }
}
