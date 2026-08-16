> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# Program Name Uniqueness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce per-user program name uniqueness with a friendly error message, and remove the `onConflictDoUpdate` upsert in `saveProgram` that currently causes a same-named "new" program to silently overwrite an existing program's sessions/exercises.

**Architecture:** Add an explicit pre-check inside the `saveProgram` transaction that throws `Error('A program named "<name>" already exists. Use a different name.')` when another program (excluding the one being updated) already has that name for this user. Replace the `.onConflictDoUpdate(...)` insert with a plain `.insert(...).returning()` (the pre-check makes the conflict path unreachable). Surface the error as HTTP 409 from `app/api/workout-templates/route.ts`, and have `builder-review.tsx`'s save handler read and display that message (matching the pattern `config-screen.tsx` already uses).

**Tech Stack:** Next.js 15 App Router, Drizzle ORM, PostgreSQL (local dev on port 5433), TypeScript, vitest.

**Run order:** This plan should land as the **first commit** on the feature branch — Plan C (phase set ownership) builds on top of this clean `saveProgram`.

---

### Task 1: Enforce program name uniqueness in `saveProgram`

**Files:**
- Modify: `lib/data/postgres/adapter.ts:1-2` (imports)
- Modify: `lib/data/postgres/adapter.ts:544-574` (`saveProgram`)

- [ ] **Step 1: Add `ne` to the drizzle-orm import**

In `lib/data/postgres/adapter.ts`, line 2 currently reads:

```ts
import { eq, and, or, inArray, gte, lt, lte, asc, desc, sql } from 'drizzle-orm'
```

Change it to:

```ts
import { eq, and, or, inArray, gte, lt, lte, asc, desc, sql, ne } from 'drizzle-orm'
```

- [ ] **Step 2: Add the uniqueness pre-check and replace the upsert**

Replace the body of `saveProgram` from `lib/data/postgres/adapter.ts:544-574`:

```ts
  async saveProgram(userId: string, program: Program): Promise<Program> {
    return this.db.transaction(async tx => {
      let pRow: typeof s.programs.$inferSelect
      if (program.id) {
        const [r] = await tx.update(s.programs)
          .set({
            name: program.name, isActive: program.isActive, updatedAt: new Date(),
            phaseMode: program.phaseMode ?? 'manual',
            phaseSetId: program.phaseSetId ?? null,
            sessionsPerCycle: program.sessionsPerCycle ?? null,
            totalWeeks: program.totalWeeks ?? null,
          })
          .where(and(eq(s.programs.id, program.id), eq(s.programs.userId, userId)))
          .returning()
        pRow = r
      } else {
        const [r] = await tx.insert(s.programs)
          .values({
            userId, name: program.name, isActive: program.isActive, updatedAt: new Date(),
            phaseMode: program.phaseMode ?? 'manual',
            phaseSetId: program.phaseSetId ?? null,
            sessionsPerCycle: program.sessionsPerCycle ?? null,
            totalWeeks: program.totalWeeks ?? null,
          })
          .onConflictDoUpdate({
            target: [s.programs.userId, s.programs.name],
            set: { isActive: sql`EXCLUDED.is_active`, updatedAt: new Date() },
          })
          .returning()
        pRow = r
      }
      const programId = pRow.id
```

with:

```ts
  async saveProgram(userId: string, program: Program): Promise<Program> {
    return this.db.transaction(async tx => {
      const [nameClash] = await tx.select({ id: s.programs.id })
        .from(s.programs)
        .where(and(
          eq(s.programs.userId, userId),
          eq(s.programs.name, program.name),
          program.id ? ne(s.programs.id, program.id) : undefined,
        ))
      if (nameClash) {
        throw new Error(`A program named "${program.name}" already exists. Use a different name.`)
      }

      let pRow: typeof s.programs.$inferSelect
      if (program.id) {
        const [r] = await tx.update(s.programs)
          .set({
            name: program.name, isActive: program.isActive, updatedAt: new Date(),
            phaseMode: program.phaseMode ?? 'manual',
            phaseSetId: program.phaseSetId ?? null,
            sessionsPerCycle: program.sessionsPerCycle ?? null,
            totalWeeks: program.totalWeeks ?? null,
          })
          .where(and(eq(s.programs.id, program.id), eq(s.programs.userId, userId)))
          .returning()
        pRow = r
      } else {
        const [r] = await tx.insert(s.programs)
          .values({
            userId, name: program.name, isActive: program.isActive, updatedAt: new Date(),
            phaseMode: program.phaseMode ?? 'manual',
            phaseSetId: program.phaseSetId ?? null,
            sessionsPerCycle: program.sessionsPerCycle ?? null,
            totalWeeks: program.totalWeeks ?? null,
          })
          .returning()
        pRow = r
      }
      const programId = pRow.id
```

Note: `and(...)` in drizzle-orm 0.45 filters out `undefined` conditions, so when `program.id` is falsy (new program) the `ne(...)` clause is simply omitted and the check covers *all* of this user's programs.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

---

### Task 2: Return HTTP 409 for the "already exists" error

**Files:**
- Modify: `app/api/workout-templates/route.ts:51-54`

- [ ] **Step 1: Branch on the error message in the POST catch block**

