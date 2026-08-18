# 2026-08-18 — Review: the create routes nobody gave a schema

**Agent:** Review 📖 · **Branch:** `claude/review-oversized-input` · **Docs-only.**
**Filed:** Q-484 · **Review:** [`docs/reviews/2026-08-18-unvalidated-create-bodies.md`](../../reviews/2026-08-18-unvalidated-create-bodies.md)

## Why

`CLAUDE.md` says *"oversized/mistyped input is a rejection, not a skip"* and *"Ingest routes get a Zod
schema at creation"*. Nothing had tested whether that holds.

## Measured

```
POST /api/injuries     muscleName 200,002 + notes 500,000 chars  →  201, both stored in full
POST /api/supplements  name 300,002 + dose 100,000 chars         →  201, both stored in full
POST /api/injuries     notes 10,000,000 chars (a 10 MB body)     →  201, 10,000,000 stored
```

No ceiling below 10 MB. **The 10 MB is not a storage figure** — `pg_column_size` read ~120 kB because
the payload was one repeated character and TOAST compressed it almost perfectly; real text would not.
What is defensible: the transfer and parse cost is unbounded, and stored size is bounded only by what
the content compresses to. That caveat is in the entry and the row.

## The asymmetry is the finding

Same table, same fields. `PATCH /api/injuries/[id]` runs `InjuryPatchSchema` — `muscleName max(100)`,
`notes max(1000)`, a `startedDate` regex, `severity` as an enum. `POST /api/injuries` does
`const body = await req.json()` and destructures, with a non-empty check on `muscleName` and a
hand-rolled `includes()` on `severity`.

`CLAUDE.md` names **`updateInjury` as the reference** for Zod-whitelisting a PATCH body. It is a good
reference, and the create path beside it has no schema at all — probably because the rule was written
about edit paths after an edit-path bug, and create was never revisited.

The unvalidated `startedDate` also 500s (`"not-a-date"` → 500, `"0001-01-01"` → 201 accepted), which
is the Q-482 class with the same root cause and is fixed by the same change.

## Scope, stated as a candidate count

**33** body-bearing routes call `req.json()` with no `safeParse`/`.parse`. That is a candidate count,
**not** a defect count — several do hand-rolled checks, several are admin-gated. Two were confirmed by
probe; the other 31 are unaudited and should be treated as neither broken nor fine.

## Severity, and why it is filed anyway

Low today, and the reason is not attack — this app's users are its own account holders. It is filed
because the session-start database-size ritual and the 2026-08-17 `disk_full` outage exist precisely
for unbounded growth, because the stated direction is multi-user and a Play Store listing, and
because `InjuryPatchSchema` already encodes the intended bounds so the fix is a few lines.

## Clean, including one I nearly got wrong

The PATCH/PUT edit paths are properly bounded wherever checked. And the **163-vs-31**
`z.string()`-with-`.max()` ratio is **not** a finding: most unbounded `z.string()` declarations under
`app/api` are **AI output schemas** (`generateObject` response shapes), which bound the model's
output rather than user input. I nearly reported that ratio before separating the two.

## Not verified

Local `pnpm dev`. Not on the APK, not against production. 31 of the 33 no-schema routes were not
probed, and no attempt was made to find the real body-size ceiling above 10 MB.
