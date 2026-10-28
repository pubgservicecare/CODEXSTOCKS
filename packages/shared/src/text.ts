/**
 * Plain-text (TXT) description helpers.
 *
 * Descriptions are stored EXACTLY as typed. The only change ever applied is
 * normalising Windows/Mac line endings (CRLF / CR) to LF so the same text
 * renders identically everywhere; spaces, tabs, blank lines and leading/trailing
 * whitespace are preserved.
 */
export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** Style used everywhere a TXT description is rendered (desktop and website). */
export const PRESERVE_WHITESPACE_STYLE = {
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  wordBreak: "break-word",
  tabSize: 4,
} as const;

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/** Extract a YouTube video id from common URL shapes. Returns null if not a YouTube video URL. */
export function youtubeId(url: string | null | undefined): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.replace(/^www\.|^m\./, "");
  let id: string | null = null;
  if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host === "youtube-nocookie.com" || host === "music.youtube.com") {
    if (u.pathname === "/watch") id = u.searchParams.get("v");
    else {
      const m = u.pathname.match(/^\/(embed|shorts|live|v)\/([^/?#]+)/);
      if (m) id = m[2];
    }
  }
  return id && YT_ID.test(id) ? id : null;
}

/** Digits-only international number for wa.me links, e.g. "+92 300 1234567" -> "923001234567". */
export function whatsappDigits(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const d = phone.replace(/[^\d]/g, "");
  return d.length >= 7 && d.length <= 15 ? d : null;
}

export function whatsappLink(phone: string | null | undefined, message: string): string | null {
  const d = whatsappDigits(phone);
  if (!d) return null;
  return `https://wa.me/${d}?text=${encodeURIComponent(message)}`;
}

export const PHONE_RE = /^\+?[0-9][0-9 ()-]{5,22}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
