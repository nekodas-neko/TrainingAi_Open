/**
 * Collapse repeats on an `ON CONFLICT` target before the INSERT.
 *
 * Postgres rejects an entire command whose VALUES list hits the same conflict row twice —
 * "ON CONFLICT DO UPDATE command cannot affect row a second time" (SQLSTATE 21000) — so a single
 * duplicated key discards the whole CHUNK, not just the duplicate. That is not theoretical here:
 * `error_events` holds 5,771 hits of it on `POST /api/hr-ingest`, each one losing up to 5,000 HR
 * points, until Q-214 collapsed duplicates inside `upsertOuraHeartrate` on 2026-08-13.
 *
 * That fix was written into one function, and `upsertOuraHeartrate`'s own comment stated the
 * intent it did not reach — *"this makes the guarantee the function's own, so every caller gets it
 * rather than each one remembering"*. Seven same-shaped batch upserts did not get it (Q-280). This
 * module is that guarantee, in one place, so the next one inherits it.
 *
 * There is no DB access here on purpose: this is the part that can be proven without one.
 */

/**
 * Keep one row per conflict key, preserving first-seen order.
 *
 * `merge` decides which of two rows sharing a key survives, and must mirror the statement's own
 * `ON CONFLICT DO UPDATE` arm:
 *   - an arm of bare `excluded.*` assignments → the default (the later row wins outright), which is
 *     exactly what Postgres would do if it allowed the second update;
 *   - an arm that merges (`COALESCE`, a per-field source-rank merge, a `setWhere` guard) → pass a
 *     `merge` that reproduces it, or the collapse silently drops what the arm would have kept.
 */
export function collapseOnConflict<T>(
  rows: readonly T[],
  key: (row: T) => string | number,
  merge: (existing: T, incoming: T) => T = (_existing, incoming) => incoming,
): T[] {
  const byKey = new Map<string | number, T>()
  for (const row of rows) {
    const k = key(row)
    const existing = byKey.get(k)
    byKey.set(k, existing === undefined ? row : merge(existing, row))
  }
  return Array.from(byKey.values())
}

/**
 * A `merge` for arms that keep the stored value when the incoming one is NULL — `COALESCE(excluded.x,
 * table.x)` and the per-field source-rank merge in `lib/data/health-source.ts`, where equal rank
 * means newer-wins but a NULL never clobbers.
 *
 * Absent keys count as null, so a later row cannot erase a field it does not carry.
 */
export function keepLatestNonNull<T extends object>(existing: T, incoming: T): T {
  const out = { ...existing }
  for (const k of Object.keys(incoming) as (keyof T)[]) {
    if (incoming[k] != null) out[k] = incoming[k]
  }
  return out
}
