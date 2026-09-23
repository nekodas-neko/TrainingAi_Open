# 2026-09-23 — `fix/dv1-windows-ci-local` (DV-1)

**Orchestrator, Lane O.** The Device Verification agent runs on Windows by definition — next to the
phone — and its prompt makes `pnpm ci:local` the pre-push gate. On 2026-09-23 it could not produce a
clean run for reasons that had nothing to do with its diff, so it shipped on CI alone.

## Three of the four failures were one bug wearing three names

`check-sign-out-clears-device`, `check-e2e-stub-dates` and `check-strict-request-schemas` each walk
the tree with `path.join` and then use the result as a **key** into a table hand-written with
forward slashes. On Windows the walk yields `app\api\x`, the lookup misses, the allowance is not
found, and a baselined file reports as a new violation.

**It is invisible to CI, which is why it survived.** CI is Linux, where `path.sep` is already `/`,
so all three are correct there and always have been. They fail only for a human on Windows — and a
check that cannot pass on the machine that must run it is worse than no check, because it trains
that session to treat its own gate as noise.

One helper now, `scripts/lib/repo-path.js`, used by all three.

## The helper's own test caught the helper

DV-1 specified `.split(path.sep).join('/')`. That is correct for the actual use — normalising a path
*this* platform just produced — and wrong as a helper: on Linux it returns a Windows path unchanged,
so it can only be tested on Windows.

The first draft did exactly that and `scripts/__tests__/repo-path.test.ts` failed on two of five
cases. It now replaces backslashes unconditionally, and the test feeds the Windows shape in
**literally** rather than deriving it from `path.sep` — a test built from this runner's separator
would pass against the broken code. The trade (a POSIX file whose *name* contains a backslash would
be mangled) is documented: these are lookup keys, not paths handed back to the filesystem.

## The fourth could not run on Windows at all

Step 68 shelled out to `grep -rl … | grep -v …`, which under `cmd.exe` dies with *"The system cannot
find the path specified."* It is a Node walk now, **verified to find the identical 28 files** — set
diffed against set, because a rewrite that quietly narrowed the scan would be worse than the bug it
replaced.

Plus `npx` → `npx.cmd` on win32 (named explicitly rather than `shell: true`, which would re-parse
the argument list), and `engines.node` raised to `>=22.12` so a Node mismatch fails at install with
a message rather than at test time with a missing rolldown binding.

## A real defect found while fixing it — OR-130

A full gate run failed once on `app/api/user/goals/route.ts`, a file **byte-identical to `main`**.
The run was not piped, per OR-121's own instruction, so the diagnostic survived and was decisive.

`fileAtBase` in `scripts/lib/base-ref.js` returns `null` for **two different facts** — *"the file
does not exist at the base"* (the branch added it: a real violation) and *"I could not read the
base"* (nothing is known) — and `verdict` maps `atBase === null` to `fail`. This clone is shallow,
so `git show origin/main:<path>` fails transiently, and a read failure is reported as an accusation.
Confirmed by direct call, not inferred.

That matters more than one red run: `base-ref.js` exists so a branch is judged on what it *changed*,
and its own header records the earlier version reading as *"your change was too big"* when the change
was eleven lines. This reintroduces that failure non-deterministically, which is worse — a gate that
accuses at random teaches the reader to stop believing it.

Filed as **OR-130** with the fix and one warning attached: **decide the CI case first.** CI checks
out at depth 1, so if the base is unreadable there too, "do not fail on unreadable" disables the
ratchet everywhere rather than just locally.

## It is also OR-121's second occurrence — and does not close it

OR-121 asked for exactly this: *"the next occurrence settles it."* This one is diagnosed. But it is
a **different script** — the first instance was `check-tz-aware-cache-guards.js`, which does not use
`base-ref` at all. Two flakes of similar shape are not evidence of one cause, and recording them as
one would retire an open question on a resemblance. **The first instance stays unexplained.**

## Not done — and this is the honest headline

**None of this is verified where it matters.** Three of the four bugs are invisible on Linux by
construction, and Linux is all this session has. Every fix is reasoned from the reported failure and
confirmed only where confirmation proves little. DV-1 keeps a `Keep:` naming the one thing that
settles it: `pnpm ci:local` on that Windows machine, unpiped, exiting 0. That is the Device
Verification agent's run, not this one's.

The local machine is also on Node 22.9 against a `>=22.12` floor — the upgrade is the owner's.
