## 2026-09-02 — the plan card gets an e2e, and Lane B's queue stops offering work it cannot start (LB-51, Q-297, Q-138)

**Branch:** `docs/lane-b-queue-hygiene` · **Lane:** B · **No version bump** — a spec and queue edits
change nothing a user can see.

### LB-51 — `e2e/plan-rescale.spec.ts`

Q-187 shipped verified by hand against a local database, which proves it worked once and leaves no
regression net. This is the net: two tests covering the re-scale and the floor. **Four mutations kill
it** — removing the re-scale, removing the floor, next-meal-only, and dropping the `(planned N)`
figure from the row.

- **The entry's own recommendation was the wrong shape, and the correction is the useful part.** It
  proposed stubbing `GET /api/nutrition/meal-plans`. **A spec here can talk to Postgres directly** —
  `food-logging-complete.spec.ts` opens a `pg` `Client` on `process.env.DATABASE_URL` — so the
  fixture is built in the database and torn down in `afterAll`, which works on CI's fresh instance
  with no stub at all. A stubbed plan against real food would have tested half the sum anyway:
  `eaten` comes from the day's real `food_logs` through the page's own pipeline.
- **The assertion is the invariant, not a number.** The adjusted figures sum to the target minus what
  was eaten, both read off the card, so the fixture's calories can change without touching it. It
  also asserts the *direction* — scaled down when the day is over its share — because "different from
  planned" would pass against an arbitrary rewrite.
- **The tap gotcha is written into the spec.** `Show N meals` needs `tapCentre`; a forced `.click()`
  leaves `aria-expanded` at `false`. That is Q-354 on the Nutrition screen, and it cost the most time
  of anything in Q-187.
- **Keep:** the rest of the plan card is still uncovered — log-all, per-meal log and decline,
  save-to-My-Foods. The fixture is the hard part and they can reuse it.

### Q-297 — down to two residues, one of them the owner's

Everything buildable had already shipped, four of the five under other entries' numbers. What is left:

1. **A warmed-server instant-paint budget.** The 20 s skeleton budget catches a card that *never*
   seeds; it cannot tell "seeds instantly from cache" from "seeds in 8 s off the network", because
   the harness runs `pnpm dev` and handlers compile on first call. Measuring the second wants a tight
   timing budget on a shared CI runner, which is a flaky-test generator. Deliberately or not at all.
2. **Whether the E2E job becomes a required check — the owner's, because it is branch protection.**
   **Measured rather than read: E2E is NOT required today** — PR #776 merged while its E2E job was
   still `in_progress`. LA-22 has since made the job always-run and always-report specifically so it
   is safe to require, so the only remaining question is whether to. Marked `Gate: owner`.

### Q-138 → `Reference:`

It was heading Lane B's work list while its own text says *"Take them opportunistically when already
touching the file, not as a dedicated PR."* An entry that offers a build it argues against costs
every session that reaches it a read — the same shape as Q-354, reclassified the same way the day
before. Re-measured the four files, since two had drifted from the table's numbers:
`workout-screen.tsx` **1833**, `session-select-content.tsx` **1448**, `config-screen.tsx` **997**,
`program-editor-sheet.tsx` **963**.

### The queue, before and after

Lane B's `READY` list went from **11 entries to 5**, and the five are genuinely startable — with the
exception of LB-47, which is flagged as needing an owner call. Three of the six removed were not
finished work: **BF-104** and **BF-102** were split (LB-49, LB-50) because their Lane B halves each
needed Lane A engine work first, and **Q-138** was reclassified. An implementer who reached any of
them before this would have read the entry, started, and stopped.

### The baton

`docs/agents/state/implementation-lane-b.md` rewritten in full — it still said *"Next ID: `LB-45`"*
and described the run before this one. Rewritten, never appended, per the contract: a baton that is
half last week's is worse than none, because it gets trusted.

### Not exercised

Nothing device-verifiable shipped here. The device debt from this run is enumerated on the baton and
is now roughly seventeen screens.

### Q-111 — two corrections, from reading the tree rather than the entry

Scoping the next item turned up an entry that describes code which is not there.

1. **The ring half's stated outcome is not in the tree.** Q-111 says *"✅ RING HALF DONE … wired into
   the Home header beside the weather chip"*, naming `oura-battery-chip.tsx`. **No such file exists,
   and the Home header renders `WeatherChip` and nothing else beside the date.** The ring battery
   renders on Health and More (`components/health/oura-section.tsx`, `components/more/oura-section.tsx`)
   — which fits the v1.270.30 changelog's own wording, *"The chip existed but was reading the Oura
   Cloud value"*. **Git cannot settle whether it regressed or never reached Home:** history begins at
   the public snapshot on 2026-08-16, after the 2026-08-08 claim. Either way the header is empty
   today, so the ring half is open.
2. **The strap battery is already read and displayed — during pairing, by a different route.**
   `components/settings/chest-strap-pairing.tsx:87-139` reads the standard Battery Service
   characteristic over browser BLE and renders `Battery N%`. The entry's *"no JS call site reads it"*
   is wrong as stated. What is true: **nothing reads `PolarBleStatus.battery`** — the native
   service's value, delivered by `getStatus()` and the `polarStatus` listener — and nothing persists
   either number. That is **a second source for one value**, the class this repo keeps paying for.

Neither was built here. The point of recording them is that an implementer taking the entry at its
word would build the strap half against a false picture of both ends — and would spend the first hour
looking for a file that does not exist.
