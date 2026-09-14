"use client";

import BatchImport from "@/components/BatchImport";
import type {
  Assumptions,
  HistoryEntry,
  SavedPin,
  SavedSearch,
} from "@/lib/types";

export interface SourceStatus {
  census: boolean;
  fema: boolean;
  hud: boolean;
  attom: boolean;
  mashvisor: boolean;
  countyData: boolean;
  persistence: boolean;
}

const inputBase =
  "bg-field border border-input-border rounded-[2px] text-ink outline-none focus:border-accent focus:shadow-[0_0_0_3px_rgba(150,85,42,.1)]";

function MicroLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10.5px] font-semibold uppercase tracking-[.11em] text-label">
      {children}
    </span>
  );
}

function Row({
  label,
  unit,
  value,
  onChange,
  placeholder,
  help,
}: {
  label: string;
  unit: string;
  value: number | "" | null;
  onChange: (v: number | "") => void;
  placeholder?: string;
  help?: string;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-[12.5px] text-[#4a423a]">
      <span title={help} className={help ? "cursor-help" : undefined}>
        {label}
      </span>
      <span className="flex items-center gap-[5px]">
        <input
          type="number"
          value={value ?? ""}
          placeholder={placeholder}
          onChange={(e) =>
            onChange(e.target.value === "" ? "" : Number(e.target.value))
          }
          className={`${inputBase} w-[50px] px-[6px] py-[4px] text-right text-[12px]`}
        />
        <span className="w-[30px] text-[11px] text-label">{unit}</span>
      </span>
    </label>
  );
}

function Chip({
  on,
  label,
  help,
}: {
  on: boolean;
  label: string;
  help: string;
}) {
  return (
    <span
      title={help}
      className={`cursor-help rounded-[2px] border px-2 py-[3px] text-[11.5px] ${
        on
          ? "bg-chip-on border-chip-on-border text-[#4a423a]"
          : "bg-chip-off border-chip-off-border text-chip-off-text"
      }`}
    >
      {label} · {on ? "on" : "off"}
    </span>
  );
}

export default function AssumptionsSidebar({
  address,
  onAddress,
  price,
  onPrice,
  bedrooms,
  onBedrooms,
  adv,
  setA,
  onReset,
  onAnalyze,
  analyzing,
  sources,
  liveRate,
  user,
  persistent,
  onSignOut,
  batchAssumptions,
  batchDefaultPrice,
  batchDefaultBedrooms,
  onPin,
  history,
  searches,
  onLoadSearch,
  onDeleteSearch,
}: {
  address: string;
  onAddress: (v: string) => void;
  price: number | "";
  onPrice: (v: number | "") => void;
  bedrooms: number | "";
  onBedrooms: (v: number | "") => void;
  adv: Omit<Assumptions, "price" | "bedrooms">;
  setA: <K extends keyof Omit<Assumptions, "price" | "bedrooms">>(
    k: K,
    v: Omit<Assumptions, "price" | "bedrooms">[K]
  ) => void;
  onReset: () => void;
  onAnalyze: () => void;
  analyzing: boolean;
  sources: SourceStatus | null;
  liveRate: { pct: number; asOf: string } | null;
  user: string | null;
  persistent: boolean;
  onSignOut: () => void;
  batchAssumptions: Omit<Assumptions, "price" | "bedrooms">;
  batchDefaultPrice: number;
  batchDefaultBedrooms: number;
  onPin: (pin: SavedPin) => void;
  history: HistoryEntry[];
  searches: SavedSearch[];
  onLoadSearch: (s: SavedSearch) => void;
  onDeleteSearch: (id: string) => void;
}) {
  return (
    <aside className="flex w-full flex-col gap-6 border-r border-rule bg-sidebar px-[22px] pb-11 pt-[26px] max-lg:border-b max-lg:border-r-0 lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto">
      <div className="flex flex-col gap-[6px]">
        <h1 className="font-serif text-[23px] font-medium leading-[1.2] tracking-[-.01em]">
          Rental Cash Flow Analyzer
        </h1>
        <p className="text-[12.5px] leading-[1.6] text-body">
          Three ways to run the same house, underwritten from one address.
        </p>
        {user && (
          <p className="text-[11.5px] text-label">
            {user}
            {!persistent && " (local only)"} ·{" "}
            <button
              onClick={onSignOut}
              className="cursor-pointer border-b border-accent/30 text-accent hover:text-link-hover"
            >
              sign out
            </button>
          </p>
        )}
      </div>

      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          onAnalyze();
        }}
      >
        <label className="flex flex-col gap-[5px]">
          <MicroLabel>Address</MicroLabel>
          <input
            required
            value={address}
            onChange={(e) => onAddress(e.target.value)}
            placeholder="123 Main St, Cincinnati, OH"
            list="address-history"
            className={`${inputBase} w-full px-[10px] py-[9px] text-[13px]`}
          />
          {/* previously analyzed addresses, most recent first */}
          <datalist id="address-history">
            {history.map((h) => (
              <option key={h.address} value={h.address}>
                {`${h.bedrooms} bed · $${h.price.toLocaleString("en-US")}`}
              </option>
            ))}
          </datalist>
        </label>
        <div className="grid grid-cols-[1fr_74px] gap-2">
          <label className="flex flex-col gap-[5px]">
            <MicroLabel>Price</MicroLabel>
            <input
              type="number"
              value={price}
              onChange={(e) =>
                onPrice(e.target.value === "" ? "" : Number(e.target.value))
              }
              className={`${inputBase} w-full px-[10px] py-[9px] text-[13px]`}
            />
          </label>
          <label className="flex flex-col gap-[5px]">
            <MicroLabel>Beds</MicroLabel>
            <input
              type="number"
              value={bedrooms}
              onChange={(e) =>
                onBedrooms(e.target.value === "" ? "" : Number(e.target.value))
              }
              className={`${inputBase} w-full px-[10px] py-[9px] text-[13px]`}
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={analyzing}
          className="w-full cursor-pointer rounded-[2px] bg-accent px-3 py-[11px] text-[13px] font-semibold tracking-[.02em] text-field hover:bg-accent-hover disabled:opacity-60"
        >
          {analyzing ? "Analyzing…" : "Analyze deal"}
        </button>
        <BatchImport
          assumptions={batchAssumptions}
          defaultPrice={batchDefaultPrice}
          defaultBedrooms={batchDefaultBedrooms}
          onPin={onPin}
        />
      </form>

      <div className="flex flex-col gap-[18px]">
        <div className="flex items-baseline justify-between border-b border-rule pb-[6px]">
          <span className="font-serif text-[15px] font-medium">Assumptions</span>
          <button
            type="button"
            onClick={onReset}
            className="cursor-pointer text-[11.5px] text-accent hover:text-link-hover"
          >
            Reset
          </button>
        </div>

        <div className="flex flex-col gap-[9px]">
          <MicroLabel>Financing</MicroLabel>
          <Row label="Down payment" unit="%" value={adv.downPaymentPct} onChange={(v) => setA("downPaymentPct", v === "" ? 0 : v)} />
          <Row label="Interest rate" unit="%" value={adv.interestRatePct} onChange={(v) => setA("interestRatePct", v === "" ? 0 : v)} />
          <Row label="Loan term" unit="yrs" value={adv.loanTermYears} onChange={(v) => setA("loanTermYears", v === "" ? 30 : v)} />
          <Row label="Closing costs" unit="%" value={adv.closingCostPct} onChange={(v) => setA("closingCostPct", v === "" ? 0 : v)} />
          <Row label="Rehab budget" unit="$" value={adv.rehabCost} onChange={(v) => setA("rehabCost", v === "" ? 0 : v)} />
          {liveRate && (
            <p className="text-[11px] leading-[1.55] text-label">
              Rate default {liveRate.pct}% is the current 30-yr average
              (Freddie Mac, {liveRate.asOf}).
            </p>
          )}
        </div>

        <div className="flex flex-col gap-[9px]">
          <MicroLabel>Income</MicroLabel>
          <Row
            label="Market rent override"
            unit="$/mo"
            value={adv.marketRentOverride ?? ""}
            placeholder="auto"
            onChange={(v) => setA("marketRentOverride", v === "" ? null : v)}
            help="A real market rent from a comparable unit. Entering one overrides every modelled estimate for the market scenario."
          />
          <Row
            label="Section 8 payment standard"
            unit="%"
            value={adv.paymentStandardPct}
            onChange={(v) => setA("paymentStandardPct", v === "" ? 100 : v)}
            help="What the local housing authority will pay as a percentage of the Fair Market Rent. Most set it between 100% and 110%."
          />
          <Row label="Other income" unit="$/mo" value={adv.otherMonthlyIncome} onChange={(v) => setA("otherMonthlyIncome", v === "" ? 0 : v)} />
          <Row label="Units" unit="" value={adv.units} onChange={(v) => setA("units", v === "" ? 1 : v)} />
        </div>

        <div className="flex flex-col gap-[9px]">
          <MicroLabel>Expenses</MicroLabel>
          <Row
            label="Tax rate override"
            unit="%/yr"
            value={adv.taxRateOverride ?? ""}
            placeholder="auto"
            onChange={(v) => setA("taxRateOverride", v === "" ? null : v)}
          />
          <Row label="Insurance" unit="%/yr" value={adv.insurancePctOfValue} onChange={(v) => setA("insurancePctOfValue", v === "" ? 0.5 : v)} />
          <Row
            label="Insurance floor"
            unit="$/mo"
            value={adv.insuranceFloorMonthly}
            onChange={(v) => setA("insuranceFloorMonthly", v === "" ? 0 : v)}
            help="Minimum monthly insurance regardless of price — cheap houses don't get proportionally cheap policies."
          />
          <Row label="Maintenance" unit="%/yr" value={adv.maintenancePctOfValue} onChange={(v) => setA("maintenancePctOfValue", v === "" ? 1 : v)} />
          <Row
            label="Maintenance floor"
            unit="$/mo"
            value={adv.maintenanceFloorMonthly}
            onChange={(v) => setA("maintenanceFloorMonthly", v === "" ? 0 : v)}
            help="Minimum monthly repair reserve — a 1920s roof costs the same on a $60k house as on a $300k one."
          />
          <Row label="Management" unit="%" value={adv.managementPct} onChange={(v) => setA("managementPct", v === "" ? 0 : v)} />
          <Row
            label="Empty months — market"
            unit="%"
            value={adv.vacancyPctMarket}
            onChange={(v) => setA("vacancyPctMarket", v === "" ? 5 : v)}
            help="Share of the year you expect the unit to sit empty between tenants, taken off the rent."
          />
          <Row
            label="Empty months — Section 8"
            unit="%"
            value={adv.vacancyPctSection8}
            onChange={(v) => setA("vacancyPctSection8", v === "" ? 2 : v)}
            help="Lower than market: the voucher portion keeps paying, so only turnover creates a gap."
          />
          <Row label="Other expenses" unit="$/mo" value={adv.otherMonthlyExpense} onChange={(v) => setA("otherMonthlyExpense", v === "" ? 0 : v)} />
          <Row
            label="Short-term management"
            unit="%"
            value={adv.strManagementPct}
            onChange={(v) => setA("strManagementPct", v === "" ? 20 : v)}
            help="Co-hosting fee as a share of short-term revenue. Typically 20–30%, well above long-term management."
          />
          <Row
            label="Short-term extra costs"
            unit="$/mo"
            value={adv.strOtherMonthlyExpense}
            onChange={(v) => setA("strOtherMonthlyExpense", v === "" ? 250 : v)}
            help="Utilities, wifi, cleaning supplies and consumables the owner pays on a short-term rental but not on a lease."
          />
        </div>

        <div className="flex flex-col gap-[9px]">
          <MicroLabel>Exit &amp; projection</MicroLabel>
          <Row
            label="Appreciation"
            unit="%/yr"
            value={adv.appreciationPctAnnual}
            onChange={(v) => setA("appreciationPctAnnual", v === "" ? 3 : v)}
            help="Annual value growth assumed by the 5-year hold projection."
          />
          <Row
            label="Selling costs"
            unit="%"
            value={adv.sellingCostPct}
            onChange={(v) => setA("sellingCostPct", v === "" ? 7 : v)}
            help="Agent commission plus seller closing costs on exit."
          />
        </div>
      </div>

      {searches.length > 0 && (
        <div className="flex flex-col gap-[6px] border-t border-rule pt-[18px]">
          <MicroLabel>Saved searches</MicroLabel>
          {searches.map((s) => (
            <div
              key={s.id}
              className="flex items-start justify-between gap-2 border-b border-rule pb-[7px]"
            >
              <button
                type="button"
                onClick={() => onLoadSearch(s)}
                title="Re-run this analysis with the saved price, bedrooms and assumptions"
                className="flex min-w-0 cursor-pointer flex-col items-start gap-[1px] text-left"
              >
                <span className="w-full truncate text-[12.5px] text-ink hover:text-accent">
                  {s.name}
                </span>
                <span className="text-[11px] text-label">
                  ${s.price.toLocaleString("en-US")} · {s.bedrooms} bed ·{" "}
                  {new Date(s.savedAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </button>
              <button
                type="button"
                onClick={() => onDeleteSearch(s.id)}
                title="Delete saved search"
                className="cursor-pointer px-1 text-[12px] text-label hover:text-negative"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {history.length > 0 && (
        <div className="flex flex-col gap-[6px] border-t border-rule pt-[18px]">
          <MicroLabel>Recent addresses</MicroLabel>
          {history.slice(0, 5).map((h) => (
            <button
              key={h.address}
              type="button"
              onClick={() => onAddress(h.address)}
              title="Fill the address field (also available by typing in the field)"
              className="cursor-pointer truncate text-left text-[12px] text-body hover:text-accent"
            >
              {h.address}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-[9px] border-t border-rule pt-[18px]">
        <MicroLabel>Data sources</MicroLabel>
        <div className="flex flex-wrap gap-[6px]">
          <Chip
            on
            label="Census"
            help="Census Bureau geocoder: turns the address into coordinates, a county and a ZIP code. No key needed."
          />
          <Chip
            on
            label="FEMA"
            help="FEMA flood maps: the flood zone at this location, which raises the insurance estimate in high-risk areas. No key needed."
          />
          <Chip
            on={sources?.hud ?? true}
            label="HUD Fair Market Rent"
            help="Free token from huduser.gov. Sets the Section 8 rent, and the market rent when no ATTOM estimate exists."
          />
          <Chip
            on={sources?.attom ?? false}
            label="ATTOM"
            help="Paid property records: the actual tax bill, bedroom count, value estimate and rental estimate."
          />
          <Chip
            on={sources?.mashvisor ?? false}
            label="Mashvisor"
            help="Paid short-term rental data: occupancy, nightly rate and revenue for this area. Without it there is no honest Airbnb scenario."
          />
          <Chip
            on={sources?.countyData ?? false}
            label="County data"
            help="Free Census data API key: the county's actual tax rate, median rents by bedroom, rental vacancy and population trend."
          />
        </div>
      </div>

    </aside>
  );
}
