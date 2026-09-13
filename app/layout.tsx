import type { Metadata } from "next";
import { Newsreader, Fira_Sans } from "next/font/google";
import "./globals.css";

// Newsreader carries everything a human reads or cares about (headings,
// verdict prose, money figures); Fira Sans carries the UI (labels, inputs,
// tables, captions).
const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
});

const firaSans = Fira_Sans({
  variable: "--font-fira-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Rental Cash Flow Analyzer",
  description:
    "Analyze rental properties for monthly cash flow — market-rate, Section 8 and short-term — using HUD, FEMA, Census, ATTOM and Mashvisor data.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${newsreader.variable} ${firaSans.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