Replace:

```ts
  } catch (e) {
    console.error('[workout-templates POST]', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Save failed' }, { status: 500 })
  }
```

with:

```ts
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Save failed'
    if (message.includes('already exists')) {
      return NextResponse.json({ error: message }, { status: 409 })
    }
    console.error('[workout-templates POST]', e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

---

### Task 3: Surface the server's error message in the AI workout builder's save flow

**Files:**
- Modify: `components/workout-builder/builder-review.tsx:254`

- [ ] **Step 1: Parse and display the JSON error body on failure**

Replace:

```ts
      if (!res.ok) { toast.error('Failed to save program'); return }
```

with:

```ts
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error ?? 'Failed to save program')
        return
      }
```

This mirrors the existing pattern in `components/config-screen.tsx:466-469`, which already surfaces `err.error` and needs no changes.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

---

### Task 4: Verify against the local dev database

**Files:** none (verification only)

- [ ] **Step 1: Run the unit test suite**

Run: `pnpm test`
Expected: all existing tests pass (no test exercises `saveProgram` directly, so this just guards against unrelated regressions).

- [ ] **Step 2: Run lint**

Run: `pnpm lint`
Expected: no new errors.

- [ ] **Step 3: Start the dev server against the local DB**

```bash
set -a && source .env.local && set +a && pnpm dev
```

Confirm the startup log shows the local Postgres connection (port 5433), not Railway.

- [ ] **Step 4: Confirm the existing seeded program's name**

```bash
set -a && source .env.local && set +a
psql "$DATABASE_URL" -c "select id, user_id, name, is_active from programs;"
```

Note the seeded program's `name` and `id` (and the seeded user's `id`) for the next steps — the seeded test user is `test@local.dev` / `testpass123`.

- [ ] **Step 5: Reproduce the "name already used" error via the API**

Log in as `test@local.dev` in the browser (so the session cookie is set), open devtools, and run in the console (or use `curl` with a copied session cookie):

```js
fetch('/api/workout-templates', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    program: {
      userId: '',
      name: '<the seeded program name from Step 4>',
      isActive: false,
      sessions: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      phaseMode: 'manual',
    },
  }),
}).then(r => r.json().then(b => console.log(r.status, b)))
```

Expected: `409 { error: 'A program named "<name>" already exists. Use a different name.' }`, and `select count(*) from programs;` in `psql` is unchanged (no new row was inserted, no existing row was overwritten).

- [ ] **Step 6: Confirm a genuinely new name still saves successfully**

Repeat Step 5 with `name: '<the seeded program name> 2'`.

Expected: `200 { ok: true, program: { ... } }`. Then:

```bash
psql "$DATABASE_URL" -c "select id, name from programs where user_id = '<seeded user id>';"
```

Expected: both the original program and the new `<name> 2` program are present.

- [ ] **Step 7: Confirm renaming a program to its own current name still works (no false positive)**

Repeat Step 5, but include the new program's `id` (from Step 6's response) in the payload and keep `name` as `<the seeded program name> 2` (i.e. update with no name change, e.g. flip `isActive`).

Expected: `200 { ok: true, program: { ... } }` — the self-exclusion (`ne(s.programs.id, program.id)`) prevents a false "already exists" on no-op renames.

- [ ] **Step 8: Test the AI workout builder flow end to end**

In the browser, open the AI workout builder, generate a program, and on the review screen set its name to the seeded program's name from Step 4. Tap save.

Expected: a toast reading `A program named "<name>" already exists. Use a different name.` (not the generic "Failed to save program"), and the builder stays on the review screen so the user can rename and retry.

- [ ] **Step 9: Clean up test data**

```bash
psql "$DATABASE_URL" -c "delete from programs where name = '<the seeded program name> 2';"
```

---

### Task 5: Commit

**Files:** none (git only)

- [ ] **Step 1: Stage and commit**

```bash
git add lib/data/postgres/adapter.ts app/api/workout-templates/route.ts components/workout-builder/builder-review.tsx
git commit -m "Enforce per-user program name uniqueness on save"
```

---

## Self-Review Notes

- **Spec coverage:** Implements the design point "user tries to create a new workout with the same name 'john' ... it says 'the name john is already used for a workout, use a different name'" via Task 1 (DB-level check) + Task 2 (HTTP 409) + Task 3 (UI toast). The "renaming keeps the link and nothing changes" / no-op-rename case is covered by Task 4 Step 7's self-exclusion check.
- **Placeholder scan:** No TBD/placeholder text; all steps contain exact code or exact commands with expected output.
- **Type consistency:** `saveProgram(userId: string, program: Program): Promise<Program>` signature is unchanged (matches `lib/data/repository.ts:51`); only the implementation body changes. No new types introduced. The `ne` import addition is the only signature-adjacent change and is purely additive.
- **Dependency on Plan A:** None — this plan only touches `lib/data/postgres/adapter.ts`'s `saveProgram`, `app/api/workout-templates/route.ts`, and `builder-review.tsx`, none of which Plan A modifies. Can be implemented and committed independently, but should land first per the "Run order" note above since Plan C's `saveProgram` rename-cascade work (Task in Plan C) builds directly on top of this version of `saveProgram`.
