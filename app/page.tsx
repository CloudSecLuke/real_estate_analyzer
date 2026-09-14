import Link from "next/link";
import { AppMark, AppMarkInverted } from "@/components/PencilMark";
import AddressCta from "@/components/marketing/AddressCta";

// The PropPencil marketing landing page. Static server component — the
// only client JS is the two <AddressCta /> forms. Every figure below is
// the app's real output for the sample property (1418 Vine St at
// $118,000, 10% required return): score 83 Fantastic Pencil, +$557/mo
// short-term, $156,500 investor value, $38,500 headroom. Regenerate from
// the app if the sample ever changes; never edit by hand.

const NAV_LINKS = [
  ["#how", "How it works"],
  ["#score", "Pencil Score"],
  ["#price", "Max buy price"],
  ["#strategies", "Section 8"],
  ["#pricing", "Pricing"],
] as const;

const SOURCE_CHIPS = [
  "HUD Fair Market Rents",
  "FEMA flood maps",
  "County tax records",
  "Short-term rental data",
];

const SCORE_PARTS = [
  ["Monthly cash flow", 74, "+$557/mo"],
  ["Cash-on-cash", 98, "24.6%"],
  ["Cap rate", 77, "12.2%"],
  ["Debt coverage", 88, "1.87x"],
  ["Price vs value", 77, "−25%"],
] as const;

const HOW_CARDS = [
  [
    "01",
    "What is it worth to you?",
    "An investor value built from the property's own economics and the return you require — not a public estimate of what someone might list it for.",
  ],
  [
    "02",
    "What will it earn and cost?",
    "Rent, taxes, insurance, reserves, management and financing — modelled across a traditional lease, a Section 8 voucher and a short-term rental.",
  ],
  [
    "03",
    "What could go wrong?",
    "The specific assumptions that would break the deal, each with a dollar figure attached — not a vague risk score you cannot act on.",
  ],
  [
    "04",
    "What price should you pay?",
    "A maximum buy price tied to your required return, so you walk into the negotiation knowing the number you will not go past.",
  ],
] as const;

const TIER_ROWS = [
  ["Rare Pencil", "90 and up", "#171717", "#f4c542"],
  ["Fantastic Pencil", "80–89", "#0f6b44", "#ffffff"],
  ["Great Pencil", "70–79", "#3f7a2e", "#ffffff"],
  ["Good Pencil", "60–69", "#8a6410", "#ffffff"],
  ["Fair Pencil", "50–59", "#a85520", "#ffffff"],
  ["Poor Pencil", "below 50", "#a8281e", "#ffffff"],
] as const;

const STRATEGY_CARDS = [
  {
    score: "83",
    tier: "Fantastic Pencil",
    tierBg: "#0f6b44",
    name: "Short-term rental",
    rows: [
      ["Revenue", "$2,340/mo", false],
      ["Cash flow", "+$557/mo", true],
      ["Cash-on-cash", "24.6%", false],
      ["Debt coverage", "1.87x", false],
    ],
    note: "Highest return, highest variance. Ten points off occupancy costs about $307 a month.",
  },
  {
    score: "71",
    tier: "Great Pencil",
    tierBg: "#3f7a2e",
    name: "Section 8 voucher",
    rows: [
      ["Rent", "$1,419/mo", false],
      ["Cash flow", "+$230/mo", true],
      ["Cash-on-cash", "10.2%", false],
      ["Debt coverage", "1.44x", false],
    ],
    note: "Contract-backed rent and 2% empty months. The trade is an inspection and the authority's rent ceiling.",
  },
  {
    score: "62",
    tier: "Good Pencil",
    tierBg: "#8a6410",
    name: "Traditional rental",
    rows: [
      ["Rent", "$1,275/mo", false],
      ["Cash flow", "+$72/mo", true],
      ["Cash-on-cash", "3.2%", false],
      ["Debt coverage", "1.18x", false],
    ],
    note: "A modelled rent, not a signed lease. One comparable rental from the block is worth more than any estimate.",
  },
] as const;

const NOI_ROWS = [
  ["Gross potential rent", "$28,080", false, false],
  ["Effective gross income", "$28,080", true, false],
  ["Property taxes", "−$1,876", false, true],
  ["Insurance, maintenance, CapEx", "−$3,174", false, true],
  ["Management and utilities", "−$8,616", false, true],
] as const;

