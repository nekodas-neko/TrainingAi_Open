# Review — the create routes nobody gave a schema

**Date:** 2026-08-18 · **Agent:** Review · **Lens:** oversized and unvalidated request bodies
**Findings filed:** Q-484 · **Clean results recorded:** two

## Why this lens

`CLAUDE.md` is explicit: *"Security checks fail closed: a missing signature header, missing signing
key, or **oversized/mistyped input is a rejection, not a skip**"*, and *"Ingest routes get a Zod
schema at creation, same as sibling routes — untyped numeric passthrough to the driver is not
validation."* Nothing had tested whether that holds.

## The measurement

```
POST /api/injuries      muscleName 200,002 chars + notes 500,000  →  201, both stored in full
POST /api/supplements   name 300,002 chars + dose 100,000         →  201, both stored in full
POST /api/injuries      notes 10,000,000 chars (a 10 MB body)     →  201, 10,000,000 stored
```

No ceiling was found below 10 MB. The server parsed a 10 MB JSON body into memory and wrote the row.

**An honesty note on the storage number.** `pg_column_size` reported ~120 kB for those rows, because
the payload was a repeated single character and Postgres TOAST compresses it almost perfectly. Real
text would not. **Do not quote 10 MB as a storage figure** — the reliable statements are that the
*transfer and parse* cost is unbounded, and that the stored size is bounded only by what the content
compresses to.

## Finding (Q-484) — create is unvalidated, edit is the documented reference

The asymmetry is the finding. For the same table, same fields:

| | `POST /api/injuries` | `PATCH /api/injuries/[id]` |
|---|---|---|
| Body handling | `const body = await req.json()` then destructure | `InjuryPatchSchema.safeParse(...)` |
| `muscleName` | non-empty check only | `z.string().min(1).max(100)` |
| `notes` | none | `z.string().max(1000).nullable()` |
| `startedDate` | none — used as-is | `z.string().regex(/^\d{4}-\d{2}-\d{2}$/)` |
| `severity` | hand-rolled `includes()` | `z.enum([...])` |

`CLAUDE.md` names **`updateInjury` as the reference** for Zod-whitelisting a PATCH body. It is a good
reference. The create path beside it has no schema at all, which is the likely reason: the rule was
written about edit paths after an edit-path bug, and the create path was never revisited.

**The unvalidated `startedDate` also 500s**, the same class as Q-482:

```
POST /api/injuries {"startedDate":"not-a-date"}  →  500
POST /api/injuries {"startedDate":"0001-01-01"}  →  201, accepted
```

`POST /api/supplements` shares the shape (`const body = await req.json()`, no schema).

**Scope, measured but read carefully:** **33** body-bearing routes call `req.json()` with no
`safeParse`/`.parse`. That is a **candidate** count, not a defect count — several do hand-rolled
checks (injuries validates `severity`), and a number are admin-gated, which limits reach without
adding validation. Two were confirmed by probe to store oversized text. The rest are unaudited.

### Severity, stated plainly

**Low today, and the reason to fix it is not attack.** This is a personal app whose users are its own
account holders; nobody is fuzzing it. What makes it worth an entry:

- `CLAUDE.md` runs a **session-start database-size ritual** and records a real `disk_full` production
  outage (2026-08-17). An unbounded user-writable text column is the shape that ritual exists to
  catch, and it currently has no upper bound at all.
- The stated direction is **multi-user and a Play Store listing**, at which point "nobody is attacking
  it" stops being an argument.
- **The fix is nearly free**: `InjuryPatchSchema` already exists and already encodes the intended
  bounds. The create route can reuse it (minus the `.optional()`s) in a few lines.

### Fix shape

1. Give `POST /api/injuries` and `POST /api/supplements` a Zod schema, reusing the bounds their PATCH
   siblings already declare. That closes the oversized-text case and the `startedDate` 500 together.
2. Consider a shared body-size guard for `req.json()` — a rejection above some sane ceiling — so the
   remaining 31 candidates are bounded even before they are individually audited.
3. Audit the other 31 as a follow-up; do not assume they are broken, and do not assume they are fine.

## Clean results

- **The PATCH/PUT edit paths are well-guarded** wherever they were checked — `InjuryPatchSchema` and
  `nutrition/meal-types` (`name: max(100)`, `emoji: max(10)`) both bound their strings properly. The
  problem is specific to create routes.
- **The 163-vs-31 `z.string()`-with-`.max()` ratio is NOT a finding and should not be quoted.** Most
  unbounded `z.string()` declarations under `app/api` are **AI output schemas** (`generateObject`
  response shapes in `generate-program`, `builder-chat`, `nutrition-goals/recommend`,
  `exercises/generate`) — they bound the model's output, not user input. I nearly reported that ratio
  before separating the two.

## Not verified

Local `pnpm dev`. Not on the APK, not against production. 31 of the 33 no-schema routes were not
probed — several are admin-gated and several do hand-rolled validation, so the count is a starting
list, not a defect list. No attempt was made to find the actual body-size ceiling above 10 MB.
