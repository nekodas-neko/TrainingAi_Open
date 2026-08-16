# Agent Rules — TrainingAI

## Code Quality & Scope

- Do not add features, refactor, or introduce abstractions beyond what the task explicitly requires.
- Do not add error handling for scenarios that cannot happen — trust internal code and framework guarantees.
- Default to writing no comments. Only add one when the **why** is non-obvious (a hidden constraint, subtle invariant, or surprising behaviour). If removing it wouldn't confuse a future reader, skip it.
- Prefer editing existing files over creating new ones.

---

## Safety & Reversibility

- Never force-push, `reset --hard`, or run any destructive git operation without explicit user confirmation.
- Never skip hooks (`--no-verify`) — investigate the failure and fix the root cause instead.
- Never commit secrets, `.env` files, or credential files under any circumstances.
- Confirm with the user before any action that affects shared systems: pushing code, creating/closing PRs, posting comments, or sending messages.

---

## Git Workflow

- Never commit directly to `main`. Always develop on a feature branch and merge when complete.
- Write commit messages focused on **why** the change was made, not what changed (the diff already shows that).
- Run tests and lint before committing. If they fail, fix them — don't bypass.

---

## Communication

- State in one sentence what you are about to do before doing it.
- Report blockers clearly rather than silently working around them.
- Ask before taking any irreversible or wide-blast-radius action — the cost of pausing is always lower than the cost of an unwanted action.

---

## After Every Change — Local Testing Instructions

After making any change, provide the following:

**1. Pull command** — give the exact command to fetch the latest changes locally:
```bash
git pull origin <branch-name>
```

**2. What to look for** — specify exactly:
- Which page, component, or API route is affected
- What the expected visible or behavioural change is
- Any edge cases or regressions to check (e.g. adjacent features that touch the same state or UI)

**3. How to test it** — give step-by-step instructions appropriate to the change, for example:
- Which URL to open and what action to take
- What the correct outcome looks like vs. a broken outcome
- Any specific device/viewport to test on (this app targets Samsung Galaxy S25 Ultra)

---

## Project-Specific Rules

- **Session start**: Read `projectOverview.md` before doing anything. Use it to orient — it tracks past changes, known issues, and planned work.
- **Session end**: After committing and merging to `main`, update `projectOverview.md` with a summary of what was done, any new known issues, and what is planned next.
- Keep components small. Split code into focused files and avoid long single files.
- Never push to a branch other than the designated session branch without explicit user permission.
