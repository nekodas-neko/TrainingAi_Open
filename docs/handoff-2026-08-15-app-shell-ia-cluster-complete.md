# Handoff — the 2026-08-14 UI/flow/IA cluster, worked to completion (Q-232 … Q-244)

**Written:** 2026-08-15 · **Domain:** `app-shell` (secondary: `nutrition`, `devices`, `platform`)
**Branch:** `claude/ia-cluster-app-shell` · **11 PRs merged**, v1.307.2 → v1.314.0
**Supersedes:** [`docs/handoff-2026-08-14-app-shell-ia-cluster-delegation.md`](handoff-2026-08-14-app-shell-ia-cluster-delegation.md) — that document is the coordination contract this session worked under, and its lane is now closed.

---

## The lane is finished, and its files are released

The delegation handoff held `app/more/**`, `components/more/**`, `components/profile/**`,
`app/admin/**`, `app/overview/**`, `app/nutrition/nutrition-content.tsx`,
`app/health/health-content.tsx`, `lib/health-card-order.ts`, `components/config-screen.tsx` and
`components/shell/tabs.ts` for this lane. **Nothing is held any more.** Lane A can take them.

Q-187's UI half was deliberately held back until Q-237 landed. Q-237 has landed.

## What shipped

| PR | Version | Item |
|---|---|---|
| #1343 | 1.307.2 | **Q-238** Health card order/hide mechanism deleted |
| #1347 | 1.307.3 | **Q-242** one canonical TTL per cache key + a CI check |
| #1354 | — | **Q-236** `/overview` and its orphan chain deleted |
| #1357 | — | **Q-244** hex-literal ratchet |
| #1358 | — | **Q-232** plan · **Q-239** decisions · **Q-256** filed |
| #1359 | 1.309.0 | **Q-233** `/more/devices` |
| #1360 | 1.310.0 | **Q-232 step 2** `/more/data` + `/more/about` |
| #1361 | 1.311.0 | **Q-232 step 3** `/more/settings` |
| #1362 | 1.312.0 | **Q-235 + Q-256** `/program` |
| #1363 | 1.313.0 | **Q-234** admin split by audience |
| #1366 | 1.314.0 | **Q-237** Nutrition action row |

`components/more/profile-tab.tsx`: **845 → 465 lines**, off the `check-component-size.js` baseline
(6 hotspots → 5). Custom Rules: **33 → 35 steps**.

## Decisions made, so they are not re-litigated

- **Q-238 — deleted, not built.** Git showed the customiser UI existed (`0376da61`), was removed the
  next day on purpose (`4e9ecffd`), and the orphaned file was swept as dead (`73d6d0c3`) while the
  helpers and readers stayed. Rebuilding it would re-add what was removed. Deleting the readers too
  fixed a half nobody had noticed: a card hidden in that one-day window could never be un-hidden.
- **Q-236 — the `/sheet/[id]/*` shims were NOT deleted**, though the entry says to. See Q-255.
- **Q-239 — five of six screens are "leave".** Only the `/admin/*` trio was misplaced, and Q-234
  moved it. The decision table is in the plan's §6 so the next reachability sweep does not re-open it.
- **Q-234 — `exercises`/`activities` stayed on `/admin`.** The plan names them under neither
  audience; they are content administration, not device diagnostics.
- **Q-237 — "Log Food" was not added** even though the plan's row names it. No global log-food
  action exists, and creating one needs a meal-type rule (clock time? next unlogged? picker?) that a
  placement change should not invent. Filed as **Q-257**.
- **Q-232 step 2 was split from step 3.** About/Data had to separate in one commit because they were
  one block; Settings shares no state with either and would have made one PR touching ten toggles,
  two collapsibles and three sync handlers.

## Open, and why

- **Q-255 — needs the owner.** The `/sheet/[id]/*` shims were kept on 2026-08-10 *because* they were
  "the only inbound path to `/chat`" — and `#1293` deleted `/chat` three days later on a separate
  decision. The rationale is void; the decision is the owner's. All three have **zero** in-app
  referrers (re-measured 2026-08-15). One question: is any bookmark or home-screen shortcut still
  using them?
- **Q-257 — needs a product call** on how a global "Log Food" picks its meal type.
- **Q-232-followup** — Achievements & Stats and Goals are still inline on More. Cosmetic now that the
  file is under the size limit, and arguably content the owner wants on the surface. Ask first.
- **Q-239** stays filed until Q-234's promotion is confirmed on device, then strike it.
- **Q-243** (water over-invalidation) is the cluster's last caching item and is untouched.

## Gotchas that cost time

- **`pnpm build` and `pnpm dev` share `.next`.** Running the build while dev is up leaves every
  route 500ing with `Cannot find module '../chunks/ssr/[turbopack]_runtime.js'` or a missing
  `_buildManifest.js.tmp`. It reads exactly like the change under test broke the app.
  `rm -rf .next` and restart. Cost time twice.
