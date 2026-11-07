import {
  formatDay,
  formatRate,
  receiptMoney,
  type BusinessContact,
  type PaymentReceiptData,
  type PayCurrency,
  type PlanReceiptData,
} from "@codex/shared";
import logoMod from "../../assets/brand/receipt-logo.webp";
import { assetUrl } from "../art";
import "./receipt-fonts.css";

/**
 * Draws a receipt snapshot as a high-resolution PNG (Canvas 2D, no server, works offline in the desktop app).
 * The layout is the owner's blue-and-white payment plan sheet: white page, thin blue border, blue rounded
 * title bar, blue/white table, light-blue summary boxes, green confirmations, English with Urdu (Nastaliq).
 * Only data from the stored snapshot is drawn.
 */

const W = 1080;
const PAD = 60;
const INNER = W - PAD * 2;
const SCALE = 2;
const LATIN = '"Inter Var", "Segoe UI", Arial, sans-serif';
const URDU = '"Noto Nastaliq Urdu", "Urdu Typesetting", "Jameel Noori Nastaleeq", serif';
const C = {
  blue: "#1d4ed8",
  navy: "#1e3a8a",
  sky: "#eaf1fe",
  sky2: "#f4f8ff",
  line: "#c9d8f6",
  ink: "#0f172a",
  muted: "#475569",
  faint: "#94a3b8",
  green: "#15803d",
  greenBg: "#dcfce7",
  amber: "#a16207",
  amberBg: "#fef3c7",
  red: "#b91c1c",
  redBg: "#fee2e2",
  white: "#ffffff",
};

export const RECEIPT_LOGO = assetUrl(logoMod);

interface TextOpts {
  size: number;
  weight?: number;
  color?: string;
  align?: CanvasTextAlign;
  urdu?: boolean;
}

/** Measures in a first pass (draw = false) and paints in the second, so the page is exactly as tall as its content. */
class Painter {
  y = 0;
  constructor(
    readonly ctx: CanvasRenderingContext2D,
    readonly draw: boolean,
  ) {}

