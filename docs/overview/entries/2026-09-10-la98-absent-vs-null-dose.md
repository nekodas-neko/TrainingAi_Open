## 2026-09-10 — LA-98: absent and null stop meaning the same thing

Lane A. LA-98 leaves the queue; **LA-99** is filed from the evening's own friction.

**The bug, and why it is the sibling of LA-97.** `resolveLoggedDose` merged with `??`, which treats
an explicit `null` as absent. A replayed log whose amount was *genuinely* null when it was taken
therefore picked up whatever `default_amount` the definition carried at **push time** — the same
retroactive rewrite BF-3 exists to prevent, one field over from the reconstitution LA-97 fixed an
hour earlier.

**It was smaller than the entry implied, and the reason is worth recording.**
`SupplementLogSchema` already declares all three fields `.optional()` under `.strict()`, so the
parser keeps absence and null apart — `parsed.data.amount` really is `undefined` when omitted. The
distinction was destroyed *one line later* by the route's own `amount: parsed.data.amount ?? null`,
and `logSupplement` already takes `Partial<SupplementDose>`, so no signature had to change. Three
surfaces, a handful of lines:

- **`resolveLoggedDose`** — `caller?.amount !== undefined ? … : …` instead of `??`. Absent means
  "fill from the definition"; present-and-null means "none was recorded, keep it".
- **the log route** — builds a partial by conditional spread, so an omitted field stays an omitted
  key rather than becoming an explicit null.
- **the push branch** — `'amount' in p ? … : {}`, because `typeof p.amount === 'number'` answers
  "no" to both cases and cannot separate them.

**This changes web-route behaviour, and that is stated rather than buried.** A body of
`{unit: 'mg'}` used to inherit the definition's amount and now does not. No shipped caller sends a
partial body — `supplements-section.tsx` sends `{amount, unit}` together or nothing at all — so
nothing in the app moves; a future caller gets the honest reading instead of a silent fill.

**Mutation pass — 2 mutants, 1 control.** M1 (merge reverted to `??`) → CAUGHT, 3 tests including
the end-to-end replay through `pushMutations`. M2 (push branch flattens absence back to null) →
CAUGHT, 2 tests, one of them **pre-existing** — which is the useful signal, because it shows the
absence path was already load-bearing for the older-client fallback rather than something these
tests invented. M3 control (the same `!== undefined` test spelled out longhand) → SURVIVES.

**LA-99, filed from the friction rather than from a report.** Six PRs raised
`docs/doc-size/docs/implementation-backlog.md.size` within two hours tonight and **every merge
conflicted on that one file and was resolved identically**. The entry proposes a `.gitattributes`
merge driver that recomputes — and records the trap that cost two retries here: the tracked docs
have no trailing newline, so `check-doc-index-size` counts one more than `wc -l`, and only the
count the check *reports* is the number the gate accepts. It also says plainly that the conflict is
correct by design (LA-33 split these per-document; two PRs raising the same doc genuinely disagree)
— the waste is the hand-resolution, not the conflict.

**Not exercised:** no device run and none owed — this is a server-side merge rule plus a route body
shape, both of which run for real in the tests. No UI changed. The offline half is untouched;
`upsertSupplementLog` already passed a complete triple and still does.
