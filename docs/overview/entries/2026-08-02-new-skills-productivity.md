## 2026-08-02 — Four new repo-local skills: stop-slop, ui-ux-pro-max, task-observer, find-skills

The owner asked to evaluate four community skills for productivity. All four exist upstream; each
was adapted rather than vendored, and all four are committed under `.claude/skills/` so they are
present in every ephemeral session (a user-level `/plugin install` is not — the container re-clones
the repo each time).

### What shipped

| Skill | Upstream | What the local version does |
|---|---|---|
| `stop-slop` | [hardikpandya/stop-slop](https://github.com/hardikpandya/stop-slop) (MIT) | Strips AI writing tells from the prose this repo actually ships: handoff docs, journal entries, `projectOverview.md` rows, PR bodies, commit messages, `lib/changelog.ts`, UI copy. `references/phrases.md` + `references/structures.md` carry the lists. |
| `ui-ux-pro-max` | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | 29 priority-ordered rules bound to this app's own design system, S25 APK as the canonical target. `references/audit.md` is a runnable audit checklist. |
| `task-observer` | [rebelytics/one-skill-to-rule-them-all](https://github.com/rebelytics/one-skill-to-rule-them-all) (CC BY 4.0) | Converts session lessons into backlog entries, Known-Issues rows, CI checks and CLAUDE.md rule *proposals*. |
| `find-skills` | No canonical upstream under that name | Routing table from task → skill / slash command / doc, plus the `docs/domains/` and `docs/module-map.md` routing. |

### Decisions and why

**`ui-ux-pro-max` was rewritten, not vendored.** Upstream ships a generic database — 67 UI styles,
161 palettes, 57 font pairings. CLAUDE.md bans hex literals in favour of the OKLCH `--accent-*`
tokens in `app/globals.css`, and the repo already carries `mobile-app-design-standards` and
`mobile-app-ui-design`. A generic palette recommender would emit code that fails review and
duplicate two existing skills. The local version keeps upstream's priority-rule structure and
replaces the database with the repo's real one: the four CI-enforced grep rules, the floored
safe-area utility table (`pb-safe-action` vs `pb-safe-action-lg` vs `bottom-nav-safe`), the sheet
inset ownership rules, the Samsung WebView nested-control constraint, the 29-item
`components/ui/` primitive inventory, and the instant-paint/memo/timer performance rules. Every
rule cites the failure it prevents.

**`stop-slop` deviates from upstream on em dashes.** Upstream bans them outright. This repo's entire
doc corpus uses them as house style, so a blanket ban would be ignored on sight. Scoped: allowed in
`docs/` and `CLAUDE.md`, kept out of UI copy and changelog entries. Also added an explicit
precedence rule — CLAUDE.md's honesty requirements outrank style. Tighten the prose, never the
truth.

**`task-observer` feeds existing rituals rather than its own log** (owner's call). Observations route
to `docs/implementation-backlog.md`, `projectOverview.md` Known Issues, `docs/domains/<pillar>/`,
`docs/module-map.md`, or a CI check — no `docs/observations/` surface to go stale. It ranks a CI
check above a prose rule whenever the violation is grep-able, on the evidence that the safe-area,
push-mutations and PPL-session-name rules stopped recurring only after they graduated from CLAUDE.md
into `.github/workflows/ci.yml`. It is also barred from editing CLAUDE.md unprompted.

### Verification

`node scripts/check-doc-links.js` passes (683 files). Every path and symbol cited across the four
skills was checked to exist: `docs/domains/README.md`, `docs/module-map.md`,
`docs/device-smoke-checklist.md`, `docs/oura-ble-operations.md`, `components/dynamic-background/`,
`components/health/detail-hero.tsx` (`HERO_GRADIENTS`), `components/ui/dismissible-banner.tsx`,
`components/shell/bottom-nav.tsx`, `lib/cache-groups.ts` (`clearLegacyHomeSeeds`), `resolveColor`,
`useElapsedSec`, `useCountUp`, `STAGE_COLOR`, `scoreBand`. The safe-area utility values in the
`ui-ux-pro-max` clearance table were read out of `app/globals.css`, not recalled.

Every grep in `references/audit.md` was executed against the tree. They return clean or return real
hits — the oversized-file grep returns exactly the hotspots CLAUDE.md names, plus one it does not
(see below).

**Not exercised:** nothing runtime. This PR is `.md` files under `.claude/skills/` plus this entry —
no app code, no dependency, no schema. Skill *quality* is only observable in use over subsequent
sessions; it cannot be verified by CI.

### CLAUDE.md corrections (owner-approved, in this PR)

Found by checking the skills' citations rather than trusting them.

1. **`scoreBand()` was documented at `lib/health/score-band.ts`. That file does not exist.** It lives
   at `packages/shared/src/health/score-band.ts` and is imported as
   `@trainingai/shared/health/score-band` at all 17 call sites. `lib/health/` exists but holds only
   `daytime-stress.ts` and `stress-resilience.ts`, and there is no re-export. Path corrected, with
   the import specifier and call-site count recorded so the claim is checkable.

2. **The sparkline count was re-verified and CLAUDE.md was closer to right than the first pass
   claimed.** A raw `grep -rn '<polyline'` returns eight, which is what the initial review reported —
   but three of those are not bypasses: `components/ui/sparkline.tsx` is the primitive itself,
   `components/health/detail-hero.tsx` is decorative hero art (`absolute inset-0`,
   `pointer-events-none`, 400×260 viewBox), and `components/workout/live-hr-chart.tsx` is a
   time-series chart with its own axis logic. The real figure is **five**. CLAUDE.md said six.
   The line now names all five files and records why the naive grep over-counts, so the next reader
   does not re-raise it.

3. **`components/more/profile-tab.tsx` (849 lines) was over the ~800-line limit and absent from the
   named hotspot list.** Added, along with the `find … | awk '$1 > 800'` command that regenerates the
   list, so it self-checks instead of drifting again.

The first pass reported item 2 as "the grep now returns eight" without separating the primitive and
the decoration from the actual bypasses. That was a raw count presented as a like-for-like one.
Corrected above before the edit landed.

### No version bump

No user-visible app change — agent tooling only.