- **A check firing on a comment is the check being right.** The Custom Rules safe-area step failed on
  prose containing `env(safe-area-inset-bottom)`, and two test assertions failed on comments
  describing the very bugs they guard. Reword the comment (or strip comments in the test); do not
  weaken the check.
- **`isAdminUser(id, flag)` returns the JWT flag whenever it is a boolean** and only reads the DB
  when it is undefined. Flipping `users.is_admin` changes nothing until a fresh login.
- **A guard can pass while the thing it guards is broken.** The Q-256 forwarding assertion checked
  that `searchParams`/`URLSearchParams` *appear* in the file; a mutation keeping both and setting the
  suffix to `''` — dropping every param — passed it. Only mutation testing found that. It calls the
  route and reads the `NEXT_REDIRECT` digest now.
- **`/session-select` is not Home.** It is a legacy redirect onto the Workout tab, and it is the
  manifest's `start_url`. Real Home is `/`. Following the redirect in a browser is what caught it.
- **CI runners were badly degraded for ~an hour** (`pnpm lint` taking 15 min against ~1 min locally,
  one run stalling entirely). `total_count: 0` seconds after a push is normal; minutes after is a
  stale base. Confirm a stuck job with `get_workflow_job` before diagnosing.
- **Q-number blocks get eaten mid-session.** The reserved 248–269 block lost 248–254 to two other
  PRs while this lane worked. Re-check the pointer *and* the open-PR list at push time.

## Not device-verified — the whole cluster

Nothing here was seen on the S25. The concentrated risk:

- **Seven new navless takeover screens** (`/more/{devices,settings,data,about}`,
  `/more/settings/developer` ×4, `/program`) all use `pb-safe-action-lg` via
  `components/more/sub-screen.tsx`, and every one ends in tappable controls. The sandbox renders
  insets as **0**, so that clearance is unproven everywhere at once.
- **`BackgroundLocationCard` cannot render off-device**, so the Permissions half of `/more/devices`
  has never been seen.
- **The push toggle** needs a real service-worker registration and permission prompt.
- **`pullDelta` / `restoreFromCloud` native branches** never ran — the sandbox exercises only the
  web fallback. Restore has never executed here at all.
- **The status-bar pill's read side**: the preference writes are proven (`ta_pref_rest_chip` was read
  back out of `localStorage`), the native consumption is not.

`docs/device-smoke-checklist.md` is the concrete step. Every one of these has a ⚠️ row in
`projectOverview.md`.

## Pickup prompt

```
You are an implementer session on the TrainingAI repo. Start on a branch cut from a freshly-fetched
main: git fetch origin main && git remote prune origin && git checkout -B <descriptive-branch> origin/main

Read in this order:
1. projectOverview.md — current status and the live Known Issues tables.
2. docs/handoff-2026-08-15-app-shell-ia-cluster-complete.md — the 2026-08-14 UI/flow/IA cluster was
   worked to completion; this records what shipped, what was decided and why, and what is left.
3. docs/domains/app-shell/README.md.
4. docs/superpowers/plans/2026-08-14-more-tab-information-architecture.md — the target structure,
   fully built. Do not re-derive it.

The 2026-08-14 review cluster (Q-232…Q-244) is DONE except Q-243. Its file ownership is released —
app/more/**, components/more/**, components/profile/**, app/admin/**, app/nutrition/nutrition-content.tsx,
components/config-screen.tsx and components/shell/tabs.ts are free. Q-187's UI half was waiting on
Q-237, which has landed.

Take the backlog top-down. Three items came out of the cluster and are queued:
  - Q-255 needs the OWNER, not code: the /sheet/[id]/* shims were kept because they were the only
    inbound path to /chat, and /chat was deleted three days later. Ask the question in its entry;
    do not delete them unilaterally.
  - Q-257 needs a product call on how a global "Log Food" action picks its meal type.
  - Q-232-followup is cosmetic and worth asking about before building.
Q-239 stays filed until Q-234's console promotion is confirmed on device, then strike it.

Constraints that will otherwise be rediscovered:
  - pnpm build and pnpm dev share .next. Building while dev runs makes every route 500 with
    "Cannot find module '../chunks/ssr/[turbopack]_runtime.js'". rm -rf .next and restart.
  - pnpm check:rules is the custom-rules gate and now runs 35 steps. Quote the count it prints.
  - A check or test failing on a COMMENT is the check being right — reword the comment.
  - Every new test must be mutation-verified against the unfixed code. An assertion that names the
    right identifiers can pass while the behaviour is broken; that happened this session.
  - Nothing in the cluster is device-verified. Seven new navless screens rely on pb-safe-action-lg
    and the sandbox renders insets as 0. If you have the S25, run docs/device-smoke-checklist.md
    against /more/devices, /more/settings, /more/settings/developer, /more/data, /more/about and
    /program before adding more of them.
```