const RISK_ITEMS = [
  [
    "Occupancy",
    "The whole case rests on 61% occupancy holding. Ten points off costs roughly $307 a month, which would still leave it ahead of the voucher case.",
  ],
  [
    "Insurance",
    "Budgeted at $49 a month. A real quote coming back $60 higher takes the score down a tier.",
  ],
  [
    "Rent estimate",
    "The rent is modelled, not leased. Range $1,180–$1,390. One real comparable from the block settles it.",
  ],
  [
    "Age and big-ticket repairs",
    "Built 1912. The 5% CapEx reserve is $117 a month — thin for a roof and an HVAC on a house this old.",
  ],
] as const;

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-bold uppercase tracking-[.14em] text-accent">
      {children}
    </span>
  );
}

export default function Landing() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-[rgba(251,249,244,.92)] backdrop-blur-[8px]">
        <nav className="mx-auto flex w-full max-w-[1180px] flex-wrap items-center gap-[18px] px-8 py-[14px] max-md:px-5">
          <Link href="/" className="flex shrink-0 items-center gap-[10px]">
            <AppMark />
            <span className="flex flex-col gap-[2px]">
              <span className="text-[18px] font-extrabold leading-none tracking-[-.032em] text-ink">
                PropPencil
              </span>
              <span className="block h-[3px] w-[66px] rounded-[2px] bg-pencil" />
            </span>
          </Link>
          <div className="ml-auto flex flex-wrap items-center gap-[22px] max-md:gap-4">
            {NAV_LINKS.map(([href, label]) => (
              <a
                key={href}
                href={href}
                className="text-[13.5px] font-semibold text-body hover:text-ink max-md:hidden"
              >
                {label}
              </a>
            ))}
            <Link
              href="/login"
              className="text-[13.5px] font-semibold text-body hover:text-ink"
            >
              Log in
            </Link>
            <Link
              href="/app"
              className="rounded-[7px] bg-pencil px-4 py-[10px] text-[13.5px] font-extrabold text-ink hover:bg-pencil-dark"
            >
              Pencil a Property
            </Link>
          </div>
        </nav>
      </header>

      <main className="flex flex-col">
        {/* hero */}
        <section className="mx-auto grid w-full max-w-[1180px] grid-cols-[repeat(auto-fit,minmax(340px,1fr))] items-center gap-12 px-8 pb-[72px] pt-16 max-md:px-5">
          <div className="flex flex-col gap-5">
            <h1 className="text-[68px] font-extrabold leading-[.98] tracking-[-.045em] max-md:text-[44px]">
              Does it pencil?
            </h1>
            <span className="block h-[6px] w-[152px] rounded-[3px] bg-pencil" />
            <p className="max-w-[52ch] text-[19px] leading-[1.55] text-body [text-wrap:pretty]">
              PropPencil turns any property into an investor-ready deal
              analysis. Enter an address and see what it is worth to you, what
              it will earn, what could go wrong, and the highest price you
              should pay.
            </p>
            <div className="mt-1">
              <AddressCta />
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <a
                href="#score"
                className="border-b border-accent/35 pb-[1px] text-[14px] font-bold text-accent hover:text-link-hover"
              >
                See an example analysis
              </a>
              <span className="text-[13px] text-label">
                No card required · free on public data
              </span>
            </div>
            <div className="mt-[6px] flex flex-wrap gap-[9px]">
              {SOURCE_CHIPS.map((chip) => (
                <span
                  key={chip}
                  className="rounded-[5px] border border-chip-on-border bg-chip-on px-[9px] py-1 text-[12px] font-semibold text-chip-on-text"
                >
                  {chip}
                </span>
              ))}
            </div>
          </div>

          {/* hero visual — a real analysis card built from app primitives.
              This vertical stack may keep the gap-1px hairline technique:
              it is a column flex and can never have an empty cell. */}
          <div className="flex flex-col gap-px overflow-hidden rounded-[12px] border border-border bg-border">
            <div className="flex flex-col gap-[14px] bg-card px-6 py-[22px]">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10.5px] font-bold uppercase tracking-[.14em] text-label">
                  1418 Vine St, Cincinnati
                </span>
                <span className="text-[11.5px] font-semibold text-label tabular-nums">
                  $118,000 ask
                </span>
              </div>
              <div className="flex flex-wrap items-end gap-4">
                <div className="flex flex-col gap-[6px]">
                  <div className="flex items-baseline gap-1">
                    <span className="text-[78px] font-extrabold leading-[.86] tracking-[-.05em] tabular-nums">
                      83
                    </span>
                    <span className="text-[20px] font-semibold text-label">/100</span>
                  </div>
                  <span className="block h-[5px] w-[83%] rounded-[3px] bg-pencil" />
                </div>
                <span className="whitespace-nowrap rounded-[7px] bg-[#0f6b44] px-[13px] py-[7px] text-[13.5px] font-extrabold text-white">
                  Fantastic Pencil
                </span>
              </div>
              <p className="text-[16px] font-bold leading-[1.45]">
                At $118,000, this property pencils.
              </p>
            </div>
            <div className="flex flex-col gap-[9px] bg-card px-6 py-[18px]">
              <span className="text-[10.5px] font-bold uppercase tracking-[.1em] text-label">
                What moved the score
              </span>
              {SCORE_PARTS.map(([label, width, value]) => (
                <div key={label} className="flex items-center gap-[10px]">
                  <span className="w-[112px] shrink-0 text-[12px] text-body">{label}</span>
                  <span className="h-[7px] flex-1 overflow-hidden rounded-[4px] bg-bar-track">
                    <span
                      className="block h-full bg-positive"
                      style={{ width: `${width}%` }}
                    />
                  </span>
                  <span className="w-[70px] text-right text-[11.5px] font-semibold text-body tabular-nums">
                    {value}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-end justify-between gap-5 bg-ink-panel px-6 py-[18px]">
              <div className="flex flex-col gap-[3px]">
                <span className="text-[10.5px] font-bold uppercase tracking-[.1em] text-pencil">
                  Maximum buy price
                </span>
                <span className="text-[28px] font-extrabold tracking-[-.03em] text-pencil tabular-nums">
                  $156,500
                </span>
              </div>
              <span className="max-w-[26ch] text-[12.5px] leading-[1.5] text-on-dark-dim">
                $38,500 of headroom at a required 10% cash-on-cash return.
              </span>
            </div>
          </div>
        </section>

        {/* how it works */}
        <section id="how" className="scroll-mt-[76px] border-t border-border bg-sidebar">
          <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-[34px] px-8 py-16 max-md:px-5">
            <div className="flex max-w-[64ch] flex-col gap-3">
              <Eyebrow>How it works</Eyebrow>
              <h2 className="text-[40px] font-extrabold leading-[1.08] tracking-[-.035em] [text-wrap:pretty] max-md:text-[30px]">
                Stop guessing if a property is a good deal.
              </h2>
              <p className="max-w-[58ch] text-[17px] leading-[1.6] text-body [text-wrap:pretty]">
                PropPencil analyzes the numbers behind a property so you can
                see what it is worth, what it could earn, and whether the deal
                actually pencils. Every screen answers one question.
              </p>
            </div>
            {/* card grids: transparent container + real gap + border per
                card, never a painted 1px-gap slab */}
            <div className="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-[14px]">
              {HOW_CARDS.map(([num, title, body]) => (
                <div
                  key={num}
                  className="flex flex-col gap-[9px] rounded-[12px] border border-border bg-card p-6"
                >
                  <span className="self-start rounded-[5px] bg-pencil px-2 py-[3px] text-[12px] font-extrabold text-ink tabular-nums">
                    {num}
                  </span>
                  <h3 className="text-[17px] font-bold tracking-[-.02em]">{title}</h3>
                  <p className="text-[13.5px] leading-[1.6] text-label">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* pencil score */}
        <section id="score" className="scroll-mt-[76px] border-t border-border">
          <div className="mx-auto grid w-full max-w-[1180px] grid-cols-[repeat(auto-fit,minmax(320px,1fr))] items-start gap-11 px-8 py-16 max-md:px-5">
            <div className="flex flex-col gap-4">
              <Eyebrow>The Pencil Score</Eyebrow>
              <h2 className="text-[36px] font-extrabold leading-[1.12] tracking-[-.032em] [text-wrap:pretty] max-md:text-[28px]">
                One number, and the receipts behind it.
              </h2>
              <p className="max-w-[52ch] text-[16px] leading-[1.6] text-body [text-wrap:pretty]">
                Most tools hand you a wall of metrics and let you decide which
                ones matter. PropPencil weighs five of them — cash flow,
                cash-on-cash, cap rate, debt coverage, and price against
                investor value — into a single score from zero to a hundred,
                measured against the return <i>you</i> require.
              </p>
              <p className="max-w-[52ch] text-[16px] leading-[1.6] text-body [text-wrap:pretty]">
                It is never a black box. Every analysis shows what each part
                contributed and how many points it earned, so you can argue
                with the score instead of trusting it.
              </p>
              <div className="flex max-w-[56ch] gap-[11px] rounded-[8px] border border-[#f0dba8] border-l-4 border-l-warn bg-accent-tint px-4 py-[14px]">
                <p className="text-[13.5px] leading-[1.6] text-warn-ink">
                  A perfect 100 is close to unreachable by design. A score that
                  maxes out easily is not a score, it is flattery.
                </p>
              </div>
            </div>
            <div className="flex flex-col rounded-[12px] border border-border bg-card px-6 py-[22px]">
              <h3 className="mb-[6px] border-b border-ink pb-[10px] text-[15px] font-bold tracking-[-.015em]">
                Six ways a deal can land
              </h3>
              {TIER_ROWS.map(([label, range, bg, fg], i) => (
                <div
                  key={label}
                  className={`flex items-center justify-between gap-3 py-[11px] ${
                    i < TIER_ROWS.length - 1 ? "border-b border-rule" : ""
                  }`}
                >
                  <span
                    className="whitespace-nowrap rounded-[5px] px-[9px] py-[3px] text-[10.5px] font-bold uppercase tracking-[.05em]"
                    style={{ backgroundColor: bg, color: fg }}
                  >
                    {label}
                  </span>
                  <span className="text-[12.5px] font-semibold text-body tabular-nums">
                    {range}
                  </span>
                </div>
              ))}
              <p className="mt-[14px] text-[12.5px] leading-[1.6] text-label">
                Breaking even is not a goal. A deal that merely covers its own
                costs is rated Poor, because your money could be doing that in
                a savings account.
              </p>
            </div>
          </div>
        </section>

        {/* max buy price */}
        <section id="price" className="scroll-mt-[76px] border-t border-border bg-sidebar">
          <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-7 px-8 py-16 max-md:px-5">
            <div className="flex max-w-[62ch] flex-col gap-3">
              <Eyebrow>Maximum buy price</Eyebrow>
              <h2 className="text-[40px] font-extrabold leading-[1.08] tracking-[-.035em] [text-wrap:pretty] max-md:text-[30px]">
                Know your walk-away number before you make the offer.
              </h2>
              <p className="max-w-[58ch] text-[17px] leading-[1.6] text-body [text-wrap:pretty]">
                Any calculator can tell you a property has a 7.1% cap rate.
                The question you actually need answered is what you should
                pay. Set the return you require and PropPencil solves
                backwards for the highest price that still delivers it.
              </p>
            </div>
            <div className="flex flex-col gap-5 rounded-[12px] bg-ink-panel px-8 py-[30px] max-md:px-5">
              <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-6">
                <div className="flex flex-col gap-[5px]">
                  <span className="text-[10.5px] font-bold uppercase tracking-[.1em] text-on-dark-dim">
                    Asking price
                  </span>
                  <span className="text-[34px] font-extrabold tracking-[-.032em] text-on-dark tabular-nums">
                    $118,000
                  </span>
                </div>
                <div className="flex flex-col gap-[5px]">
                  <span className="text-[10.5px] font-bold uppercase tracking-[.1em] text-pencil">
                    Maximum buy price
                  </span>
                  <span className="text-[34px] font-extrabold tracking-[-.032em] text-pencil tabular-nums">
                    $156,500
                  </span>
                </div>
                <div className="flex flex-col gap-[5px]">
                  <span className="text-[10.5px] font-bold uppercase tracking-[.1em] text-on-dark-dim">
                    Room below target
                  </span>
                  <span className="text-[34px] font-extrabold tracking-[-.032em] text-[#7ddba8] tabular-nums">
                    $38,500
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-[9px] border-t border-[#3a3a37] pt-5">
                <span className="text-[16px] font-bold text-on-dark">
                  Recommendation: the ask already works — move before someone
                  else pencils it.
                </span>
                <p className="max-w-[84ch] text-[14px] leading-[1.6] text-on-dark-dim">
                  Raise your required return and the maximum buy price drops
                  with it. Every number on the page — the score, the cash
                  flow, the verdict, the map pin — moves at the same time, so
                  you can find the price that makes a marginal deal work
                  instead of abandoning it.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* strategies */}
        <section id="strategies" className="scroll-mt-[76px] border-t border-border">
          <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-[30px] px-8 py-16 max-md:px-5">
            <div className="flex max-w-[62ch] flex-col gap-3">
              <Eyebrow>Three ways to run it</Eyebrow>
              <h2 className="text-[40px] font-extrabold leading-[1.08] tracking-[-.035em] [text-wrap:pretty] max-md:text-[30px]">
                The same house pays three different ways.
              </h2>
              <p className="max-w-[58ch] text-[17px] leading-[1.6] text-body [text-wrap:pretty]">
                A traditional lease, a Section 8 voucher and a short-term
                rental produce very different numbers on identical brick.
                PropPencil scores all three side by side, so the strategy
                decision stops being a hunch.
              </p>
            </div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-[14px]">
              {STRATEGY_CARDS.map((card) => (
                <div
                  key={card.name}
                  className="flex flex-col gap-[13px] rounded-[12px] border border-border bg-card p-6"
                >
                  <div className="flex flex-wrap items-baseline gap-[9px]">
                    <span className="text-[30px] font-extrabold leading-none tracking-[-.04em] tabular-nums">
                      {card.score}
                    </span>
                    <span
                      className="whitespace-nowrap rounded-[5px] px-[9px] py-[3px] text-[10.5px] font-bold uppercase tracking-[.05em] text-white"
                      style={{ backgroundColor: card.tierBg }}
                    >
                      {card.tier}
                    </span>
                  </div>
                  <h3 className="text-[17px] font-bold tracking-[-.02em]">{card.name}</h3>
                  <div className="flex flex-col gap-[6px]">
                    {card.rows.map(([label, value, positive]) => (
                      <div
                        key={label}
                        className="flex justify-between gap-[10px] text-[13px]"
                      >
                        <span className="text-label">{label}</span>
                        <span
                          className={`tabular-nums ${positive ? "font-bold text-positive" : "font-semibold"}`}
                        >
                          {value}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="border-t border-rule pt-[11px] text-[12.5px] leading-[1.55] text-label">
                    {card.note}
                  </p>
                </div>
              ))}
            </div>
            <p className="max-w-[88ch] text-[13.5px] leading-[1.6] text-label">
              The Section 8 analysis distinguishes Fair Market Rent from
              small-area FMR, applies your local payment standard, and
              separates the voucher portion from the tenant&apos;s share —
              because a Section 8 deal that works on paper still has to pass
              inspection.
            </p>
          </div>
        </section>

        {/* show your work + risks */}
        <section className="border-t border-border bg-sidebar">
          <div className="mx-auto grid w-full max-w-[1180px] grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-11 px-8 py-16 max-md:px-5">
            <div className="flex flex-col gap-4">
              <Eyebrow>Show your work</Eyebrow>
              <h2 className="text-[32px] font-extrabold leading-[1.12] tracking-[-.03em] [text-wrap:pretty] max-md:text-[26px]">
                Every number has a source, a confidence and a range.
              </h2>
              <p className="max-w-[50ch] text-[15.5px] leading-[1.6] text-body [text-wrap:pretty]">
                PropPencil estimates. It does not pretend to know the future.
                So each input tells you where it came from and how much to
                trust it, and the full net-operating-income arithmetic is one
                click away — no line item hidden behind a summary.
              </p>
              <div className="flex flex-col rounded-[10px] border border-border bg-card px-[18px] py-4">
                {NOI_ROWS.map(([label, value, bold, neg]) => (
                  <div
                    key={label}
                    className={`flex items-baseline justify-between gap-[14px] py-2 ${
                      bold ? "border-b border-ink" : "border-b border-rule"
                    }`}
                  >
                    <span className={`text-[13px] ${bold ? "font-bold" : "text-body"}`}>
                      {label}
                    </span>
                    <span
                      className={`text-[13.5px] tabular-nums ${bold ? "font-bold" : ""} ${neg ? "text-negative" : ""}`}
                    >
                      {value}
                    </span>
                  </div>
                ))}
                <div className="flex items-baseline justify-between gap-[14px] py-[10px]">
                  <span className="text-[13.5px] font-extrabold">Net operating income</span>
                  <span className="text-[16px] font-extrabold tabular-nums">$14,414</span>
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-4">
              <Eyebrow>What could break the pencil</Eyebrow>
              <h2 className="text-[32px] font-extrabold leading-[1.12] tracking-[-.03em] [text-wrap:pretty] max-md:text-[26px]">
                Risk you can actually act on.
              </h2>
              <p className="max-w-[50ch] text-[15.5px] leading-[1.6] text-body [text-wrap:pretty]">
                Instead of burying downside in a generic risk rating,
                PropPencil names the specific assumptions holding the deal up
                and tells you what happens if each one is wrong.
              </p>
              <div className="flex flex-col">
                {RISK_ITEMS.map(([title, body], i) => (
                  <div
                    key={title}
                    className={`flex gap-[11px] py-[13px] ${
                      i < RISK_ITEMS.length - 1 ? "border-b border-border" : ""
                    }`}
                  >
                    <span className="shrink-0 text-[13px] font-extrabold leading-[1.45] text-warn">
                      ⚠
                    </span>
                    <div className="flex flex-col gap-[2px]">
                      <span className="text-[14px] font-bold">{title}</span>
                      <span className="text-[13px] leading-[1.55] text-label">{body}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* pricing */}
        <section id="pricing" className="scroll-mt-[76px] border-t border-border">
          <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-[30px] px-8 py-16 max-md:px-5">
            <div className="flex max-w-[62ch] flex-col gap-3">
              <Eyebrow>Pricing</Eyebrow>
              <h2 className="text-[40px] font-extrabold leading-[1.08] tracking-[-.035em] [text-wrap:pretty] max-md:text-[30px]">
                Try one on us. Then it&apos;s $19 a month.
              </h2>
              <p className="max-w-[58ch] text-[17px] leading-[1.6] text-body [text-wrap:pretty]">
                Every pencil pulls live data — HUD rents, county taxes,
                comparable sales, short-term rental demand. Those lookups cost
                real money, so the pricing is simple: your first full analysis
                is free, and the Investor plan covers a serious month of deal
                hunting for less than one home inspection.
              </p>
            </div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-[14px] lg:max-w-[760px]">
              <div className="flex flex-col gap-[16px] rounded-[12px] border border-border bg-card p-7">
                <div className="flex flex-col gap-[4px]">
                  <h3 className="text-[17px] font-bold tracking-[-.02em]">Free</h3>
                  <div className="flex items-baseline gap-[6px]">
                    <span className="text-[38px] font-extrabold leading-none tracking-[-.04em]">$0</span>
                  </div>
                  <span className="text-[13px] text-label">
                    1 full analysis when you sign up
                  </span>
                </div>
                <ul className="flex flex-col gap-[9px] text-[13.5px] leading-[1.5] text-body">
                  <li className="flex gap-2">
                    <span className="font-extrabold text-positive">✓</span> The
                    complete pencil — score, max buy price, all three strategies
                  </li>
                  <li className="flex gap-2">
                    <span className="font-extrabold text-positive">✓</span> Saved
                    pencils and assumptions, synced to your account
                  </li>
                  <li className="flex gap-2">
                    <span className="font-extrabold text-positive">✓</span> No
                    card required
                  </li>
                </ul>
                <Link
                  href="/signup"
                  className="mt-auto rounded-[7px] border border-input-border bg-paper px-4 py-[11px] text-center text-[14px] font-bold text-ink hover:border-ink"
                >
                  Pencil one free
                </Link>
              </div>
              <div className="relative flex flex-col gap-[16px] rounded-[12px] border-2 border-ink bg-card p-7">
                <span className="absolute -top-[11px] left-6 rounded-[5px] bg-pencil px-[9px] py-[3px] text-[10.5px] font-bold uppercase tracking-[.05em] text-ink">
                  For deal hunters
                </span>
                <div className="flex flex-col gap-[4px]">
                  <h3 className="text-[17px] font-bold tracking-[-.02em]">Investor</h3>
                  <div className="flex items-baseline gap-[6px]">
                    <span className="text-[38px] font-extrabold leading-none tracking-[-.04em]">$19</span>
                    <span className="text-[14px] font-semibold text-label">/ month</span>
                  </div>
                  <span className="text-[13px] text-label">
                    100 pencils a month · about 19¢ each
                  </span>
                </div>
                <ul className="flex flex-col gap-[9px] text-[13.5px] leading-[1.5] text-body">
                  <li className="flex gap-2">
                    <span className="font-extrabold text-positive">✓</span>{" "}
                    Everything in Free, 100 times a month
                  </li>
                  <li className="flex gap-2">
                    <span className="font-extrabold text-positive">✓</span>{" "}
                    Live comparable sales, rent estimates and short-term rental
                    demand where available
                  </li>
                  <li className="flex gap-2">
                    <span className="font-extrabold text-positive">✓</span>{" "}
                    Offer-price solver, stress test and 5-year hold projection
                    on every pencil
                  </li>
                  <li className="flex gap-2">
                    <span className="font-extrabold text-positive">✓</span>{" "}
                    Cancel any time — your saved pencils stay
                  </li>
                </ul>
                <Link
                  href="/signup"
                  className="mt-auto rounded-[7px] bg-pencil px-4 py-[11px] text-center text-[14px] font-extrabold text-ink hover:bg-pencil-dark"
                >
                  Start with the free pencil
                </Link>
              </div>
            </div>
            <p className="max-w-[88ch] text-[13.5px] leading-[1.6] text-label">
              Why a limit at all? Each analysis fans out to paid data
              providers on your behalf. The Investor plan is priced to cover
              those calls with a little left over to keep the lights on — not
              to squeeze you. If you routinely need more than 100 pencils a
              month, get in touch and we&apos;ll work something out.
            </p>
          </div>
        </section>

        {/* closing CTA */}
        <section className="border-t border-border">
          <div className="mx-auto flex w-full max-w-[1180px] flex-col items-center gap-[22px] px-8 py-[72px] text-center max-md:px-5">
            <h2 className="max-w-[22ch] text-[48px] font-extrabold leading-[1.04] tracking-[-.04em] [text-wrap:pretty] max-md:text-[34px]">
              Before you buy, pencil it.
            </h2>
            <span className="block h-[5px] w-[132px] rounded-[3px] bg-pencil" />
            <p className="max-w-[52ch] text-[17px] leading-[1.6] text-body [text-wrap:pretty]">
              We do the math. You make the decision. Start with a single
              address and see the whole deal in about a minute.
            </p>
            <div className="mt-[6px] w-full max-w-[520px]">
              <AddressCta large />
            </div>
          </div>
        </section>
      </main>

      <footer className="mt-auto border-t border-border bg-ink-panel">
        <div className="mx-auto flex w-full max-w-[1180px] flex-wrap justify-between gap-8 px-8 py-10 max-md:px-5">
          <div className="flex max-w-[44ch] flex-col gap-3">
            <span className="flex items-center gap-[10px]">
              <AppMarkInverted size={28} />
              <span className="text-[17px] font-extrabold tracking-[-.03em] text-on-dark">
                PropPencil
              </span>
            </span>
            <p className="text-[12.5px] leading-[1.65] text-on-dark-dim">
              Estimates built from HUD Fair Market Rents, FEMA flood maps and
              the Census geocoder, plus county records and short-term rental
              data where configured. Verify rents with local comparable
              rentals, taxes with the county auditor and insurance with real
              quotes before making an offer. Not professional advice.
            </p>
          </div>
          <div className="flex flex-wrap gap-11">
            <div className="flex flex-col gap-[9px]">
              <span className="text-[10.5px] font-bold uppercase tracking-[.12em] text-disabled">
                Product
              </span>
              {NAV_LINKS.map(([href, label]) => (
                <a key={href} href={href} className="text-[13px] text-[#e8e5dd] hover:text-on-dark">
                  {label === "Max buy price" ? "Maximum buy price" : label}
                </a>
              ))}
            </div>
            <div className="flex flex-col gap-[9px]">
              <span className="text-[10.5px] font-bold uppercase tracking-[.12em] text-disabled">
                Account
              </span>
              <Link href="/login" className="text-[13px] text-[#e8e5dd] hover:text-on-dark">
                Log in
              </Link>
              <Link href="/app" className="text-[13px] text-[#e8e5dd] hover:text-on-dark">
                Pencil a Property
              </Link>
              <a href="#pricing" className="text-[13px] text-[#e8e5dd] hover:text-on-dark">
                Pricing
              </a>
              <Link href="/signup" className="text-[13px] text-[#e8e5dd] hover:text-on-dark">
                Create an account
              </Link>
            </div>
          </div>
        </div>
        <div className="mx-auto w-full max-w-[1180px] px-8 pb-8 max-md:px-5">
          <span className="text-[12px] text-disabled">© 2026 PropPencil</span>
        </div>
      </footer>
    </div>
  );
}
