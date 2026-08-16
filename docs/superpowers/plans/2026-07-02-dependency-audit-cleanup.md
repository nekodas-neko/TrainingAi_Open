# Dependency Audit Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is deliberately mechanical — no code reasoning required; every decision is pre-made below.

**Goal:** Clear the GitHub Dependabot alerts (banner says 55; the deduplicated lockfile reality is **19 unique advisories: 10 high, 8 moderate, 1 low**) by pinning patched transitive versions via `pnpm.overrides`.

**Architecture:** All 10 highs are dev-toolchain transitives in just three packages — `tar`/`node-tar` (6), `minimatch` (3), `tmp` (1). The production-only audit (`pnpm audit --prod`) has **zero highs** (4 moderate + 1 low: `postcss` via next, `protobufjs` via `@google/genai`, `esbuild` via drizzle-kit→tsx, PrismJS via the syntax highlighter, plus uuid/js-yaml/node-tar instances). So this is hygiene, not an emergency: fix by adding `pnpm.overrides` to `package.json`, regenerate the lockfile, and verify nothing in the toolchain broke.

**Tech Stack:** pnpm only (Railway deploys `pnpm install --frozen-lockfile` — `package.json` and `pnpm-lock.yaml` MUST be committed together or the deploy fails).

**Known patched thresholds (from the audit run on 2026-07-02):** `postcss >=8.5.10` (GHSA-qx2v-qp2m-jg93), `protobufjs >=7.6.3` (GHSA-f38q-mgvj-vph7), `esbuild >=0.28.1` (GHSA-g7r4-m6w7-qqqr). The tar/minimatch/tmp/prismjs/uuid/js-yaml patched versions come from the fresh audit output in Task 1 (advisory data moves; don't trust stale numbers).

---

### Task 1: Capture the current state

**Files:** none (read-only)

- [ ] **Step 1:** Create a feature branch: `git checkout -b security/dependency-overrides origin/main` (fetch main first).
- [ ] **Step 2:** Run and save the full audit:

```bash
pnpm audit > /tmp/audit-before.txt 2>&1; tail -2 /tmp/audit-before.txt
```

Expected: `19 vulnerabilities found` / `Severity: 1 low | 8 moderate | 10 high` (counts may drift slightly as advisories update — that's fine, the fresh output is the source of truth).
- [ ] **Step 3:** For each advisory table in `/tmp/audit-before.txt`, note the `Package`, `Patched versions`, and `Paths` rows. This is the checklist for Task 2.

### Task 2: Write the overrides

**Files:**
- Modify: `package.json` (add/extend the `pnpm.overrides` key)

- [ ] **Step 1:** Try the automated path first:

```bash
pnpm audit --fix
```

This writes `pnpm.overrides` entries into `package.json` for every advisory it can resolve. Inspect the diff: `git diff package.json`.
- [ ] **Step 2:** Cross-check the written overrides against Task 1's checklist. Any advisory `pnpm audit --fix` did NOT cover gets a manual entry in `package.json` using the advisory's patched range, e.g.:

```json
"pnpm": {
  "overrides": {
    "postcss@<8.5.10": ">=8.5.10",
    "protobufjs@<=7.6.2": ">=7.6.3",
    "esbuild@>=0.27.3 <0.28.1": ">=0.28.1"
  }
}
```

(Exact keys per the fresh audit output — the versioned-key form scopes the override to only the vulnerable range, which minimizes blast radius.)
- [ ] **Step 3 — pre-made decisions for the known sticky ones:**
  - **PrismJS (moderate, DOM clobbering):** `react-syntax-highlighter` pins an old Prism. If overriding `prismjs` to the patched version makes `pnpm install` or the build fail, REMOVE that override and instead add a one-line note to the "Deferred" section of this file (Task 5). Do not attempt to swap the highlighter library — out of scope.
  - **tar / minimatch / tmp:** if the patched version is a new major and something in the install/build chain rejects it, scope the override to the failing path only (e.g. `"drizzle-kit>tsx>esbuild": ">=0.28.1"`) rather than fighting it globally.
- [ ] **Step 4:** Regenerate the lockfile: `pnpm install` (NOT `npm install`). Confirm both files changed: `git status` shows `package.json` AND `pnpm-lock.yaml`.

### Task 3: Verify nothing broke

- [ ] **Step 1:** `pnpm audit > /tmp/audit-after.txt 2>&1; tail -2 /tmp/audit-after.txt` — expected: 0 high, ideally ≤2 remaining (the accepted PrismJS deferral).
- [ ] **Step 2:** `pnpm lint` → passes. `npx tsc --noEmit` → passes.
- [ ] **Step 3:** `pnpm test` → all suites pass (372+ tests).
- [ ] **Step 4:** `pnpm build` → completes. This is the critical check — postcss/esbuild sit in the build chain.
- [ ] **Step 5:** `pnpm db:local && pnpm dev` — load `/` and `/health` once (migrations apply, pages render, no console errors). Drizzle-kit uses the esbuild path; the dev boot exercises it.

### Task 4: Commit and PR

- [ ] **Step 1:**

```bash
git add package.json pnpm-lock.yaml
git commit -m "Pin patched transitive dependencies to clear audit advisories

All 10 high-severity advisories were dev-toolchain transitives
(tar, minimatch, tmp); production deps had zero highs. Pinned via
pnpm.overrides scoped to the vulnerable ranges."
git push -u origin security/dependency-overrides
```

- [ ] **Step 2:** Open the PR (title: "Pin patched transitive deps (Dependabot cleanup)"). Body: the before/after audit totals from Tasks 1/3 and any deferred items.
- [ ] **Step 3:** Let CI run. **This PR changes the lockfile → it deploys code — ask the user before merging** (it is NOT exempt like a docs PR).
- [ ] **Step 4:** After merge, confirm the Dependabot count dropped on github.com/nekodas-neko/TrainingAI/security/dependabot (it re-scans on push to main; allow a few minutes).

### Task 5: Record any deferrals

- [ ] If anything was deliberately left unfixed (expected candidate: PrismJS), append a line to `docs/planned_upgrades.md` Batch D with the package, advisory link, why it was deferred, and the follow-up (e.g. "revisit when react-syntax-highlighter releases against Prism 2").

## Self-review

- Every step is a command with an expected outcome — no code reasoning required. ✔
- pnpm-only, lockfile+manifest committed together (Railway frozen-lockfile rule). ✔
- Merge gate: explicitly NOT exempt (deploys code). ✔
- Out of scope: replacing `react-syntax-highlighter`; upgrading direct deps to new majors; the `next-auth@5-beta` GA tracking (noted in Batch D).
