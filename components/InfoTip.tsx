"use client";

// The redesign's "?" marker: a 13px circle with a native title tooltip.
export default function InfoTip({ text }: { text: string }) {
  return (
    <span
      title={text}
      aria-label={text}
      className="inline-flex h-[13px] w-[13px] shrink-0 cursor-help items-center justify-center rounded-full border border-marker-border align-middle text-[9px] tracking-normal text-label ml-1"
    >
      ?
    </span>
  );
}
