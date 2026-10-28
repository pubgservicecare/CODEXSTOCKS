import { META_FIELDS, type AnyRow } from "./entities";

export interface MergeResult<T> {
  merged: T;
  conflictingFields: string[];
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Field-level three-way merge.
 *  - base:   the last version this device saw from the server
 *  - local:  this device's current version
 *  - server: the server's current version
 * A field changed on only one side takes that side's value. A field changed
 * differently on both sides is a real conflict and is reported (never silently overwritten).
 */
export function threeWayMerge<T extends AnyRow>(base: T | null, local: T, server: T): MergeResult<T> {
  const merged: Record<string, unknown> = { ...server };
  const conflictingFields: string[] = [];
  for (const key of Object.keys(local)) {
    if (META_FIELDS.has(key)) continue;
    const l = (local as Record<string, unknown>)[key];
    const s = (server as Record<string, unknown>)[key];
    if (same(l, s)) continue;
    if (!base) {
      conflictingFields.push(key);
      continue;
    }
    const b = (base as Record<string, unknown>)[key];
    if (same(l, b)) merged[key] = s;
    else if (same(s, b)) merged[key] = l;
    else conflictingFields.push(key);
  }
  merged.id = server.id;
  merged.rev = server.rev;
  merged.created_at = server.created_at;
  merged.updated_at = local.updated_at > server.updated_at ? local.updated_at : server.updated_at;
  return { merged: merged as T, conflictingFields };
}
