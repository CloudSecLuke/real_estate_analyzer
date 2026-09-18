"use client";

import BatchImport from "@/components/BatchImport";
import AddressAutocomplete from "@/components/AddressAutocomplete";
import InfoTip from "@/components/InfoTip";
import { AppMark, MarkOnLight } from "@/components/PencilMark";
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
  "bg-card border border-input-border rounded-[7px] text-ink outline-none focus:border-ink focus:shadow-[0_0_0_3px_rgba(244,197,66,.45)]";

function MicroLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10.5px] font-bold uppercase tracking-[.1em] text-label">
      {children}
    </span>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10.5px] font-bold uppercase tracking-[.09em] text-accent">
      {children}
    </div>
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
    <label className="flex items-center justify-between gap-2 text-[12.5px] text-body">
      <span className="flex items-center">
        {label}
        {help && <InfoTip text={help} />}
      </span>
      <span className="flex items-center gap-[5px]">
        <input
          type="number"
          value={value ?? ""}
          placeholder={placeholder}
          onChange={(e) =>
            onChange(e.target.value === "" ? "" : Number(e.target.value))
          }
          className={`${inputBase} w-[52px] rounded-[5px] px-[7px] py-[5px] text-right text-[12px] font-semibold tabular-nums`}
        />
        <span className="w-[32px] text-[11px] text-label">{unit}</span>
      </span>
    </label>
  );
}

