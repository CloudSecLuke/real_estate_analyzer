"use client";

import { useRef, useState } from "react";
import { buildPin, computeScenariosFromData } from "@/lib/scenarios";
import type { AnalyzeResponse, Assumptions, SavedPin } from "@/lib/types";

// Minimal RFC-4180-ish CSV parser — addresses contain commas, so quoted
// fields must work. No dependency needed for this.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

interface BatchRow {
  address: string;
  price: number | null;
  bedrooms: number | null;
  rent: number | null;
}

function mapRows(rows: string[][]): BatchRow[] {
  let cols = { address: 0, price: 1, bedrooms: 2, rent: 3 };
  let dataRows = rows;
  const header = rows[0]?.map((h) => h.trim().toLowerCase());
  if (header?.some((h) => h.includes("address"))) {
    const find = (...names: string[]) =>
      header.findIndex((h) => names.some((n) => h.includes(n)));
    cols = {
      address: find("address"),
      price: find("price"),
      bedrooms: find("bed", "br"),
      rent: find("rent"),
    };
    dataRows = rows.slice(1);
  }
  const num = (row: string[], idx: number) => {
    if (idx < 0 || !row[idx]) return null;
    const n = Number(row[idx].replace(/[$,\s]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  return dataRows
    .map((r) => ({
      address: (r[cols.address] ?? "").trim(),
      price: num(r, cols.price),
      bedrooms: num(r, cols.bedrooms),
      rent: num(r, cols.rent),
    }))
    .filter((r) => r.address !== "");
}

export default function BatchImport({
  assumptions,
  defaultPrice,
  defaultBedrooms,
  onPin,
}: {
  assumptions: Omit<Assumptions, "price" | "bedrooms">;
  defaultPrice: number;
  defaultBedrooms: number;
  onPin: (pin: SavedPin) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null
  );
  const [current, setCurrent] = useState("");
  const [errors, setErrors] = useState<{ address: string; error: string }[]>([]);
  const [summary, setSummary] = useState<string | null>(null);

  async function runBatch(file: File) {
    const rows = mapRows(parseCsv(await file.text()));
    if (rows.length === 0) {
      setErrors([{ address: file.name, error: "No rows with an address found." }]);
      return;
    }
    setErrors([]);
    setSummary(null);
    setProgress({ done: 0, total: rows.length });
    let ok = 0;
    const failed: { address: string; error: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      setCurrent(row.address);
      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address: row.address }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        const data = json as AnalyzeResponse;
        // CSV column wins; then listing data; then ATTOM; then the form
        const price =
          row.price ?? data.mashvisor?.listing?.listPrice ?? defaultPrice;
        const bedrooms =
          row.bedrooms ??
          data.mashvisor?.listing?.beds ??
          data.attom?.beds ??
          defaultBedrooms;
        const a: Assumptions = {
          ...assumptions,
          price,
          bedrooms,
          marketRentOverride: row.rent ?? assumptions.marketRentOverride,
        };
        const scenarios = computeScenariosFromData(data, a);
        if (!scenarios.market && !scenarios.s8) {
          throw new Error(
            data.fmrError
              ? "No rent available (no HUD data and no rent column in CSV)."
              : "Could not compute a scenario."
          );
        }
        onPin(buildPin(data, scenarios, price, bedrooms));
        ok++;
      } catch (e) {
        failed.push({
          address: row.address,
          error: e instanceof Error ? e.message : "failed",
        });
      }
      setProgress({ done: i + 1, total: rows.length });
      // Be polite to the free Census geocoder (~1 req/sec)
      if (i < rows.length - 1) await new Promise((r) => setTimeout(r, 600));
    }
    setCurrent("");
    setErrors(failed);
    setSummary(`${ok} of ${rows.length} properties added to the map.`);
    setProgress(null);
  }

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-semibold">Batch import</span>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) runBatch(f);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          disabled={progress !== null}
          onClick={() => fileRef.current?.click()}
          className="rounded-md border border-emerald-600 text-emerald-700 dark:text-emerald-400 px-3 py-1 font-semibold disabled:opacity-50"
        >
          {progress ? "Importing…" : "Upload CSV"}
        </button>
        <a
          href="/sample-batch.csv"
          download
          className="text-emerald-700 dark:text-emerald-400 underline"
        >
          sample CSV
        </a>
        <span className="text-zinc-500">
          Columns: address (required), price, bedrooms, rent — header row
          optional; missing values fall back to the form above.
        </span>
      </div>

      {progress && (
        <div className="flex items-center gap-3">
          <div className="h-2 flex-1 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
            <div
              className="h-full bg-emerald-600 transition-all"
              style={{ width: `${(progress.done / progress.total) * 100}%` }}
            />
          </div>
          <span className="tabular-nums text-zinc-500 whitespace-nowrap">
            {progress.done}/{progress.total}
          </span>
          <span className="text-zinc-400 truncate max-w-[280px]">{current}</span>
        </div>
      )}

      {summary && <div className="text-emerald-700 dark:text-emerald-400">{summary}</div>}

      {errors.length > 0 && (
        <ul className="text-red-600 dark:text-red-400 list-disc pl-5">
          {errors.map((e, i) => (
            <li key={i}>
              <b>{e.address}</b>: {e.error}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
