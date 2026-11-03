"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

const COOKIE = "cx_ccy";

/** A small PKR | USD toggle: which currency prices are shown in first. Remembered for a year (cookie). */
export function CurrencySwitch({ current }: { current: "PKR" | "USD" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const pick = (c: "PKR" | "USD") => {
    if (c === current) return;
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${COOKIE}=${c}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
    try {
      localStorage.setItem(COOKIE, c);
    } catch {
      /* the cookie is the source of truth; storage may be blocked */
    }
    start(() => router.refresh());
  };
  return (
    <div className={`ccy${pending ? " is-busy" : ""}`} role="group" aria-label="Show prices in" data-on={current}>
      <span className="ccy-thumb" aria-hidden="true" />
      {(["PKR", "USD"] as const).map((c) => (
        <button key={c} type="button" aria-pressed={c === current} className={c === current ? "on" : ""} onClick={() => pick(c)}>
          {c}
        </button>
      ))}
    </div>
  );
}
