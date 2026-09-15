import Link from "next/link";
import { AppMark } from "@/components/PencilMark";

// Shared shell for /terms and /privacy — landing-page typography, one
// readable column, no app chrome.
export default function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border">
        <nav className="mx-auto flex w-full max-w-[820px] items-center justify-between px-6 py-[14px]">
          <Link href="/" className="flex items-center gap-[10px]">
            <AppMark />
            <span className="text-[17px] font-extrabold tracking-[-.032em] text-ink">
              PropPencil
            </span>
          </Link>
          <Link
            href="/"
            className="text-[13.5px] font-semibold text-body hover:text-ink"
          >
            ← Back to PropPencil
          </Link>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-[820px] flex-1 px-6 pb-20 pt-12">
        <h1 className="text-[38px] font-extrabold leading-[1.08] tracking-[-.035em]">
          {title}
        </h1>
        <p className="mt-2 text-[13px] text-label">Last updated: {updated}</p>
        <div className="legal-prose mt-8 flex flex-col gap-5 text-[15px] leading-[1.7] text-body [&_h2]:mt-4 [&_h2]:text-[20px] [&_h2]:font-extrabold [&_h2]:tracking-[-.02em] [&_h2]:text-ink [&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-2 [&_ul]:pl-5 [&_a]:font-semibold [&_a]:text-accent">
          {children}
        </div>
      </main>
      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-[820px] flex-wrap gap-5 px-6 py-6 text-[13px] text-label">
          <span>© 2026 PropPencil</span>
          <Link href="/terms" className="hover:text-ink">Terms</Link>
          <Link href="/privacy" className="hover:text-ink">Privacy</Link>
        </div>
      </footer>
    </div>
  );
}
