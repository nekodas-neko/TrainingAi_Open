# 2026-09-17 — BF-100's spec can now tell cancelled from imprecise (`fix/bf100-spec-coarse-restore-assert`)

**Lane B · test-only · no version bump — nothing user-visible changed**

## What this fixes

`e2e/scroll-restoration.spec.ts` asserted `toBe(before)` — an **exact** scroll offset — in both of
its restoration cases. BF-100's entry had recorded this as a second finding and left it: *"an
exact-offset assertion cannot tell cancelled from imprecise, which is precisely the distinction
BF-100 turns on."*

Reproduced before touching it, on clean `main`: **saved 718, restored 1019**, red — while
restoration was working correctly. These screens seed from cache and then revalidate, so the content
keeps growing between the save and the restore, and the offset that was right when saved is not the
offset showing the same content a second later.

## The change

Both cases now call `expectRestoredNear`, which asserts a **floor** at 90% of the saved offset.

**The lower bound is what carries the meaning.** A cancelled restore leaves the container at 0 — a
fresh arrival starts at the top by construction, which the file's third test pins — so 0 against a
saved 718 still fails loudly. What it no longer does is fail because the page grew.

**No upper bound, deliberately.** Capping re-introduces the same flake from the other side, and
overshooting because content grew above the anchor is not a defect this file is about.

## Proven both ways

- **Content growth:** 5 passed, where the same run was 1 failed / 4 passed before the change.
- **Cancellation:** with the restore neutered (`el.scrollTop = 0` in `use-scroll-restoration.ts`),
  both cases fail naming it — *"/more: restored to 0 against a saved 879 — at or near 0 means the
  restore was CANCELLED"*. The hook was restored immediately; `git diff` on it is empty.

Without that second run this would be an assertion loosened until it stopped complaining, which is
the shape this repo forbids.

## Why it was worth doing while BF-100 itself is device-blocked

BF-100's open question is whether the S25 *cancels* the restore. The file that would answer it could
not distinguish a cancelled restore from an imprecise one, so a red run said nothing useful and a
green one said only that the numbers happened to match. It can answer now, which is what the device
pass needs.

## Not done

- **BF-100 itself is untouched and stays in the queue.** Its core is a device-only failure: the
  harness restores 840 correctly and the S25 does not. Nothing here changes that.
- **No version bump or changelog entry** — test-only, nothing user-visible.
