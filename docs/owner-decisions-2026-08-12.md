# Owner decisions, 2026-08-12

_Rescued from pull request #1281 on the archived private repository, which was open for five days and
could never be merged once that repo was archived on 2026-08-17._

**Why this is a record rather than backlog edits.** #1281 appended each decision to the queue entry it
governed. The backlog moved for five days underneath it — entries were resolved, removed and
renumbered — so re-applying those hunks now would mean guessing where stale text belongs, and in at
least one case attaching a "do this" note to work that has since shipped. The decisions themselves are
durable and worth keeping verbatim; their placement was not.

**Status was checked per decision against the tree**, not assumed. Three of the five are already
reflected; two are still live.

---

## 1. Prescription basis: use the last non-deload session ⚠️ still live

Asked to choose between a per-exercise reset, a global switch and a time-boxed one, the owner rejected
the framing:

> *ideally it should give you recommendations based on your last non deload lift.*

There is no override to build. `resolveWorkingBasis()` should prescribe from the **last non-deload
session** rather than `Math.max(lastLog1rm, seedEstimate, allTimePr1rm)`.

**The trade-off was put explicitly and taken.** The all-time-PR floor exists so an easy day never
lowers targets; going strictly by the last session reverses that, and a single light or interrupted
session will lower the next prescription. Offered "best of the last ~3 non-deload sessions" as a
recommended middle, the owner chose **strictly the last non-deload session**. Implement that, not the
smoothed version.

Scope that follows: deload sessions are excluded from the lookup; the all-time PR **record** stays
untouched — this changes the prescription basis only; and `seedEstimate` is still needed for an
exercise with no logged non-deload session yet.

## 2. During an ai_dynamic deload, lighten every exercise ⚠️ still live

Every exercise in the session gets the deload reduction, prescribed by the AI or not. The owner was
told this is the largest-behaviour-change option and that deload weeks will feel noticeably easier
than they do now, and chose it anyway. Apply `deloadOverrideForGoal` to the resolved base style for
exercises the prescription does not name, so the reduction no longer lives only inside
`if (aiDrivesLoad)`.

Still referenced as an open constraint by the backlog — the Q-211 entry cites "a path the owner's
decision did not cover", which is this one.

## 3. Delete the legacy chat surfaces, and drop text-to-speech with them ✅ shipped

The entanglement was resolved rather than worked around: TTS did **not** move to Coach. Read-aloud was
reachable only from a screen nothing linked to, so it had already been unusable for some time.

Shipped as Q-189 — `app/chat/` and `app/api/ai-chat/` are gone from the tree, and `GEMINI_API_KEY` is
documented in `CLAUDE.md` as no longer read by anything.

## 4. Readiness: re-tune the four stuck contributors ✅ recorded

Option (a), narrowed. Not a global rescale, and not a separate "felt vs scored" signal. Re-tune or
down-weight `hrv`, `hr`, `schedule` and `latency` so they stop sitting at their ceiling and diluting
the six that already track the owner's experience. The owner was told their nightly number will change
and that bad nights will start scoring genuinely low, and accepted that.

**The open sub-question the implementer must still resolve — do not guess:** `hr` and `hrv` are
present on only **39 of 56** scored nights, so the score already means something different on the
other 17. Down-weighting them changes that asymmetry rather than fixing it. Decide and document what a
night with neither contributor should score before shipping.

Already carried in the backlog entry as "option (a), narrowed".

## 5. Device smoke checklist additions ✅ shipped

Three sections — the Q-172 sign-out wipe (which had never actually executed anywhere, because
`clearLocalStoreData()` is a no-op in the browser), the ring-battery/Home-header checks, and the
cold-start measurement. All three are present in `docs/device-smoke-checklist.md`.
