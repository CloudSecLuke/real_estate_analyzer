"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// The landing page's only client JS: an address form that funnels into
// the app with the address prefilled. Unauthenticated visitors bounce
// through /login (the proxy preserves the destination in `next`) and land
// in /app with the address already penciling.
export default function AddressCta({ large = false }: { large?: boolean }) {
  const router = useRouter();
  const [address, setAddress] = useState("");

  function go(e: React.FormEvent) {
    e.preventDefault();
    const target = address.trim()
      ? `/app?address=${encodeURIComponent(address.trim())}`
      : "/app";
    router.push(target);
  }

  return (
    <form
      onSubmit={go}
      className={`flex w-full flex-wrap items-center gap-[10px] ${large ? "max-w-[520px] justify-center" : ""}`}
    >
      <input
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        placeholder="123 Main St, Cincinnati, OH"
        aria-label="Property address"
        className="min-w-[230px] flex-1 rounded-[8px] border border-input-border bg-card px-[15px] py-[14px] text-[15px] text-ink outline-none focus:border-ink focus:shadow-[0_0_0_3px_rgba(244,197,66,.45)]"
      />
      <button
        type="submit"
        className="cursor-pointer whitespace-nowrap rounded-[8px] bg-pencil px-6 py-[14px] text-[15px] font-extrabold text-ink hover:bg-pencil-dark"
      >
        Pencil It
      </button>
    </form>
  );
}
