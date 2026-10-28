import { createHmac, randomUUID } from "node:crypto";
import type { ImageKitAuth } from "@codex/shared";

export interface ImageKitConfig {
  publicKey: string;
  privateKey: string;
  urlEndpoint: string;
  folder: string;
}

/**
 * Client-upload authentication parameters (ImageKit "signature" flow).
 * signature = HMAC-SHA1(privateKey, token + expire). The private key never leaves the server.
 */
export function imagekitAuthParams(cfg: ImageKitConfig, now: Date, ttlSeconds = 20 * 60): ImageKitAuth {
  const token = randomUUID();
  const expire = Math.floor(now.getTime() / 1000) + ttlSeconds;
  const signature = createHmac("sha1", cfg.privateKey).update(token + String(expire)).digest("hex");
  return { token, expire, signature, public_key: cfg.publicKey, url_endpoint: cfg.urlEndpoint, folder: cfg.folder };
}

export async function imagekitDeleteFile(cfg: ImageKitConfig, fileId: string, fetchImpl: typeof fetch): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(fileId)) return false;
  const res = await fetchImpl(`https://api.imagekit.io/v1/files/${encodeURIComponent(fileId)}`, {
    method: "DELETE",
    headers: { Authorization: "Basic " + Buffer.from(cfg.privateKey + ":").toString("base64") },
  });
  return res.status === 204 || res.status === 200 || res.status === 404;
}