function Chip({ on, label, help }: { on: boolean; label: string; help: string }) {
  return (
    <span
      title={help}
      className={`cursor-help rounded-[5px] border px-2 py-[3px] text-[11.5px] font-medium ${
        on
          ? "bg-chip-on border-chip-on-border text-chip-on-text"
          : "bg-chip-off border-chip-off-border text-chip-off-text"
      }`}
    >
      {label}
      {on ? "" : " · off"}
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
  batchAssumptions: Omit<Assumptions, "price" | "bedrooms">;
  batchDefaultPrice: number;
  batchDefaultBedrooms: number;
  onPin: (pin: SavedPin) => void;
  history: HistoryEntry[];
  searches: SavedSearch[];
  onLoadSearch: (s: SavedSearch) => void;
  onDeleteSearch: (id: string) => void;
}) {
  const targetCoc = adv.targetCocPct ?? 10;
  return (
    <aside className="flex w-full flex-col gap-6 border-r border-border bg-sidebar px-[22px] pb-11 pt-6 max-lg:border-b max-lg:border-r-0 lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto">
      <div className="flex flex-col gap-[9px]">
        <div className="flex items-center gap-[10px]">
          <AppMark />
          <div className="flex flex-col gap-[2px]">
            <span className="text-[18px] font-extrabold leading-none tracking-[-.032em]">
              PropPencil
            </span>
            <span className="block h-[3px] w-[66px] rounded-[2px] bg-pencil" />
          </div>
        </div>
        <p className="text-[12.5px] leading-[1.55] text-label">
          Turn an address into an investor-ready analysis. We do the math, you
          make the decision.
        </p>
      </div>

      <form
        className="flex flex-col gap-[11px]"
        onSubmit={(e) => {
          e.preventDefault();
          onAnalyze();
        }}
      >
        <label className="flex flex-col gap-[5px]">
          <MicroLabel>Address or listing URL</MicroLabel>
          {/* live typeahead over PropPencil's own county records; the
              user's previously penciled addresses surface at the top */}
          <AddressAutocomplete
            value={address}
            onChange={onAddress}
            history={history}
            placeholder="123 Main St, Cincinnati, OH"
            className={`${inputBase} w-full px-[11px] py-[10px] text-[13px]`}
          />
        </label>
        <div className="grid grid-cols-[1fr_76px] gap-2">
          <label className="flex flex-col gap-[5px]">
            <MicroLabel>Asking price</MicroLabel>
            <input
              type="number"
              value={price}
              onChange={(e) =>
                onPrice(e.target.value === "" ? "" : Number(e.target.value))
              }
              className={`${inputBase} w-full px-[11px] py-[10px] text-[13px] font-semibold tabular-nums`}
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
              className={`${inputBase} w-full px-[11px] py-[10px] text-[13px] font-semibold tabular-nums`}
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={analyzing}
          className="w-full cursor-pointer rounded-[7px] bg-pencil px-3 py-3 text-[14px] font-extrabold tracking-[-.01em] text-ink hover:bg-pencil-dark disabled:opacity-60"
        >
          {analyzing ? "Penciling…" : "Pencil It"}
        </button>
        <BatchImport
          assumptions={batchAssumptions}
          defaultPrice={batchDefaultPrice}
          defaultBedrooms={batchDefaultBedrooms}
          onPin={onPin}
        />
      </form>

      <div className="flex flex-col gap-4 border-t border-border pt-[18px]">
        <div className="flex items-baseline justify-between gap-[10px]">
          <span className="flex items-center gap-[7px] text-[14.5px] font-bold tracking-[-.015em]">
            <MarkOnLight />
            Sharpen the Pencil
          </span>
          <button
            type="button"
            onClick={onReset}
            className="cursor-pointer text-[11.5px] font-semibold text-accent hover:text-link-hover"
          >
            Reset
          </button>
        </div>

        <div className="flex flex-col gap-[7px] rounded-[8px] border border-border bg-card p-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11.5px] font-bold text-ink">
              Required cash-on-cash
            </span>
            <span className="text-[15px] font-extrabold tabular-nums">
              {targetCoc.toFixed(1).replace(/\.0$/, "")}%
            </span>
          </div>
          <input
            type="range"
            min={4}
            max={20}
            step={0.5}
            value={targetCoc}
            onChange={(e) => setA("targetCocPct", Number(e.target.value))}
            className="pp-range"
          />
          <div className="flex justify-between text-[10.5px] text-label tabular-nums">
            <span>4%</span>
            <span>20%</span>
          </div>
          <p className="text-[11.5px] leading-[1.5] text-label">
            Sets your maximum buy price and drives the Pencil Score.
          </p>
        </div>

        <div className="flex flex-col gap-[9px]">
          <GroupLabel>Financing</GroupLabel>
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
          <GroupLabel>Income</GroupLabel>
          <Row
            label="Market rent override"
            unit="$/mo"
            value={adv.marketRentOverride ?? ""}
            placeholder="auto"
            onChange={(v) => setA("marketRentOverride", v === "" ? null : v)}
            help="A real market rent from a comparable unit. Entering one overrides every modelled estimate."
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
          <GroupLabel>Operating expenses</GroupLabel>
          <Row label="Tax rate override" unit="%/yr" value={adv.taxRateOverride ?? ""} placeholder="auto" onChange={(v) => setA("taxRateOverride", v === "" ? null : v)} />
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
          <Row
            label="CapEx reserve"
            unit="% rent"
            value={adv.capexPctOfRent}
            onChange={(v) => setA("capexPctOfRent", v === "" ? 0 : v)}
            help="CapEx = capital expenditures: the big-ticket replacements a house needs every 15–25 years — roof, furnace/AC, water heater, siding. This reserve treats those future bills as a monthly cost today, so one roof doesn't erase years of paper profit. Distinct from routine maintenance."
          />
          <Row label="Management" unit="%" value={adv.managementPct} onChange={(v) => setA("managementPct", v === "" ? 0 : v)} />
          <Row
            label="Empty months — market"
            unit="%"
            value={adv.vacancyPctMarket}
            onChange={(v) => setA("vacancyPctMarket", v === "" ? 5 : v)}
            help="Share of the year you expect the unit to sit empty between tenants."
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
            help="Co-hosting fee as a share of short-term revenue. Typically 20–30%."
          />
          <Row
            label="Short-term extra costs"
            unit="$/mo"
            value={adv.strOtherMonthlyExpense}
            onChange={(v) => setA("strOtherMonthlyExpense", v === "" ? 250 : v)}
            help="Utilities, wifi, cleaning supplies and consumables the owner pays on a short-term rental."
          />
        </div>

        <div className="flex flex-col gap-[9px]">
          <GroupLabel>Exit &amp; projection</GroupLabel>
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
        <div className="flex flex-col gap-[6px] border-t border-border pt-[18px] lg:hidden">
          <MicroLabel>My Pencils</MicroLabel>
          {searches.map((s) => (
            <div
              key={s.id}
              className="flex items-start justify-between gap-2 border-b border-rule pb-[7px]"
            >
              <button
                type="button"
                onClick={() => onLoadSearch(s)}
                title="Pencil this property again with the saved price, bedrooms and assumptions"
                className="flex min-w-0 cursor-pointer flex-col items-start gap-[1px] text-left"
              >
                <span className="w-full truncate text-[12.5px] font-medium text-ink hover:text-accent">
                  {s.name}
                </span>
                <span className="text-[11px] text-label tabular-nums">
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
                title="Remove from My Pencils"
                className="cursor-pointer px-1 text-[12px] text-label hover:text-negative"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {history.length > 0 && (
        <div className="flex flex-col gap-[6px] border-t border-border pt-[18px] lg:hidden">
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

      <div className="flex flex-col gap-[9px] border-t border-border pt-[18px]">
        <MicroLabel>Where the numbers come from</MicroLabel>
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
            label="HUD"
            help="Free token from huduser.gov. Sets the Section 8 rent, and the market rent when no property-level estimate exists."
          />
          <Chip
            on={sources?.attom ?? false}
            label="Property records"
            help="Licensed property records: the actual tax bill, value estimate and rent estimate."
          />
          <Chip
            on={sources?.mashvisor ?? false}
            label="Short-term data"
            help="Licensed short-term rental data: occupancy, nightly rate and revenue. Without it there is no honest short-term scenario."
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