  font(o: TextOpts) {
    this.ctx.font = `${o.weight ?? 400} ${o.size}px ${o.urdu ? URDU : LATIN}`;
  }
  width(s: string, o: TextOpts) {
    this.font(o);
    return this.ctx.measureText(s).width;
  }
  text(s: string, x: number, y: number, o: TextOpts) {
    if (!this.draw || !s) return;
    const c = this.ctx;
    this.font(o);
    c.fillStyle = o.color ?? C.ink;
    c.direction = o.urdu ? "rtl" : "ltr";
    c.textAlign = o.align ?? (o.urdu ? "right" : "left");
    c.textBaseline = "alphabetic";
    c.fillText(s, x, y);
    c.direction = "ltr";
  }
  /** Greedy word wrap. */
  wrap(s: string, maxW: number, o: TextOpts): string[] {
    const words = (s ?? "").split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (this.width(next, o) <= maxW || !cur) cur = next;
      else {
        lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
    // A single very long word: cut it.
    return lines.flatMap((l) => {
      if (this.width(l, o) <= maxW) return [l];
      const out: string[] = [];
      let part = "";
      for (const ch of l) {
        if (this.width(part + ch, o) > maxW && part) {
          out.push(part);
          part = ch;
        } else part += ch;
      }
      if (part) out.push(part);
      return out;
    });
  }
  rect(x: number, y: number, w: number, h: number, o: { fill?: string; stroke?: string; r?: number; lw?: number }) {
    if (!this.draw) return;
    const c = this.ctx;
    c.beginPath();
    if (o.r) c.roundRect(x, y, w, h, o.r);
    else c.rect(x, y, w, h);
    if (o.fill) {
      c.fillStyle = o.fill;
      c.fill();
    }
    if (o.stroke) {
      c.strokeStyle = o.stroke;
      c.lineWidth = o.lw ?? 1;
      c.stroke();
    }
  }
  line(x1: number, y1: number, x2: number, y2: number, color = C.line, lw = 1) {
    if (!this.draw) return;
    const c = this.ctx;
    c.beginPath();
    c.moveTo(x1, y1);
    c.lineTo(x2, y2);
    c.strokeStyle = color;
    c.lineWidth = lw;
    c.stroke();
  }
  image(img: CanvasImageSource | null, x: number, y: number, w: number, h: number) {
    if (this.draw && img) this.ctx.drawImage(img, x, y, w, h);
  }
  /** Small rounded label: "✓ Advance Confirmed". Returns its width. */
  pill(s: string, xRight: number, yMid: number, fg: string, bg: string): number {
    const o = { size: 16, weight: 700 };
    const w = this.width(s, o) + 28;
    this.rect(xRight - w, yMid - 17, w, 34, { fill: bg, r: 17 });
    this.text(s, xRight - w / 2, yMid + 6, { ...o, color: fg, align: "center" });
    return w;
  }
  check(x: number, y: number, size: number, color = C.green) {
    if (!this.draw) return;
    const c = this.ctx;
    c.beginPath();
    c.moveTo(x, y + size * 0.55);
    c.lineTo(x + size * 0.38, y + size * 0.9);
    c.lineTo(x + size, y + size * 0.1);
    c.strokeStyle = color;
    c.lineWidth = Math.max(2, size / 6);
    c.lineCap = "round";
    c.lineJoin = "round";
    c.stroke();
  }
}

const m = (minor: number, c: PayCurrency) => receiptMoney(minor, c);

/** "TOTAL 60K" from the ORIGINAL account price (not the grand total). */
export function compactTotal(minor: number, currency: PayCurrency): string {
  const major = minor / 100;
  const trim = (v: number) => (Math.round(v * 100) / 100).toString();
  const n = major >= 1_000_000 ? `${trim(major / 1_000_000)}M` : major >= 1_000 ? `${trim(major / 1_000)}K` : trim(major);
  return currency === "PKR" ? n : currency === "USD" ? `$${n}` : `${n} USDT`;
}

function shortRange(from: string | null, to: string): string {
  if (!from) return formatDay(to);
  const [fd, fm, fy] = formatDay(from).split(" ");
  const [td, tm, ty] = formatDay(to).split(" ");
  if (fy === ty && fm === tm) return `${fd}–${td} ${tm} ${ty}`;
  if (fy === ty) return `${fd} ${fm} – ${td} ${tm} ${ty}`;
  return `${formatDay(from)} – ${formatDay(to)}`;
}

/* ------------------------------------------------------------------ */
/* shared blocks                                                       */
/* ------------------------------------------------------------------ */

function header(p: Painter, logo: CanvasImageSource | null, b: BusinessContact, right: [string, string, string, string]) {
  const y0 = p.y;
  const lh = 104;
  p.image(logo, PAD, y0, Math.round((lh * 509) / 614), lh);
  const x = PAD + Math.round((lh * 509) / 614) + 22;
  p.text(b.business_name, x, y0 + 46, { size: 32, weight: 800, color: C.ink });
  const sub = [b.website, b.whatsapp ? `WhatsApp ${b.whatsapp}` : null].filter(Boolean).join("  ·  ");
  if (sub) p.text(sub, x, y0 + 76, { size: 16, color: C.muted });
  p.text(right[0], W - PAD, y0 + 18, { size: 14, weight: 600, color: C.faint, align: "right" });
  p.text(right[1], W - PAD, y0 + 44, { size: 20, weight: 800, color: C.navy, align: "right" });
  p.text(right[2], W - PAD, y0 + 70, { size: 15, color: C.muted, align: "right" });
  p.text(right[3], W - PAD, y0 + 94, { size: 15, color: C.muted, align: "right" });
  p.y = y0 + lh + 24;
}

function titleBar(p: Painter, en: string, ur: string, color = C.blue) {
  const h = 76;
  p.rect(PAD, p.y, INNER, h, { fill: color, r: 18 });
  p.text(en, PAD + 30, p.y + 49, { size: 30, weight: 800, color: C.white });
  p.text(ur, W - PAD - 30, p.y + 52, { size: 26, urdu: true, color: C.white });
  p.y += h + 24;
}

function sectionTitle(p: Painter, en: string, ur: string) {
  p.text(en, PAD, p.y + 26, { size: 20, weight: 800, color: C.navy });
  p.text(ur, W - PAD, p.y + 30, { size: 21, urdu: true, color: C.navy });
  p.y += 46;
  p.line(PAD, p.y - 8, W - PAD, p.y - 8, C.line, 2);
}

/** Two columns of label / value pairs. */
function keyValues(p: Painter, rows: [string, string][]) {
  const colW = (INNER - 30) / 2;
  const lab = { size: 15, weight: 600, color: C.muted };
  const val = { size: 16, weight: 700, color: C.ink };
  for (let i = 0; i < rows.length; i += 2) {
    const pair = rows.slice(i, i + 2);
    let h = 0;
    pair.forEach(([k, v], j) => {
      const x = PAD + j * (colW + 30);
      const lines = p.wrap(v, colW - 190, val);
      const labLines = p.wrap(k, 176, lab);
      labLines.forEach((l, li) => p.text(l, x, p.y + 24 + li * 22, lab));
      lines.forEach((l, li) => p.text(l, x + 190, p.y + 24 + li * 24, val));
      h = Math.max(h, 12 + lines.length * 24, 14 + labLines.length * 22);
    });
    p.y += h + 8;
    p.line(PAD, p.y, W - PAD, p.y, "#e5edfb");
  }
  p.y += 18;
}

function contact(p: Painter, b: BusinessContact) {
  const rows: [string, string][] = [];
  rows.push(["Business", b.business_name]);
  if (b.owner) rows.push(["Contact person", b.owner]);
  if (b.phone) rows.push(["Phone", b.phone]);
  if (b.whatsapp) rows.push(["WhatsApp", b.whatsapp]);
  if (b.email) rows.push(["Email", b.email]);
  if (b.website) rows.push(["Website", b.website]);
  if (b.address) rows.push(["Address", b.address]);
  if (b.hours) rows.push(["Business hours", b.hours]);
  b.social.forEach((s, i) => rows.push([i === 0 ? "Social" : "", s]));
  if (b.other) rows.push(["Other", b.other]);
  sectionTitle(p, "Contact", "رابطہ");
  keyValues(p, rows);
}

function footer(p: Painter, s: string) {
  p.line(PAD, p.y, W - PAD, p.y, C.line, 1);
  const lines = p.wrap(s, INNER, { size: 13, color: C.faint });
  lines.forEach((l, i) => p.text(l, W / 2, p.y + 26 + i * 20, { size: 13, color: C.faint, align: "center" }));
  p.y += 26 + lines.length * 20 + 30;
}

function border(p: Painter, h: number) {
  p.rect(0, 0, W, h, { fill: C.white });
  p.rect(22, 22, W - 44, h - 44, { stroke: C.blue, lw: 2.5, r: 14 });
}

/* ------------------------------------------------------------------ */
/* Payment Plan                                                        */
/* ------------------------------------------------------------------ */

function drawPlan(p: Painter, d: PlanReceiptData, logo: CanvasImageSource | null) {
  const c = d.currency;
  p.y = 54;
  header(p, logo, d.business, ["RECEIPT NO.", d.receipt_no, `Issued ${formatDay(d.issued_on)}`, `Plan ${d.plan.ref} · Revision ${d.revision}`]);
  titleBar(p, `PAYMENT PLAN — TOTAL ${compactTotal(d.plan.original, c)}`, "قسطوں کا پلان");

  // Customer | Account
  const boxW = (INNER - 20) / 2;
  const nameLines = p.wrap(d.customer.name, boxW - 40, { size: 22, weight: 800 });
  const titleLines = p.wrap(d.account.title, boxW - 40, { size: 20, weight: 800 }).slice(0, 3);
  const custExtra = [d.customer.phone ? `Phone ${d.customer.phone}` : null, d.customer.whatsapp ? `WhatsApp ${d.customer.whatsapp}` : null].filter(Boolean) as string[];
  const acctExtra = [d.account.ref ? `Reference ${d.account.ref}` : null, d.plan.agreement_ref ? `Agreement ${d.plan.agreement_ref}` : null].filter(Boolean) as string[];
  const boxH = 58 + Math.max(nameLines.length * 30 + custExtra.length * 24, titleLines.length * 28 + acctExtra.length * 24) + 16;
  const boxes: [string, string, string[], TextOpts, string[]][] = [
    ["CUSTOMER", "گاہک", nameLines, { size: 22, weight: 800 }, custExtra],
    ["ACCOUNT", "اکاؤنٹ", titleLines, { size: 20, weight: 800 }, acctExtra],
  ];
  boxes.forEach(([en, ur, lines, o, extra], i) => {
    const x = PAD + i * (boxW + 20);
    p.rect(x, p.y, boxW, boxH, { fill: C.sky2, stroke: C.line, r: 14 });
    p.text(en, x + 20, p.y + 32, { size: 14, weight: 800, color: C.blue });
    p.text(ur, x + boxW - 20, p.y + 36, { size: 18, urdu: true, color: C.blue });
    let yy = p.y + 66;
    lines.forEach((l) => {
      p.text(l, x + 20, yy, { ...o, color: C.ink });
      yy += o.size + 8;
    });
    extra.forEach((l) => {
      p.text(l, x + 20, yy + 2, { size: 16, color: C.muted });
      yy += 24;
    });
  });
  p.y += boxH + 18;

  // Advance
  const advH = 70;
  p.rect(PAD, p.y, INNER, advH, { fill: C.sky, r: 14 });
  p.text("ADVANCE", PAD + 22, p.y + 30, { size: 13, weight: 800, color: C.blue });
  p.text("ایڈوانس", PAD + 22 + p.width("ADVANCE", { size: 13, weight: 800 }) + 70, p.y + 33, { size: 17, urdu: true, color: C.blue });
  if (d.plan.advance > 0) {
    p.text(`${m(d.plan.advance, c)}`, PAD + 22, p.y + 56, { size: 22, weight: 800 });
    const due = d.plan.advance_due_on ? `  ·  due ${formatDay(d.plan.advance_due_on)}` : "";
    p.text(due, PAD + 22 + p.width(m(d.plan.advance, c), { size: 22, weight: 800 }), p.y + 56, { size: 16, color: C.muted });
    if (d.plan.advance_paid) p.pill(`✓ Advance Confirmed${d.plan.advance_paid_on ? ` · ${formatDay(d.plan.advance_paid_on)}` : ""}`, W - PAD - 18, p.y + advH / 2, C.green, C.greenBg);
    else p.pill("Advance pending", W - PAD - 18, p.y + advH / 2, C.amber, C.amberBg);
  } else p.text("No advance on this plan", PAD + 22, p.y + 56, { size: 18, weight: 600, color: C.muted });
  p.y += advH + 24;

  // Schedule table
  const cols: { en: string; ur: string; w: number; align: CanvasTextAlign }[] = [
    { en: d.plan.interval_days && d.plan.interval_days >= 28 && d.plan.interval_days <= 31 ? "Month" : "Qist", ur: "مہینہ / قسط", w: 150, align: "left" },
    { en: "Date Range", ur: "تاریخ", w: 262, align: "left" },
    { en: "Monthly Qist", ur: "ماہانہ قسط", w: 190, align: "right" },
    { en: "Daily Extra", ur: "ڈیلی ایکسٹرا", w: 182, align: "right" },
    { en: "Total", ur: "کل", w: INNER - 150 - 262 - 190 - 182, align: "right" },
  ];
  const colX = (i: number) => PAD + cols.slice(0, i).reduce((a, x) => a + x.w, 0);
  const cellX = (i: number) => (cols[i].align === "right" ? colX(i) + cols[i].w - 16 : colX(i) + 16);
  const headH = 84;
  p.rect(PAD, p.y, INNER, headH, { fill: C.blue, r: 14 });
  p.rect(PAD, p.y + headH - 14, INNER, 14, { fill: C.blue });
  cols.forEach((col, i) => {
    p.text(col.en, cellX(i), p.y + 34, { size: 17, weight: 800, color: C.white, align: col.align });
    p.text(col.ur, col.align === "right" ? cellX(i) : colX(i) + col.w - 16, p.y + 68, { size: 17, urdu: true, color: "#dbe7ff" });
  });
  p.y += headH;
  const rowH = 60;
  d.rows.forEach((r, i) => {
    p.rect(PAD, p.y, INNER, rowH, { fill: i % 2 ? C.white : C.sky2 });
    const paid = r.status === "paid";
    p.text(r.label, cellX(0), p.y + 37, { size: 17, weight: 700 });
    if (paid) p.check(colX(0) + cols[0].w - 34, p.y + 20, 18);
    p.text(shortRange(r.from, r.to), cellX(1), p.y + 30, { size: 16, weight: 600 });
    p.text(`Due ${formatDay(r.to)}`, cellX(1), p.y + 50, { size: 13, color: C.muted });
    p.text(m(r.principal, c), cellX(2), p.y + 37, { size: 17, weight: 600, align: "right" });
    if (r.free) {
      p.text("0 / Maaf", cellX(3), p.y + 31, { size: 17, weight: 800, color: C.green, align: "right" });
      p.text("معاف", cellX(3), p.y + 54, { size: 15, urdu: true, color: C.green, align: "right" });
    } else if (r.extra > 0) {
      p.text(m(r.extra, c), cellX(3), p.y + 31, { size: 17, weight: 600, align: "right" });
      p.text(`${r.extra_days} day${r.extra_days === 1 ? "" : "s"}`, cellX(3), p.y + 51, { size: 13, color: C.muted, align: "right" });
    } else p.text("—", cellX(3), p.y + 37, { size: 17, color: C.faint, align: "right" });
    p.text(m(r.total, c), cellX(4), p.y + 37, { size: 18, weight: 800, color: C.navy, align: "right" });
    p.line(PAD, p.y + rowH, W - PAD, p.y + rowH, "#e2eafb");
    p.y += rowH;
  });
  const sum = (f: (r: (typeof d.rows)[number]) => number) => d.rows.reduce((a, r) => a + f(r), 0);
  p.rect(PAD, p.y, INNER, rowH, { fill: C.sky });
  p.line(PAD, p.y, W - PAD, p.y, C.blue, 2);
  p.text(`${d.rows.length} installment${d.rows.length === 1 ? "" : "s"}`, cellX(0), p.y + 37, { size: 16, weight: 800, color: C.navy });
  p.text(m(sum((r) => r.principal), c), cellX(2), p.y + 37, { size: 17, weight: 800, align: "right" });
  p.text(m(sum((r) => r.extra), c), cellX(3), p.y + 37, { size: 17, weight: 800, align: "right" });
  p.text(m(sum((r) => r.total), c), cellX(4), p.y + 37, { size: 18, weight: 800, color: C.navy, align: "right" });
  p.y += rowH;
  p.rect(PAD, p.y - rowH - headH - d.rows.length * rowH, INNER, headH + (d.rows.length + 1) * rowH, { stroke: C.blue, lw: 2, r: 14 });
  p.y += 22;

  // Late fines (separate from Daily Extra)
  const fines = d.rows.filter((r) => r.fine > 0);
  if (fines.length) {
    const lines = fines.map((r) => `${r.label}: late fine ${m(r.fine, c)}${r.fine_waived ? ` (waived ${m(r.fine_waived, c)})` : ""}`);
    const h = 46 + lines.length * 26;
    p.rect(PAD, p.y, INNER, h, { fill: C.redBg, r: 14 });
    p.text("LATE FINES — shown separately", PAD + 20, p.y + 30, { size: 14, weight: 800, color: C.red });
    p.text("جرمانہ", W - PAD - 20, p.y + 34, { size: 18, urdu: true, color: C.red });
    lines.forEach((l, i) => p.text(l, PAD + 20, p.y + 58 + i * 26, { size: 16, weight: 600, color: C.ink }));
    p.y += h + 22;
  }

  // Summary boxes
  const big: [string, string, number, string][] = [
    ["TOTAL ASAL", "کل اصل رقم", d.totals.original, "Original account price"],
    ["EXTRA", "ایکسٹرا", d.totals.extra, "Total Daily Extra"],
    ["GRAND TOTAL", "کل رقم", d.totals.grand_total, d.totals.fines - d.totals.fines_waived > 0 ? "Price + extra + late fines" : "Price + Daily Extra"],
  ];
  const bw = (INNER - 2 * 18) / 3;
  const bh = 128;
  big.forEach(([en, ur, v, note], i) => {
    const x = PAD + i * (bw + 18);
    const strong = i === 2;
    p.rect(x, p.y, bw, bh, { fill: strong ? C.blue : C.sky, r: 16 });
    p.text(en, x + 20, p.y + 32, { size: 14, weight: 800, color: strong ? "#dbe7ff" : C.blue });
    p.text(ur, x + bw - 20, p.y + 36, { size: 18, urdu: true, color: strong ? C.white : C.blue });
    p.text(m(v, c), x + 20, p.y + 82, { size: 28, weight: 800, color: strong ? C.white : C.ink });
    p.text(note, x + 20, p.y + 110, { size: 13, color: strong ? "#dbe7ff" : C.muted });
  });
  p.y += bh + 14;
  const small: [string, number, string][] = [
    ["Advance paid", d.plan.advance_paid ? d.plan.advance : 0, d.plan.advance > 0 ? `of ${m(d.plan.advance, c)}` : "no advance"],
    ["Collected to date", d.totals.collected, d.totals.credit ? `+ ${m(d.totals.credit, c)} customer credit` : "advance, qist, extra, fines"],
    ["Remaining balance", d.totals.remaining_total, `remaining qist ${m(d.totals.remaining_principal, c)}`],
  ];
  small.forEach(([en, v, note], i) => {
    const x = PAD + i * (bw + 18);
    p.rect(x, p.y, bw, 92, { fill: C.white, stroke: C.line, r: 14 });
    p.text(en.toUpperCase(), x + 20, p.y + 28, { size: 13, weight: 800, color: C.muted });
    p.text(m(v, c), x + 20, p.y + 60, { size: 22, weight: 800, color: i === 2 ? C.navy : C.ink });
    p.text(note, x + 20, p.y + 80, { size: 12, color: C.faint });
  });
  p.y += 92 + 26;

  // Notes (English + Urdu)
  if (d.notes.length) {
    sectionTitle(p, "Daily Extra & fine rules", "قواعد");
    d.notes.forEach((n) => {
      const en = p.wrap(`•  ${n.en}`, INNER, { size: 16 });
      en.forEach((l, i) => p.text(l, PAD, p.y + 22 + i * 23, { size: 16, color: C.ink }));
      p.y += en.length * 23 + 6;
      const ur = p.wrap(n.ur, INNER, { size: 19, urdu: true });
      ur.forEach((l, i) => p.text(l, W - PAD, p.y + 30 + i * 40, { size: 19, urdu: true, color: C.navy }));
      p.y += ur.length * 40 + 8;
    });
    p.y += 12;
  }

  // Account details
  sectionTitle(p, "Account details", "اکاؤنٹ کی تفصیل");
  const pl = d.plan;
  const rows: [string, string][] = [
    ["Account", d.account.title],
    ["Reference", d.account.ref ?? pl.ref],
    ["Account value", m(pl.original, c)],
    ["Advance", pl.advance ? `${m(pl.advance, c)} · ${pl.advance_paid ? "paid" : "pending"}` : "None"],
    ["Remaining (after advance)", m(pl.remaining_principal, c)],
    ["Installments", `${pl.count}${pl.schedule_mode === "manual" ? " (custom dates)" : ""}`],
    ["Duration", pl.duration ?? "—"],
    ["Interval", pl.interval_days ? `Every ${pl.interval_days} days` : "Custom dates"],
    ["Daily Extra", pl.extra_rate ? `${m(pl.extra_rate, c)} per day` : "None"],
    ["Free period", pl.extra_rate ? `${pl.extra_free_days} days` : "—"],
    ["Daily Extra starts", pl.extra_start_on ? `${formatDay(pl.extra_start_on)} · ${pl.extra_end}` : "—"],
    ["Late fine", pl.fine ? `${m(pl.fine, c)} ${pl.fine_mode === "per_day" ? "per day late" : "once per late installment"}${pl.fine_grace_days ? ` · ${pl.fine_grace_days} days grace` : ""}` : "None"],
    ["Plan start", formatDay(pl.start_on)],
    ["Plan status", pl.status],
  ];
  keyValues(p, rows);

  contact(p, d.business);
  footer(p, `Payment plan ${d.receipt_no} · revision ${d.revision} · issued ${formatDay(d.issued_on)}. Daily Extra is added to the next installment; late fines are separate. This sheet shows the agreed schedule — payment receipts are issued for each payment actually received.`);
}

/* ------------------------------------------------------------------ */
/* Payment Received                                                    */
/* ------------------------------------------------------------------ */

function drawPayment(p: Painter, d: PaymentReceiptData, logo: CanvasImageSource | null, reversed: boolean) {
  const pc = d.plan.currency;
  const pay = d.payment;
  p.y = 54;
  header(p, logo, d.business, ["RECEIPT NO.", d.receipt_no, `Issued ${formatDay(d.issued_at.slice(0, 10))}`, `Plan ${d.plan.ref}`]);
  titleBar(p, pay.is_advance ? "ADVANCE RECEIVED" : "PAYMENT RECEIVED", pay.is_advance ? "ایڈوانس وصول ہوا" : "رقم وصول ہوئی", reversed ? C.red : C.blue);

  // Amount
  const h = pay.rate_micro ? 150 : 124;
  p.rect(PAD, p.y, INNER, h, { fill: C.sky, r: 18 });
  p.text("AMOUNT RECEIVED", PAD + 24, p.y + 34, { size: 14, weight: 800, color: C.blue });
  p.text("وصول شدہ رقم", W - PAD - 24, p.y + 38, { size: 19, urdu: true, color: C.blue });
  p.text(m(pay.amount, pay.currency), PAD + 24, p.y + 86, { size: 44, weight: 800, color: C.ink });
  const meta = [`Paid ${formatDay(pay.paid_on)}`, pay.method, pay.reference ? `Ref ${pay.reference}` : null].filter(Boolean).join("  ·  ");
  p.text(meta, PAD + 24, p.y + 114, { size: 16, color: C.muted });
  if (pay.rate_micro) p.text(`Credited ${m(pay.credited, pc)} at 1 ${pay.currency} = ${formatRate(pay.rate_micro)} ${pc}`, PAD + 24, p.y + 138, { size: 15, weight: 600, color: C.navy });
  if (!reversed) p.pill("✓ Received", W - PAD - 24, p.y + 84, C.green, C.greenBg);
  p.y += h + 22;

  sectionTitle(p, "Details", "تفصیل");
  keyValues(p, [
    ["Customer", d.customer.name],
    ["Contact", d.customer.whatsapp ?? d.customer.phone ?? "—"],
    ["Account", d.account.title],
    ["Reference", d.account.ref ?? d.plan.ref],
    ["Payment type", pay.type],
    ["Installment", pay.is_advance ? "Advance" : pay.installments.length ? pay.installments.map((n) => `#${n}`).join(", ") : "—"],
    ["Payment date", formatDay(pay.paid_on)],
    ["Currency", pay.currency === pc ? pc : `${pay.currency} → ${pc}`],
  ]);

  // Allocation
  sectionTitle(p, "How this payment was applied", "رقم کی تقسیم");
  const a = pay.allocation;
  const parts: [string, string, number][] = [
    ["Advance", "ایڈوانس", a.advance],
    ["Qist (installment)", "قسط", a.principal],
    ["Daily Extra", "ڈیلی ایکسٹرا", a.extra],
    ["Late fine", "جرمانہ", a.fine],
    ["Customer credit (overpayment)", "اضافی رقم", a.credit],
  ].filter(([, , v]) => (v as number) > 0) as [string, string, number][];
  parts.forEach(([en, ur, v], i) => {
    p.rect(PAD, p.y, INNER, 50, { fill: i % 2 ? C.white : C.sky2 });
    p.text(en, PAD + 18, p.y + 32, { size: 17, weight: 600 });
    p.text(ur, PAD + 420, p.y + 34, { size: 17, urdu: true, color: C.muted, align: "left" });
    p.text(m(v, pc), W - PAD - 18, p.y + 32, { size: 18, weight: 800, align: "right" });
    p.y += 50;
  });
  p.line(PAD, p.y, W - PAD, p.y, C.blue, 2);
  p.text("Total applied", PAD + 18, p.y + 34, { size: 17, weight: 800, color: C.navy });
  p.text(m(pay.credited, pc), W - PAD - 18, p.y + 34, { size: 19, weight: 800, color: C.navy, align: "right" });
  p.y += 64;

  // Balances
  const b = d.balances;
  const tiles: [string, string, string][] = [
    ["Previously paid", "پہلے ادا شدہ", m(b.previously_paid, pc)],
    ["This payment", "یہ ادائیگی", m(b.this_payment, pc)],
    ["Total collected", "کل وصول", m(b.total_collected, pc)],
    ["Remaining qist", "باقی قسط", m(b.remaining_principal, pc)],
    ["Remaining total", "کل باقی", m(b.remaining_total, pc)],
    ["Next installment", "اگلی قسط", b.next_due_on ? `${m(b.next_amount ?? 0, pc)}` : "Fully paid"],
  ];
  const tw = (INNER - 2 * 16) / 3;
  tiles.forEach(([en, ur, v], i) => {
    const x = PAD + (i % 3) * (tw + 16);
    const y = p.y + Math.floor(i / 3) * 112;
    const strong = i === 4;
    p.rect(x, y, tw, 100, { fill: strong ? C.blue : C.sky, r: 14 });
    p.text(en.toUpperCase(), x + 18, y + 28, { size: 12, weight: 800, color: strong ? "#dbe7ff" : C.blue });
    p.text(ur, x + tw - 18, y + 32, { size: 16, urdu: true, color: strong ? C.white : C.blue });
    p.text(v, x + 18, y + 70, { size: 22, weight: 800, color: strong ? C.white : C.ink });
    if (i === 5 && b.next_due_on)
      p.text(`${b.next_label ?? ""} · due ${formatDay(b.next_due_on)}${b.next_fine ? ` · incl. ${m(b.next_fine, pc)} late fine` : ""}`, x + 18, y + 90, { size: 12, color: b.next_fine ? C.red : C.muted });
  });
  p.y += 2 * 112 + 14;
  if (b.credit > 0)
    p.text(`Customer credit held: ${m(b.credit, pc)} (overpayment — not counted as owed).`, PAD, p.y + 4, { size: 15, weight: 600, color: C.green }), (p.y += 30);
  p.text(`Plan status after this payment: ${b.plan_status}`, PAD, p.y + 10, { size: 16, weight: 700, color: C.navy });
  p.y += 40;

  contact(p, d.business);
  footer(p, `Payment receipt ${d.receipt_no}. Issued for a payment actually received and recorded on ${formatDay(d.issued_at.slice(0, 10))}. Keep this receipt for your records.`);

  if (reversed && p.draw) {
    const ctx = p.ctx;
    ctx.save();
    ctx.translate(W / 2, 520);
    ctx.rotate(-0.22);
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = C.red;
    ctx.lineWidth = 6;
    ctx.strokeRect(-250, -60, 500, 120);
    ctx.fillStyle = C.red;
    ctx.font = `800 64px ${LATIN}`;
    ctx.textAlign = "center";
    ctx.fillText("REVERSED", 0, 22);
    ctx.restore();
  }
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

async function loadAssets(): Promise<HTMLImageElement | null> {
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (fonts) {
    await Promise.all([
      fonts.load(`400 24px ${URDU}`, "قسطوں کا پلان معاف").catch(() => undefined),
      fonts.load(`700 20px ${LATIN}`).catch(() => undefined),
      fonts.load(`800 20px ${LATIN}`).catch(() => undefined),
    ]);
  }
  if (!RECEIPT_LOGO) return null;
  const img = new Image();
  img.src = RECEIPT_LOGO;
  try {
    await img.decode();
    return img;
  } catch {
    return null;
  }
}

export interface RenderedReceipt {
  blob: Blob;
  bytes: Uint8Array;
  width: number;
  height: number;
  url: string;
}

/** Draw a stored receipt snapshot to a PNG (2× resolution). */
export async function renderReceiptPng(data: PlanReceiptData | PaymentReceiptData, opts: { reversed?: boolean } = {}): Promise<RenderedReceipt> {
  const logo = await loadAssets();
  const paint = (p: Painter) => (data.kind === "plan" ? drawPlan(p, data, logo) : drawPayment(p, data, logo, !!opts.reversed));
  const probe = document.createElement("canvas").getContext("2d");
  if (!probe) throw new Error("This device cannot draw images");
  const measure = new Painter(probe, false);
  paint(measure);
  const H = Math.ceil(measure.y + 30);
  const canvas = document.createElement("canvas");
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This device cannot draw images");
  ctx.scale(SCALE, SCALE);
  const p = new Painter(ctx, true);
  border(p, H);
  paint(p);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not create the image"))), "image/png"));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { blob, bytes, width: canvas.width, height: canvas.height, url: URL.createObjectURL(blob) };
}
