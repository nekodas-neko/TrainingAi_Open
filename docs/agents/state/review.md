# 📖 Review Agent — baton

> **Successor sessions are titled `📖 Review Agent 🟢`**, exactly, with both emoji included. The
> **leading** emoji is the role and never changes. The **trailing light** is that session's own
> status: 🟢 live, 🔴 handed on. It is the only part that moves. A session titles itself 🟢 on its
> first instruction, and flips itself to 🔴 as the last step of its handoff, after the baton and
> every PR have landed.

**Updated:** 2026-09-26 · **By:** the session that ran sweeps 54–64 (2026-09-23 → 26) · **Next ID:
`RV-222`.**

**A baton carries state, not history.** Keep it to a screen. Every sweep has its own
`docs/reviews/` write-up, indexed from the eleven `docs/domains/*/README.md` files.

---

## IDs

`RV-<n>`, counting up forever. Find the next one with
`grep -rhoE '\bRV-[0-9]+\b' docs/ | sort -t- -k2 -n | uniq | tail -1`.

- Ignore **`RV-999`** and **`RV-31`**: both are prose examples, not entries.
- Legacy `Q-` numbers stay valid and are never renumbered.

## Now — idle, waiting for the owner's next review brief

**Nothing is open.** Every PR from sweeps 54–64 is merged. This session's last three: #1686 (sweep
63), #1707 (sweep 64), and the routing PR that wrote this baton.

**Handed off, so do not re-file:**
- **Lane O, owner items: RV-221.** One mockup (RV-213), the daily calorie target (RV-218), and a
  merge-time yes on six security fixes. It sits beside the older **RV-161 / RV-170 / RV-157**.
- **Lane DV, one pass: RV-220.** It fixes the gallery's capture faults and then runs everything
  still owed: P41 before/after on RV-207's shipped fixes, RV-206 P29–P38, the rest of RV-205, and
  whether hidden tabs keep animating. **When its result lands, the next sweep is reading that
  gallery.**
- **Security, Lane A:** RV-190, 191, 192, 193, 195, 196, 197, 198 (partly shipped).
  - **RV-191 first:** any user can reach it, and it is the precondition for 193 and 196.
  - **RV-190 before OR-138.** Open PR #1499 must not merge ahead of it.
- **AI to logic, Lane A/B:** RV-200 (partly shipped), 201, 202, 203, 204.
- **Design, Lane B:** RV-208 to RV-219.
  - **RV-207 shipped 5 of 7.** Its ⑤ remainder is LB-162, and ⑥ is a Lane O mockup.
  - **RV-216** (the two streak functions) and **RV-217** (raw sleep keys) are Lane A,
    code-certain.

**The lesson of sweeps 62–64:**
- **A web screenshot pass is worth doing first, and the phone corrects it.** Of sweep 63's web-only
  readings:
  - two were wrong: the white dialog button, and "Dumbbell", which is an icon-name fallback;
  - one moved: the "empty pill" is a populated pill that truncates the date on the device.
- **The phone found what the web build could not:** the 111 against 49 streak, the raw sleep keys,
  and four calorie numbers.
- **Check a DV gallery for byte-identical captures before reading it.** Health's set turned out to
  be the launcher.

## Still open from earlier — do not re-file

**Q-499, Q-555, RV-37/39** (device), **RV-38/41/43** (owner), and **RV-65** (the prescription's
model call, gated on the owner).

## Next — only when the owner asks for a review

**This session awaits a brief.** The owner directs each sweep, so do not start one unprompted.
When he does ask, these are ready:
- **Read RV-220's gallery,** once DV posts the URL.
- **The POST surface:** a ghost id and a malformed id each posted against every create route,
  then the row read back.
- **A clean clone, actually built** (settles `NOTICE`, and Q-313 is why it matters).
- **`/api/coach/preview`**, and whether Coach proposes sane numbers.
- **Q-452's siblings,** which need a partial-data fixture.

