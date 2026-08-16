# Prompt — app review: information architecture, UI flow, caching, and the standing lenses

**Written:** 2026-08-14 · **For:** this session, and re-runnable by a fresh one · **Type:** review, docs-only output

Everything below the rule is the prompt. It was written against `main` at `4a038e0` (v1.306.x):
**39 page routes, 205 API routes**, five bottom-nav tabs, local SQLite v25.

The owner's framing, verbatim: *"i want a good review on the ui and flow/location mainly. there is
alot of pages/settings etc that are just placed randomly (i.e admin tools, more screen, nutrition
buttons) - there should be a better way to organise these to match regular app standards of how
these sections are grouped. alongside that have a look at caching and cache busting as there have
been a few issues. then look at all the other angles we typically look at for security, performance,
ui etc."*

---

## Prompt

You are reviewing TrainingAI with **information architecture as the primary lens** — where things
live, how you get to them, and whether that matches what a person who has used other apps would
expect. Caching/invalidation is the secondary lens. The standing lenses (security, performance,
correctness, UI mechanics) run after those two and are scoped to what is *new* since the
2026-08-07 full-app review, which already swept them.

This is **not** an implementation session. The output is a review document plus one backlog entry
per actionable finding, per *Backlog-driven implementation* in `CLAUDE.md`.

### Read before looking at code

1. `projectOverview.md` Known Issues — ~230 `###` sections. Build the open-row list first so a
   re-discovery is recognisable. Do not re-raise what is already recorded.
2. `docs/implementation-backlog.md` — an already-queued item is not a finding. In particular
   **Q-112** (merge Day in Review + End of Day), **Q-138** (component-size extractions),
   **Q-154** (sparkline primitive), **Q-51** (perf aimed at the wrong screen) and **Q-111**
   (home header device chips) sit close to this review's territory — check each before writing.
3. `CLAUDE.md` — the rule sections *are* the checklist for lenses 3–6.
4. `docs/module-map.md` — before flagging "this should be shared", check whether it already is.

### Lens 1 (primary) — Information architecture: where things live

The complaint is that features are placed where they were built, not where they belong. Test that
claim properly rather than agreeing with it.

**1a. Build the full navigation map.** Every one of the 39 page routes, plus every sheet/dialog that
is really a screen. For each: what is the *only* way a user reaches it? Produce a reachability
count:

```bash
find app -name page.tsx | sed 's|^app||; s|/page.tsx||' | sort
# then, per route, grep app components lib for href/router.push/redirect to it
```

Three classes of finding fall out of this on their own:
- **Orphans** — a real screen with zero in-app entry points. Dead code, or a shipped feature nobody
  can find. Decide which, per screen.
- **Redirect shims** — `/profile`, `/stats`, `/sheet/[id]/*`. Still needed, or removable?
- **Single-entry screens buried behind a scroll** — reachable, but only from one card most of the
  way down a long page.

**1b. Audit each container against the convention it is imitating.** The five tabs are Home ·
Health · Workout · Nutrition · More. For each container, list what it holds and name the *kind* of
thing each item is: identity, gamification, content, a setting, a device pairing, a developer tool,
a destructive action. A container holding four or more kinds is the finding. Name the standard
pattern it should follow instead (iOS Settings-style grouped list, Android Settings sub-screens,
Strava/Garmin "You" tab, Apple Health "Browse"), and say concretely what moves where.

The known trouble spots, to be confirmed rather than assumed:
- **More → Profile** (`components/more/profile-tab.tsx`) — one 845-line scroll.
- **Admin** — a route group plus an entry buried at the bottom of that same scroll, with
  sub-consoles (`/admin/cadence`, `/admin/data-capture`, `/admin/oura-ble`) reachable only from
  inside it.
- **Nutrition** — settings behind a header gear, "Water", "Saved Meals", "End of Day" as loose
  buttons at different scroll depths.
- **Program configuration** — reachable both as `/config` and as More → Workout.

**1c. Cross-container duplication.** The same concept reachable in two places under two names, or
split across two tabs for no reason a user could state. Body weight, HR, activity, and the daily
review are the likely candidates.

**1d. Naming and labels.** Tab and section labels should say what is inside them. "More" is a
container of last resort by definition — measure how much of the app is only reachable through it.

