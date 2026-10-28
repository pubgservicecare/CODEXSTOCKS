import { z } from "zod";
import { ENTITIES, idSchema, type AnyRow, type Entity } from "./entities";

export const API_VERSION = "v1";
export const MAX_PUSH_OPS = 200;
export const MAX_PULL_LIMIT = 500;

/** One queued local change. `op_id` is the idempotency key: retries never apply twice. */
export const syncOpSchema = z.object({
  op_id: idSchema,
  entity: z.enum(ENTITIES),
  id: idSchema,
  base_rev: z.number().int().min(0),
  row: z.record(z.string(), z.unknown()),
});
export type SyncOp = { op_id: string; entity: Entity; id: string; base_rev: number; row: AnyRow };

export const pushRequestSchema = z.object({
  ops: z.array(syncOpSchema).min(1).max(MAX_PUSH_OPS),
});

export type OpResult =
  | { op_id: string; status: "applied"; rev: number; row: AnyRow }
  | { op_id: string; status: "conflict"; server_row: AnyRow; message: string }
  | { op_id: string; status: "rejected"; code: string; message: string };

export interface PushResponse {
  results: OpResult[];
}

export interface PullChange {
  entity: Entity;
  seq: number;
  row: AnyRow;
}

export interface PullResponse {
  changes: PullChange[];
  cursor: number;
  has_more: boolean;
}

export interface ServerConflict {
  id: string;
  entity: Entity;
  entity_id: string;
  op_id: string;
  device_id: string | null;
  client_row: AnyRow;
  server_row: AnyRow | null;
  status: "open" | "resolved";
  resolution: string | null;
  created_at: string;
}

export interface VaultRecord {
  envelope: string;
  vault_id: string;
  version: number;
  updated_at: string;
}

export interface SessionInfo {
  owner: { username: string; created_at: string };
  device: { id: string; name: string } | null;
  kind: "web" | "device";
}

export interface DeviceInfo {
  id: string;
  name: string;
  platform: string;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
  current: boolean;
}

export interface ImageKitAuth {
  token: string;
  expire: number;
  signature: string;
  public_key: string;
  url_endpoint: string;
  folder: string;
}

export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Detect the real image type from magic bytes (never trust file extensions). */
export function sniffImageType(bytes: Uint8Array): (typeof ALLOWED_IMAGE_TYPES)[number] | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  )
    return "image/png";
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  )
    return "image/webp";
  return null;
}

export const IMAGE_EXT: Record<(typeof ALLOWED_IMAGE_TYPES)[number], string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
