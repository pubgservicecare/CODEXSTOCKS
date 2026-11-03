"use client";

import { useEffect, useRef, useState } from "react";
import { Glyph } from "./glyph";

const CURRENCIES: [string, string][] = [["", "Any"], ["PKR", "PKR"], ["USD", "USD"]];
const SORTS: [string, string][] = [["", "Newest"], ["price_asc", "Price ↑"], ["price_desc", "Price ↓"]];

/**
 * Listing-currency and sort controls. On wide screens they sit inline and apply instantly; on phones the same
 * controls live in a bottom sheet opened by the "Filters" button. They belong to the inventory form (form=…),
 * so without JavaScript they still work through the Search button.
 */
export function FilterSheet({ form, currency, sort, active }: { form: string; currency: string; sort: string; active: number }) {
  const [open, setOpen] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", esc);
    sheet.current?.querySelector<HTMLInputElement>("input:checked")?.focus();
    return () => window.removeEventListener("keydown", esc);
  }, [open]);
  const instant = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (window.matchMedia("(min-width: 861px)").matches) e.currentTarget.form?.requestSubmit();
  };
  const group = (name: string, label: string, options: [string, string][], value: string) => (
    <fieldset className="chips">
      <legend>{label}</legend>
      {options.map(([v, text]) => (
        <label key={v || "any"} className="chip">
          <input type="radio" name={name} value={v} defaultChecked={value === v} form={form} onChange={instant} />
          <span>{text}</span>
        </label>
      ))}
    </fieldset>
  );
  return (
    <>
      <button type="button" className="btn btn-ghost filter-open" onClick={() => setOpen(true)} aria-expanded={open} aria-controls="filter-sheet">
        <Glyph name="filter" /> Filters{active ? <b className="filter-count">{active}</b> : null}
      </button>
      {open && <div className="sheet-back" onClick={() => setOpen(false)} aria-hidden="true" />}
      <div className={`filter-sheet${open ? " is-open" : ""}`} id="filter-sheet" ref={sheet} role="group" aria-label="Filters">
        <div className="sheet-head">
          <b>Filters</b>
          <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close filters"><Glyph name="close" /></button>
        </div>
        {group("currency", "Listed in", CURRENCIES, currency)}
        {group("sort", "Sort by", SORTS, sort)}
        <button className="btn btn-red btn-block sheet-apply" type="submit" form={form}>Show results</button>
      </div>
    </>
  );
}
