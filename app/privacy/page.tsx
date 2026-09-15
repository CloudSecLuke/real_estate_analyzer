import type { Metadata } from "next";
import LegalPage from "@/components/marketing/LegalPage";

export const metadata: Metadata = {
  title: "Privacy Policy — PropPencil",
  description: "What PropPencil collects, why, and how to remove it.",
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="September 15, 2026">
      <p>
        This policy describes what PropPencil collects, what it is used
        for, and your choices. The short version: we collect the minimum
        needed to run the product, we never see your card number, and we
        do not sell your data.
      </p>

      <h2>1. What we collect</h2>
      <ul>
        <li>
          <b>Account data</b> — your username, a salted hash of your
          password (never the password itself), and an optional email
          address used for receipts and account recovery.
        </li>
        <li>
          <b>Usage data</b> — the property addresses you analyze, your
          saved pencils, assumptions and search history, so they follow
          your account across devices.
        </li>
        <li>
          <b>Billing data</b> — handled entirely by Stripe. We store only
          your Stripe customer ID and subscription status. Card numbers
          never touch our servers.
        </li>
        <li>
          <b>Technical data</b> — server logs (IP addresses, timestamps)
          for security and rate limiting. Rate-limit records store a
          one-way hash of your IP, not the IP itself.
        </li>
      </ul>

      <h2>2. What we do with it</h2>
      <ul>
        <li>Run the product: analyses, saved state, plan limits.</li>
        <li>Process subscriptions and send billing receipts (via Stripe).</li>
        <li>Prevent abuse (rate limiting, duplicate-account detection).</li>
      </ul>
      <p>
        We do <b>not</b> sell or rent your personal information, and we do
        not use third-party advertising or cross-site tracking. The only
        cookie we set is the session cookie that keeps you signed in.
      </p>

      <h2>3. Who else sees data</h2>
      <ul>
        <li>
          <b>Stripe</b> — payment processing (your email, if provided, and
          payment details you enter on Stripe&apos;s pages).
        </li>
        <li>
          <b>Vercel</b> (hosting) and <b>Neon</b> (database) — our
          infrastructure providers, which process data on our behalf.
        </li>
        <li>
          <b>Data providers</b> — the address you analyze is sent to the
          sources that price it (U.S. Census geocoder, HUD, BLS, FEMA,
          and, where configured, ATTOM and Mashvisor). It is not linked to
          your identity in those requests.
        </li>
        <li>
          Authorities, if legally required.
        </li>
      </ul>

      <h2>4. Retention and deletion</h2>
      <p>
        Account and usage data are kept while your account exists. To
        delete your account and its data, email{" "}
        <a href="mailto:luke.f.miller.8@gmail.com">luke.f.miller.8@gmail.com</a>{" "}
        from your account email (or include your username) and we will
        remove it within 30 days, subject to records we must keep for tax
        and billing compliance.
      </p>

      <h2>5. Security</h2>
      <p>
        Passwords are hashed with scrypt; sessions use signed, httpOnly,
        secure cookies; all traffic is encrypted in transit. No system is
        perfectly secure — use a password you don&apos;t reuse elsewhere.
      </p>

      <h2>6. Changes and contact</h2>
      <p>
        Material changes to this policy will be noted here with a new
        date. Questions:{" "}
        <a href="mailto:luke.f.miller.8@gmail.com">luke.f.miller.8@gmail.com</a>
      </p>
    </LegalPage>
  );
}
