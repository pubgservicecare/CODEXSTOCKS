import type { ApiConfig } from "./api";
import type { Db } from "./db";

const list = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);

/** Origins used by the Tauri 2 WebView on Windows/macOS/Linux. */
export const TAURI_ORIGINS = ["http://tauri.localhost", "https://tauri.localhost", "tauri://localhost"];

/**
 * Build the API configuration from environment variables. Secret values are read
 * here on the server only and are never sent to browsers or the desktop app.
 */
export function configFromEnv(env: Record<string, string | undefined>, db: Db): ApiConfig {
  const ik =
    env.IMAGEKIT_PUBLIC_KEY && env.IMAGEKIT_PRIVATE_KEY && env.IMAGEKIT_URL_ENDPOINT
      ? {
          publicKey: env.IMAGEKIT_PUBLIC_KEY,
          privateKey: env.IMAGEKIT_PRIVATE_KEY,
          urlEndpoint: env.IMAGEKIT_URL_ENDPOINT.replace(/\/$/, "") + "/",
          folder: env.IMAGEKIT_FOLDER || "/codex-stocks/accounts",
        }
      : undefined;
  const adminOrigins = list(env.ADMIN_ORIGINS || "https://admin.codexstocks.org");
  return {
    db,
    setupToken: env.SETUP_TOKEN || undefined,
    imagekit: ik,
    corsOrigins: [...TAURI_ORIGINS, ...list(env.EXTRA_CORS_ORIGINS)],
    adminOrigins,
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE !== "false" : env.NODE_ENV === "production",
  };
}
