"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { PinMetrics, SavedPin, ScenarioKey } from "@/lib/types";
import { RATING_COLORS } from "@/lib/metrics";

const CINCINNATI: [number, number] = [39.103, -84.512];
const POS = "#2f6b4f";
const NEG = "#a33a2b";

const usd = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

const signed = (n: number) =>
  (n >= 0 ? "+" : "−") + "$" + Math.abs(Math.round(n)).toLocaleString("en-US");

function bestPlay(pin: SavedPin): string {
  const plays: [string, PinMetrics | undefined][] = [
    ["Market rent", pin.market],
    ["Section 8", pin.s8],
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
  return `<div style="font-size:11px;color:#6b6257">${label} ${signed(m.monthlyCashFlow)}/mo · ${m.rating}${m.almost ? ` (almost ${m.almost}${m.gapText ? ", " + m.gapText : ""})` : ""}</div>`;
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
    map.fitBounds(L.latLngBounds(pts).pad(0.3), {
      maxZoom: 14,
      animate: false,
    });
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
      const color = metrics ? RATING_COLORS[metrics.rating] : "#6b6257";
      // Near-miss deals keep their ring in the next tier's color so the
      // nuance stays visible on the map itself.
      const almostColor = metrics?.almost ? RATING_COLORS[metrics.almost] : null;
      const marker = L.circleMarker([pin.lat, pin.lon], {
        radius: 9,
        color: almostColor ?? "#fdfbf7",
        weight: almostColor ? 3.5 : 2.5,
        fillColor: color,
        fillOpacity: 1,
      }).bindPopup(
        `<div style="font-family:'Fira Sans',Helvetica,sans-serif;min-width:190px">
          <div style="font-family:Newsreader,Georgia,serif;font-weight:500;font-size:15px">${pin.address}</div>
          <div style="color:#6b6257;font-size:11.5px;margin-top:2px">${usd(pin.price)} · ${pin.bedrooms} BR · best play ${bestPlay(pin)}</div>
          <div style="margin-top:7px;display:flex;align-items:center;gap:7px">
            <span style="color:${metrics && metrics.monthlyCashFlow > 0 ? POS : NEG};font-weight:600;font-size:13px">${metrics ? signed(metrics.monthlyCashFlow) + "/mo" : "—"}</span>
            <span style="background:${color};color:#fdfbf7;border-radius:2px;padding:2px 7px;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase">${metrics?.rating ?? "—"}</span>
          </div>
          <div style="margin-top:6px">
            ${scenarioMini("Market", pin.market)}
            ${scenarioMini("Section 8", pin.s8)}
            ${scenarioMini("Airbnb", pin.str)}
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
      className="z-0 h-[400px] w-full border border-input-border bg-sidebar"
    />
  );
}
