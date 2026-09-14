"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { PinMetrics, SavedPin, ScenarioKey } from "@/lib/types";
import { LEGACY_RATING_LABEL, RATING_COLORS } from "@/lib/metrics";
import {
  tierForLegacyRating,
  tierForScore,
  type PencilTier,
} from "@/lib/pencilScore";

const CINCINNATI: [number, number] = [39.103, -84.512];
const POS = "#0f6b44";
const NEG = "#a8281e";

const usd = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

const signed = (n: number) =>
  (n >= 0 ? "+" : "−") + "$" + Math.abs(Math.round(n)).toLocaleString("en-US");

function tierOf(m: PinMetrics | undefined): PencilTier | null {
  if (!m) return null;
  return m.score != null ? tierForScore(m.score) : tierForLegacyRating(m.rating);
}

function bestPlay(pin: SavedPin): string {
  const plays: [string, PinMetrics | undefined][] = [
    ["Traditional rental", pin.market],
    ["Section 8 voucher", pin.s8],
    ["Short-term rental", pin.str],
  ];
  let best: string | null = null;
  let bestCf = -Infinity;
  for (const [label, m] of plays) {
    if (m && m.monthlyCashFlow > bestCf) {
      bestCf = m.monthlyCashFlow;
      best = label;
    }
  }
  return best ?? "—";
}

function scenarioMini(label: string, m: PinMetrics | undefined): string {
  if (!m) return "";
  return `<div style="font-size:11px;color:#5f5f5c">${label} ${signed(m.monthlyCashFlow)}/mo${m.score != null ? ` · score ${m.score}` : ` · ${LEGACY_RATING_LABEL[m.rating]}`}${m.almost ? ` (almost ${LEGACY_RATING_LABEL[m.almost]}${m.gapText ? ", " + m.gapText : ""})` : ""}</div>`;
}

export default function PropertyMap({
  pins,
  colorBy,
  focusId,
}: {
  pins: SavedPin[];
  colorBy: ScenarioKey;
  focusId?: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef<Map<string, L.CircleMarker>>(new Map());
  const roRef = useRef<ResizeObserver | null>(null);
  const pinsRef = useRef<SavedPin[]>(pins);
  pinsRef.current = pins;

  // A fitBounds computed while the container reports no usable size commits
  // zoom 0 and nothing later corrects it — refuse to fit until there's a box.
  const refit = () => {
    const map = mapRef.current;
    if (!map) return;
    if (map.getSize().x < 50) return; // unsized: any fit would be wrong
    const pts = pinsRef.current.map((p) => [p.lat, p.lon] as [number, number]);
    if (!pts.length) return;
    map.fitBounds(L.latLngBounds(pts).pad(0.3), { maxZoom: 14, animate: false });
  };

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const el = containerRef.current;
    const map = L.map(el, { scrollWheelZoom: false }).setView(CINCINNATI, 11);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    // The container mounts inside a conditional section and the page
    // reflows as fonts and streamed content settle, so one invalidateSize()
    // is not enough. Three guards, per the design handoff.
    if (typeof ResizeObserver !== "undefined") {
      roRef.current = new ResizeObserver(() => {
        if (!mapRef.current) return;
        mapRef.current.invalidateSize();
        refit();
      });
      roRef.current.observe(el);
    }
    if (document.fonts?.ready) {
      document.fonts.ready.then(() => {
        if (mapRef.current) {
          mapRef.current.invalidateSize();
          refit();
        }
      });
    }
    const settle = (tries: number) => {
      const m = mapRef.current;
      if (!m || tries > 12) return;
      m.invalidateSize();
      refit();
      if (m.getSize().x > 50 && m.getZoom() > 0) return;
      setTimeout(() => settle(tries + 1), 200);
    };
    settle(0);

    return () => {
      roRef.current?.disconnect();
      roRef.current = null;
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    markersRef.current.clear();

    for (const pin of pins) {
      const metrics = pin[colorBy] ?? pin.market ?? pin.s8 ?? pin.str;
      const tier = tierOf(metrics);
      const color = tier?.dot ?? "#8a8780";
      // Near-miss deals keep their ring in the legacy next-tier color so
      // the nuance stays visible on the map itself.
      const almostColor = metrics?.almost ? RATING_COLORS[metrics.almost] : null;
      const marker = L.circleMarker([pin.lat, pin.lon], {
        radius: 10,
        color: almostColor ?? "#fffefb",
        weight: almostColor ? 3.5 : 2.5,
        fillColor: color,
        fillOpacity: 1,
      }).bindPopup(
        `<div style="font-family:'Plus Jakarta Sans',sans-serif;min-width:186px">
          <div style="font-weight:700;font-size:14px;letter-spacing:-.02em">${pin.address}</div>
          <div style="color:#5f5f5c;font-size:11.5px;margin-top:2px">${usd(pin.price)} · ${pin.bedrooms} bed${pin.investorValue != null ? ` · investor value ${usd(pin.investorValue)}` : ""} · best play ${bestPlay(pin)}</div>
          <div style="margin-top:8px;display:flex;align-items:center;gap:8px">
            ${metrics?.score != null ? `<span style="font-size:20px;font-weight:800;letter-spacing:-.03em">${metrics.score}</span>` : ""}
            ${tier ? `<span style="background:${tier.bg};color:${tier.fg};border-radius:4px;padding:2px 7px;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;white-space:nowrap">${tier.label}</span>` : ""}
          </div>
          <div style="margin-top:5px;font-size:12px;font-weight:700;color:${metrics && metrics.monthlyCashFlow > 0 ? POS : NEG}">${metrics ? signed(metrics.monthlyCashFlow) + "/mo cash flow" : "—"}</div>
          <div style="margin-top:6px">
            ${scenarioMini("Traditional", pin.market)}
            ${scenarioMini("Section 8", pin.s8)}
            ${scenarioMini("Short-term", pin.str)}
          </div>
        </div>`
      );
      marker.addTo(layer);
      markersRef.current.set(pin.id, marker);
    }
    refit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pins, colorBy]);

  useEffect(() => {
    if (!focusId) return;
    const marker = markersRef.current.get(focusId);
    const map = mapRef.current;
    if (marker && map) {
      map.setView(marker.getLatLng(), Math.max(map.getZoom(), 13));
      marker.openPopup();
    }
  }, [focusId]);

  return (
    <div
      ref={containerRef}
      className="z-0 h-[400px] w-full rounded-[10px] border border-border bg-sidebar"
    />
  );
}
