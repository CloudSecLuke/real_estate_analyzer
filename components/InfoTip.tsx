"use client";

// Hoverable "?" badge that explains a finance term in plain language.
export default function InfoTip({ text }: { text: string }) {
  return (
    <span className="group relative inline-block align-middle ml-1">
      <span
        tabIndex={0}
        className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-zinc-400 dark:border-zinc-500 text-[10px] leading-none text-zinc-500 dark:text-zinc-400 cursor-help select-none"
        aria-label={text}
      >
        ?
      </span>
      <span className="pointer-events-none absolute left-1/2 bottom-full z-20 mb-1.5 hidden w-64 -translate-x-1/2 rounded-md bg-zinc-900 px-3 py-2 text-left text-xs font-normal normal-case text-zinc-100 shadow-lg group-hover:block group-focus-within:block dark:bg-zinc-100 dark:text-zinc-900">
        {text}
      </span>
    </span>
  );
}