## How screenshots reach this role (settled 2026-09-25, owner request)

- **From DV:** a **private Artifact** on the owner's account, holding labelled PNGs as published
  files. The URL is recorded on the DV entry.
  - Read the page with `Artifact read`, then pull images with `paths`. They land in the
    scratchpad's `artifact-files/`.
  - **Never commit an image; the repo is public.**
- **From here:** the web build at 412 × 915, DPR 2.625, through the repo's own Playwright
  `setup` project against `pnpm dev`.
  - Capture scripts live **outside the repo**.
  - Freshen the seeded user with SQL on the **local** DB only.
  - Slice tall captures to viewport height before reading them. Sharp is in `node_modules`, and
    Python has no PIL here.

## Security-review rule (sweep 60)

**The repo is public:** security entries name the surface and the fix, never a payload or steps.
Mechanisms are proven on the **local** DB with throwaway roles. **Never probe production.**

## Blocked

Nothing. The ceiling is still the device, and DV now covers it: the web build has no local store,
no insets and no Samsung WebView, so a web-only visual finding is a DV target, not a fact.

## Claimed paths

None. This role's PRs are docs-only.

## Do not re-litigate

- Authority limits and the lane contract are settled in [`docs/agents/README.md`](../README.md).
- **Queue position is priority; the ID is not.**
- **Structural calls are this role's to make** (owner, 2026-09-22). His are data destruction,
  money, auth and secrets, scoring calibration, and product preference. **An owner question is a
  `Lane: O` entry with an `Ask:` line, never a chat line.**
