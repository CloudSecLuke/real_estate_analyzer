import type { Metadata } from "next";
import LegalPage from "@/components/marketing/LegalPage";

export const metadata: Metadata = {
  title: "Terms of Service — PropPencil",
  description: "The terms that govern your use of PropPencil.",
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="September 15, 2026">
      <p>
        PropPencil (&quot;the Service&quot;) is a rental-property analysis
        tool operated by PropPencil (&quot;we&quot;, &quot;us&quot;). By
        creating an account or using the Service you agree to these terms.
        If you do not agree, do not use the Service.
      </p>

      <h2>1. What the Service is — and is not</h2>
      <p>
        PropPencil produces <b>estimates</b> built from public and licensed
        data sources: modeled rents, taxes, expenses, cash flows, scores and
        suggested prices. These are informational starting points, not
        statements of fact about any property.
      </p>
      <p>
        <b>PropPencil is not professional advice.</b> We are not a licensed
        real-estate broker, appraiser, lender, accountant, attorney or
        investment advisor, and nothing in the Service is a recommendation
        to buy, sell, rent or finance any property. Verify every number
        that matters — rents with local comparables, taxes with the county,
        insurance with real quotes — before making an offer. Decisions you
        make, and their outcomes, are yours alone.
      </p>

      <h2>2. Accounts</h2>
      <ul>
        <li>
          You are responsible for your account credentials and for all
          activity under your account. Choose a strong password.
        </li>
        <li>
          One account per person. Accounts created to farm free analyses
          may be removed.
        </li>
        <li>
          We may suspend or terminate accounts that violate these terms or
          abuse the Service (including automated scraping, resale of data,
          or attempts to circumvent limits).
        </li>
      </ul>

      <h2>3. Plans and billing</h2>
      <ul>
        <li>
          New accounts include <b>one free property analysis</b>. The{" "}
          <b>Investor plan ($19/month)</b> includes 100 analyses per
          monthly billing period; unused analyses do not roll over.
        </li>
        <li>
          Payments are processed by <b>Stripe</b>. We never see or store
          your card number. Subscriptions renew automatically each month
          until cancelled.
        </li>
        <li>
          Cancel any time from the billing portal; your plan stays active
          until the end of the paid period, and your saved data remains on
          the free tier afterward. Except where required by law, payments
          already made are not refunded.
        </li>
        <li>
          We may change pricing with at least 14 days&apos; notice; changes
          apply from your next billing period.
        </li>
      </ul>

      <h2>4. Acceptable use</h2>
      <ul>
        <li>No scraping, bulk-extracting or reselling data from the Service.</li>
        <li>
          No attempts to bypass authentication, rate limits, plan limits or
          other technical controls.
        </li>
        <li>
          No use of the Service to violate any law, including fair-housing
          laws.
        </li>
      </ul>

      <h2>5. Data sources</h2>
      <p>
        Analyses draw on third-party sources (including HUD, the U.S.
        Census Bureau, BLS, FRED, FEMA, ATTOM and Mashvisor). Those sources
        can be incomplete, delayed or wrong, and their availability may
        change. We surface a confidence rating with each analysis but make
        no warranty about the accuracy or availability of any data.
      </p>

      <h2>6. Disclaimers and limitation of liability</h2>
      <p>
        The Service is provided <b>&quot;as is&quot;</b> without warranties
        of any kind, express or implied. To the fullest extent permitted by
        law, our total liability for any claim arising out of the Service
        is limited to the amount you paid us in the three months before the
        claim arose. We are not liable for indirect, incidental or
        consequential damages, including lost profits or losses on real
        estate transactions.
      </p>

      <h2>7. Changes</h2>
      <p>
        We may update these terms; material changes will be noted on this
        page with a new date. Continuing to use the Service after a change
        means you accept the updated terms.
      </p>

      <h2>8. Contact</h2>
      <p>
        Questions:{" "}
        <a href="mailto:luke.f.miller.8@gmail.com">luke.f.miller.8@gmail.com</a>
      </p>
    </LegalPage>
  );
}
