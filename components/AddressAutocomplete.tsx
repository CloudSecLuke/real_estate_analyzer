"use client";

import { useEffect, useRef, useState } from "react";
import type { HistoryEntry } from "@/lib/types";

// Live address typeahead (PROP-33/41) backed by /api/address/autocomplete —
// which serves PropPencil's own county records first. Debounced, stale
// requests aborted, keyboard + click selection, and the user's previously
// penciled addresses surface at the top so nothing the old datalist offered
// is lost. Manual typing always works; suggestions are optional.

interface Suggestion {
  displayAddress: string;
  fromHistory?: boolean;
  note?: string;
}

export default function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  history,
  className,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect?: (v: string) => void;
  history: HistoryEntry[];
  className?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(-1);
  const [source, setSource] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = value.trim();
    if (timerRef.current) clearTimeout(timerRef.current);
    if (q.length < 3) {
      setItems([]);
      setOpen(false);
      return;
    }
    timerRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      const historyHits: Suggestion[] = history
        .filter((h) => h.address.toLowerCase().includes(q.toLowerCase()))
        .slice(0, 3)
        .map((h) => ({
          displayAddress: h.address,
          fromHistory: true,
          note: `penciled before · ${h.bedrooms} bed · $${h.price.toLocaleString("en-US")}`,
        }));
      let remote: Suggestion[] = [];
      try {
        const res = await fetch(
          `/api/address/autocomplete?q=${encodeURIComponent(q)}`,
          { signal: ac.signal }
        );
        if (res.ok) {
          const json = await res.json();
          setSource(json.source ?? null);
          remote = (json.suggestions ?? [])
            .filter(
              (s: { displayAddress: string }) =>
                !historyHits.some(
                  (h) => h.displayAddress.toUpperCase() === s.displayAddress.toUpperCase()
                )
            )
            .map((s: { displayAddress: string }) => ({ displayAddress: s.displayAddress }));
        }
      } catch {
        // aborted or offline — history-only suggestions still show
      }
      const merged = [...historyHits, ...remote].slice(0, 8);
      setItems(merged);
      setActive(-1);
      setOpen(merged.length > 0);
    }, 250);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  function pick(s: Suggestion) {
    onChange(s.displayAddress);
    setOpen(false);
    onSelect?.(s.displayAddress);
  }

  return (
    <div ref={rootRef} className="relative block w-full">
      <input
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => items.length > 0 && setOpen(true)}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, items.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, -1));
          } else if (e.key === "Enter" && active >= 0) {
            e.preventDefault();
            pick(items[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        autoComplete="off"
        className={className}
      />
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-full overflow-hidden rounded-[8px] border border-border bg-card shadow-[0_8px_24px_rgba(23,23,23,.12)]">
          {items.map((s, i) => (
            <button
              key={s.displayAddress + (s.fromHistory ? "-h" : "")}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                pick(s);
              }}
              className={`flex w-full flex-col items-start gap-[1px] px-3 py-[7px] text-left ${
                i === active ? "bg-accent-tint" : "hover:bg-accent-tint"
              }`}
            >
              <span className="w-full break-words text-[12.5px] font-medium leading-snug text-ink">
                {s.displayAddress}
              </span>
              {s.note && (
                <span className="text-[10.5px] text-label">{s.note}</span>
              )}
            </button>
          ))}
          {source === "owned" && (
            <div className="border-t border-rule px-3 py-[5px] text-[10px] font-semibold uppercase tracking-[.08em] text-label">
              From PropPencil county records
            </div>
          )}
        </div>
      )}
    </div>
  );
}
