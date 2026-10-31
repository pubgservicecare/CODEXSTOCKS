// CODE X STOCKS icon set: original 24px line icons (1.75 stroke), plus the brand mark.
import type { SVGProps } from "react";

const P: Record<string, string> = {
  dashboard: "M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z",
  accounts: "M4 7.5 12 4l8 3.5-8 3.5zM4 12l8 3.5 8-3.5M4 16.5 12 20l8-3.5",
  sales: "M4 19h16M7 15l4-4 3 3 5-6M15 8h4v4",
  expenses: "M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3M4 7.5V17a2 2 0 0 0 2 2h14V9H6.5A2.5 2.5 0 0 1 4 7.5ZM16 14h.01",
  history: "M4 12a8 8 0 1 0 2.3-5.6M4 4v3.5h3.5M12 8v4.5l3 1.8",
  sync: "M19.5 9A8 8 0 0 0 5.2 7.2M4.5 15a8 8 0 0 0 14.3 1.8M19.5 4v5h-5M4.5 20v-5h5",
  devices: "M3 5h14v10H3zM7 19h6M10 15v4M19 9h2v10h-4",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19 12l2-1-1.2-3-2.2.5-1.4-1.4.5-2.2-3-1.2-1 2h-2l-1-2-3 1.2.5 2.2L5.8 7.5 3.6 7 2.4 10l2 1v2l-2 1 1.2 3 2.2-.5 1.4 1.4-.5 2.2 3 1.2 1-2h2l1 2 3-1.2-.5-2.2 1.4-1.4 2.2.5 1.2-3-2-1z",
  backup: "M4 6h16v4H4zM5 10v9h14v-9M10 14h4",
  lock: "M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3M12 15v2",
  unlock: "M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 6.8-1.2M12 15v2",
  plus: "M12 5v14M5 12h14",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4",
  chevronLeft: "M15 5l-7 7 7 7",
  chevronRight: "M9 5l7 7-7 7",
  chevronDown: "M5 9l7 7 7-7",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15.5 9.5h.01",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  key: "M15 9a4 4 0 1 1-1.2-2.8M14 10l6 6M18 14l-2 2M20 16l-2 2",
  shield: "M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z",
  shieldCheck: "M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6zM9 12l2 2 4-4",
  cloud: "M7 18h10.5a4 4 0 0 0 .6-8A6 6 0 0 0 6.6 9.2 4.5 4.5 0 0 0 7 18Z",
  cloudOff: "M3 3l18 18M9.5 6.4A6 6 0 0 1 18.1 10a4 4 0 0 1 2.3 6.7M17 18H7a4.5 4.5 0 0 1-1.6-8.7",
  logout: "M10 4H5v16h5M14 8l4 4-4 4M18 12H9",
  external: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
  edit: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  copy: "M8 8h12v12H8zM16 8V4H4v12h4",
  check: "M5 12.5l4.5 4.5L19 7.5",
  x: "M6 6l12 12M18 6 6 18",
  menu: "M4 7h16M4 12h16M4 17h16",
  alert: "M12 3l9.5 17h-19zM12 10v4M12 17.5h.01",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5M12 7.5h.01",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  list: "M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3Z",
  tag: "M3 12V4h8l10 10-8 8zM7.5 8.5h.01",
  play: "M8 5v14l11-7z",
  phone: "M7 3h10v18H7zM11 18h2",
  mail: "M3 6h18v12H3zM3 7l9 6 9-6",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0",
  arrowUp: "M12 19V5M6 11l6-6 6 6",
  arrowDown: "M12 5v14M6 13l6 6 6-6",
  refund: "M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3",
  upload: "M12 16V4M7 9l5-5 5 5M4 20h16",
  download: "M12 4v12M7 11l5 5 5-5M4 20h16",
  wifiOff: "M3 3l18 18M8.5 16.4a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 4-2.4M19 12.9a10 10 0 0 0-2.6-1.9M2 9a15 15 0 0 1 4.2-2.6M22 9a15 15 0 0 0-9.8-3.9M12 20h.01",
  layers: "M12 4 3 9l9 5 9-5zM3 14l9 5 9-5",
  spark: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6",
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 18, className, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={name === "play" ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
      className={className ? `icon ${className}` : "icon"}
    >
      <path d={P[name]} />
    </svg>
  );
}

/** CODE X STOCKS mark: a reticle whose crosshair forms an X. */
export function LogoMark({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" className="logo-mark">
      <defs>
        <linearGradient id="cx-mark-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffd68a" />
          <stop offset="0.55" stopColor="#f0a93b" />
          <stop offset="1" stopColor="#c7781a" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill="url(#cx-mark-bg)" />
      <circle cx="20" cy="20" r="11" fill="none" stroke="#1b1206" strokeWidth="2.4" />
      <path d="M12.5 12.5 17.2 17.2M22.8 22.8 27.5 27.5M27.5 12.5 22.8 17.2M17.2 22.8 12.5 27.5" stroke="#1b1206" strokeWidth="2.8" strokeLinecap="round" />
      <path d="M20 5.5v3.6M20 30.9v3.6M5.5 20h3.6M30.9 20h3.6" stroke="#1b1206" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="20" cy="20" r="1.7" fill="#1b1206" />
    </svg>
  );
}