- **The backlog is no longer size-tracked (#1666).** Do not recreate its `.size` file or write a
  baseline-history note for it.
- **Merge conflicts on the backlog:** keep `main`'s deletions and both sides' additions. Read the
  headings, because two deletions look the same as an addition.

## Method notes — do not re-derive these

- **A malformed id and a well-formed missing one are each other's control** — two statuses for two
  ids differing only in format means one is wrong; no fixture needed.
- **"Reports success" is not a finding without a POSITIVE control** — `200 {ok:true}` for a ghost id
  says nothing until the same call with a real id is shown to move the database. Where the table was
  empty, sweep 48 wrote *not established* rather than asserting or dropping it.
- **Check for the offline-first upsert before filing a create-on-update.** `saved-meals` writing a
  row at a client-supplied UUID looks like the ownership class and is the opposite: one shared
  upsert with `setWhere` on the owner, so a device can mint ids offline.
- **A prior review's DECISION is a claim too — find its boundary, do not reverse it.** Sweep 47's
  seven routes were considered and deliberately not filed on 2026-08-18; that argument is right for
  the case it tested and false for the one it did not. The finding is the boundary.
- **Two identical responses are two failed probes.** Ghost and malformed both returning
  `400 Invalid body` read as "it rejects everything"; both had missed the handler (wrong param shape).
- **A malformed id is the cheapest control for a dynamic route** — `400 Invalid id` proves the route
  matched and its guard ran, for one extra request and no fixture.
- **A one-call-site helper is not automatically unreached** — `isRetryableWriteError` has one site,
  placed where it covers every branch. Check where the site *sits* before counting it.
- **Test what the repo says about itself.** A comment, a doc header or a prior review's praise is a
  claim with a worked example in it; send it. Four of this session's findings came out of that.
- **Pair every refusal with a control**, and **assert the payload beside the rendered text**. A 4xx
  usually names a *different* missing field; "the card shows 50" is not a finding but "the route says
  `hasData: false` and the card shows 50" is.
- **Choose fixtures hostile to the arithmetic, and sweep the input range.** A 100 kg starting 1RM puts
  every common percentage on a plate boundary and reports zero drift for a mechanism that moves 13%.
- **Count requests by the DATE they carry, not how many there are.**
- **Ask what the READ joins before calling a stored cross-user reference a leak** (RV-32 vs RV-42).

- **The zero-data account reaches a state nothing else can** — the seeded user has data for
  everything, so a fabrication is invisible there. Re-run it whenever a scoring surface changes.
- **Import the shipped module; never re-implement the formula you are auditing.** A throwaway vitest
  file inside the package is the way in — there is no build output, `npx tsx` is absent, and vitest
  swallows `console.log`, so write to a file and `cat` it.

- `pnpm install --frozen-lockfile` first if `node_modules` is missing (`@sentry/nextjs` failing to resolve
  is the tell), then `pnpm db:local`, then **`env -u DATABASE_URL -u DATABASE_SSL pnpm dev`**. Both vars are
  pre-set to production in the container and Next will not let `.env.local` override an already-set
  `process.env` var — without the `env -u` the dev server silently tries production and fails.
- Launch the dev server with `nohup … &` through a **background** Bash call. A `(cmd &)` subshell gets
  reaped when the tool call returns.
- API sweeps: sign in with `curl` via `/api/auth/csrf` → `/api/auth/callback/credentials`
  (`test@local.dev` / `testpass123`) into a cookie jar. A second account is two minutes — copy the
  seeded `password_hash` onto `zero@local.dev` with `is_active = true`; **without `is_active`,
  sign-in 302s to a null session**, which reads like broken login and is the invite gate working.
- Screens: temporary specs in `e2e/`, run against the already-running server with
  `E2E_BASE_URL=http://localhost:3000` **and `DATABASE_URL=…` set** (`zero-data.setup.ts` fails loudly
  without it, before your spec runs). **Delete the spec and `test-results/` before committing.**
- **This container's clone is SHALLOW.** *"refusing to merge unrelated histories"* and an empty
  `git merge-base` mean the fetch did not reach past the shallow boundary, not divergence.
  `git fetch --unshallow origin` fixes it. Never `--allow-unrelated-histories`.
- **`get_check_runs` returning `total_count: 0` has a third cause, and it is the likeliest one here.**
  `CLAUDE.md` names a stale base; the PR field to read is **`mergeable_state`**. `dirty` means a merge
  conflict, and **GitHub runs no PR checks at all while it cannot compute the merge commit** — so a
  conflicted PR looks exactly like CI that never fired. Sweep 40 lost fifteen minutes to this with a
  base that was provably current (`git merge-base --is-ancestor origin/main HEAD` passed). Resolve the
  conflict and the checks start within seconds; `unstable` means mergeable with checks still running.
  **Check `mergeable_state` before waiting on anything.**
- **Crossing local midnight is one Playwright call** — `page.clock.install({time})`, `fastForward`,
  dispatch `visibilitychange`. `faketime` neither helps nor is needed.
- **`page.goto()` is a HARD navigation and makes every screen look broken:** React cleanup never
  runs, so nothing saves its scroll offset. Drive a real in-app click, and assert the precondition —
  a screen with nothing to scroll fails identically to a broken one.
- **Assert every probe reached a real route.** Next's HTML 404 for an unmatched path is indistinguishable
  from an access-control rejection by status alone — the tell is the body, HTML vs JSON. A 405 means the
  route is real and the verb is wrong; check the handler before concluding anything.
- **Read the row back out of Postgres.** A 2xx cannot distinguish "did it" from "ignored it safely";
  a body echoing your input proves nothing about what was stored. This is what produced RV-45.
- **Expect your probe to be wrong in the direction of your hypothesis.** Sweeps 36–39 produced four
  measurement errors, each plausible and publishable as written. **Corroboration between two weak
  signals is not evidence when they can fail for the same reason.**
- First-visit renders are confounded by Turbopack compile time; re-check warm before believing sparse.
- **Before the docs compaction chore, check the open-PR list** — whole-directory, done in duplicate
  twice. Cite the review/handoff doc, never the loose journal entry.

## Where the earlier sweeps live

All eleven pillars have been reviewed at least once. Read the write-ups by *subject* through
`docs/domains/*/README.md`, not in sweep order.
