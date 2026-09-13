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
    <div className="flex flex-col gap-2">
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
      <p className="text-[11.5px] leading-[1.6] text-label">
        Or{" "}
        <button
          type="button"
          disabled={progress !== null}
          onClick={() => fileRef.current?.click()}
          className="cursor-pointer border-b border-accent/30 text-accent hover:text-link-hover disabled:opacity-60"
        >
          {progress ? "importing…" : "upload a CSV"}
        </button>{" "}
        to underwrite a whole list at once (
        <a
          href="/sample-batch.csv"
          download
          className="border-b border-accent/30 text-accent hover:text-link-hover"
        >
          sample
        </a>
        ). Columns: address, price, bedrooms, rent — missing values fall back
        to the form above.
      </p>

      {progress && (
        <div className="flex items-center gap-2 text-[11px] text-label">
          <div className="h-[6px] flex-1 overflow-hidden rounded-[1px] bg-bar-track">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${(progress.done / progress.total) * 100}%` }}
            />
          </div>
          <span className="whitespace-nowrap tabular-nums">
            {progress.done}/{progress.total}
          </span>
          <span className="max-w-[120px] truncate">{current}</span>
        </div>
      )}

      {summary && <div className="text-[11.5px] text-positive">{summary}</div>}

      {errors.length > 0 && (
        <ul className="list-disc pl-4 text-[11.5px] text-negative">
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