For every IA finding, the deliverable is a **concrete target structure**, not "should be
reorganised". Say which screen each item lands on, what the new screen is called, and what the
migration costs (a moved component, a new route, a redirect for muscle memory).

### Lens 2 (secondary) — Caching and cache busting

Rule: *Cache Invalidation* in `CLAUDE.md` — 12+ incidents, the most-repeated bug class here. The
owner reports "a few issues", so treat this as a live-bug hunt, not a hygiene pass.

- Enumerate every cache key and every writer that changes the data behind it. A key missing from a
  writer's group in `lib/cache-groups.ts` is a stale-UI bug — state the user-visible symptom.
- `invalidateCache(` call sites outside `lib/cache-groups.ts` — each one is a hand-rolled key list,
  which is what the rule forbids. Count them and judge each.
- One canonical TTL per key (`packages/shared/src/cache-ttl.ts`); one fetch variant per key
  (`cachedFetch` xor `cachedFetchToday`); no bare key that is a prefix-sibling of a group prefix.
- Every "today" key embeds the local date **or** guards the date on read — on the seed path *and*
  the `cachedFetch` onData hit path.
- `freshWithinTtl: true` needs a written invalidation proof.
- Cache *busting* across deploys: the service worker's build-stamped cache name, the version/update
  banner, and whether a shipped change can be invisible on a device that is holding an old chunk.
- `Cache-Control` on `app/api` routes must be `private, no-store` (the SWR rule was reversed
  2026-08-10); `scripts/check-api-no-store.js` enforces it — confirm it still passes and that the
  client-side `no-store` bypass is intact in both `cachedFetch` and `public/sw-template.js`.

### Lens 3 — Security and route hygiene

Scoped to routes added or changed since the 2026-08-07 sweep. Per route: authenticated; Zod-validated
at the boundary; client-supplied ids ownership-verified (including tables with no `user_id`, via a
join); affected-row count checked before dependent child writes; no raw body into Drizzle `.set()`;
rate limit on AI/expensive routes; failures surface an error rather than `null`. Admin routes
`requireAdmin`-gated and fail-closed on missing env vars.

### Lens 4 — Performance

Instant paint (seed from cache, never a skeleton on a repeat visit); `React.memo` with stable props;
narrow Zustand selectors; timers in leaves; heavy widgets behind `next/dynamic({ ssr: false })`;
component files under 800 lines (`node scripts/check-component-size.js`); no serial `await` POSTs;
no request waterfalls where one aggregate exists.

### Lens 5 — UI mechanics

Floored safe-area utilities on bottom-anchored controls (`pb-safe-action`, `pb-safe-action-lg`),
never bare `pb-safe`/`env()`; sheets own their inset; no nested interactive elements; theme tokens
over hex literals (report the trend, don't sweep); colour never the only state signal; tap targets
≥48dp. Load the `ui-ux-pro-max` skill for this lens.

### Rules of evidence

1. Every finding carries `file:line`.
2. Re-derive every count in this prompt — they rot.
3. Do not re-raise a recorded Known Issue or queued backlog item. Finding one is *worse* than
   recorded is itself a finding.
4. State the user-visible consequence. "Missing invalidation" is not a finding; "deleting a
   supplement leaves it on screen for 5 minutes" is.
5. Severity by blast radius: silent data loss > wrong number shown as fact > stale/incorrect UI >
   confusing placement > performance > hygiene.
6. Say what you did not check — native SQLite/Capacitor, safe-area on device, Samsung WebView
   rendering, real device pairing, drifted prod data.
7. **No orphaned findings** — every finding gets a backlog entry in the same PR.

### Deliverables (one docs-only PR)

1. `docs/reviews/2026-08-14-app-ui-flow-ia-review.md` — the navigation map, the IA target
   structure, then findings by lens ranked by severity.
2. `docs/implementation-backlog.md` — one entry per actionable finding, tagged by pillar, Q numbers
   claimed from the "Next free Q number" line (check open PRs too).
3. `projectOverview.md` — a Known-Issues row for any finding that is live and user-visible.
4. `docs/overview/entries/2026-08-14-<branch-slug>.md` — the session journal entry.
