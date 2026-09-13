"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { PinMetrics, SavedPin, ScenarioKey } from "@/lib/types";
import { RATING_COLORS } from "@/lib/metrics";

const CINCINNATI: [number, number] = [39.103, -84.512];

const usd = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

function scenarioLine(label: string, m: PinMetrics | undefined): string {
  if (!m) return "";
  const color = m.monthlyCashFlow > 0 ? "#059669" : "#dc2626";
  const almostChip = m.almost
    ? `<span style="border:1.5px dashed ${RATING_COLORS[m.almost]};color:${RATING_COLORS[m.almost]};border-radius:9px;padding:0 6px;font-size:11px;margin-left:3px;font-weight:600">Almost ${m.almost}</span>`
    : "";
  const gapLine =
    m.almost && m.gapText
      ? `<div style="color:${RATING_COLORS[m.almost]};font-size:11px">${m.gapText} away from ${m.almost}</div>`
      : "";
  return `<div style="margin-top:4px">
    <b>${label}:</b>
    <span style="color:${color};font-weight:700">${usd(m.monthlyCashFlow)}/mo</span>
    <span style="background:${RATING_COLORS[m.rating]};color:#fff;border-radius:9px;padding:0 7px;font-size:11px;margin-left:4px">${m.rating}</span>${almostChip}
    ${gapLine}
    <div style="color:#71717a;font-size:11px">rent ${usd(m.rent)} · CoC ${m.cashOnCashPct.toFixed(1)}% · cap ${m.capRatePct.toFixed(1)}%</div>
  </div>`;
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

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current).setView(CINCINNATI, 11);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    markersRef.current.clear();

    for (const pin of pins) {
      const metrics = pin[colorBy] ?? pin.market ?? pin.s8 ?? pin.str;
      const color = metrics ? RATING_COLORS[metrics.rating] : "#71717a";
      // Near-miss deals get a ring in the next tier's color so the nuance
      // is visible on the map itself, not just in the popup.
      const almostColor = metrics?.almost ? RATING_COLORS[metrics.almost] : null;
      const marker = L.circleMarker([pin.lat, pin.lon], {
        radius: 10,
        color: almostColor ?? "#ffffff",
        weight: almostColor ? 4 : 2,
        fillColor: color,
        fillOpacity: 0.95,
      }).bindPopup(
        `<div style="font-family:system-ui;min-width:210px">
          <b>${pin.address}</b>
          <div style="color:#71717a;font-size:12px">${usd(pin.price)} · ${pin.bedrooms} BR</div>
          ${scenarioLine("Market", pin.market)}
          ${scenarioLine("Section 8", pin.s8)}
          ${scenarioLine("Airbnb", pin.str)}
        </div>`
      );
      marker.addTo(layer);
      markersRef.current.set(pin.id, marker);
    }

    if (pins.length > 0) {
      const bounds = L.latLngBounds(pins.map((p) => [p.lat, p.lon]));
      map.fitBounds(bounds.pad(0.3), { maxZoom: 14 });
    }
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
      className="h-[440px] w-full rounded-xl border border-zinc-200 dark:border-zinc-800 z-0"
    />
  );
}
