# 2026-08-10 — the rest of the dead-code sweep, and the cascade it exposed (Q-136)

**Branch:** `chore/dead-code-sweep` · **Domain:** `platform`, `app-shell` · no version bump
(nothing user-visible: none of this was reachable)

Q-136's mechanical deletions were done in an earlier session. Four decisions were left for the
owner. They answered: delete three, keep the shims.

## Deleted, each re-verified unreferenced first

| what | lines | why it was dead |
|---|---|---|
| `app/health/timeline/page.tsx` | 151 | Zero inbound links since the day it was added. `git log -S'/health/timeline' --all` shows no commit ever added one — orphaned at birth. |
| `app/api/sync/oura-timeseries` (+ its route test) | 52 + test | The client driver was never written; `sync-engine.ts` says so in a comment. |
| `app/api/oura/webhooks` | 69 | Admin GET/POST/DELETE over Oura webhook subscriptions, no UI ever built. Registration happens automatically at `oura/callback:66`. |

**Kept, as decided:** the `/sheet/[id]/*` shims. They look like dead redirects and are the reverse —
the only inbound path to `/chat`, whose `components/chat.tsx` is the sole caller of
`/api/ai-chat/tts`. Deleting them strands a whole TTS route.

**The near-miss worth naming:** `app/api/oura/webhook` (singular) is the actual webhook *receiver*
and sits one character from `webhooks` (plural), the admin CRUD that was deleted. Checked
explicitly rather than pattern-matched. Confirmed after: the receiver still answers, returning
**400** to an unsigned POST — fail-closed, as it should.

## The cascade I did not take unilaterally

Deleting `app/api/sync/oura-timeseries` removed the **only** caller of `repo.getOuraTimeseriesDelta`.
Still present and still passing: the keyset-cursor implementation in `slices/oura.ts`, its adapter
delegate, its `repository.ts` entry, and `oura-timeseries-pull.test.ts` — **142 lines of DB-backed
tests**.

The owner answered a question about *routes*. Deleting ~350 lines of working, tested infrastructure
on the back of that would be reading more into the answer than it said — and that DB layer is
precisely what the never-written client driver would need. So the route is gone, the DB half stays,
and the choice is filed as **Q-180** with both options and the question that decides them: is the
device ever going to restore intraday HR from the cloud, or is the on-device rolling window the
answer instead?

`sync-engine.ts`'s comment, which pointed at the route as though it were coming, now says the route
is gone and points at Q-180.

## Verified

- `tsc --noEmit` clean · **434 files / 3451 tests** green · all 17 custom-rule scripts pass.
- Against the running server: `/api/oura/webhooks` → **404**, `/api/oura/webhook` → **400** (alive,
  rejecting an unsigned POST), `/health` still routes.

## A numbering note, third time today

The backlog's "next free Q number" said **178**. It was taken — by a soft-delete sweep that merged
mid-session — and so was **179**. The follow-up is **Q-180**.

That pointer has now been wrong three times in one day. It is maintained by hand in a file several
agents edit concurrently, so it is structurally a lagging indicator. **Read the headings, not the
pointer** — the line now says so itself.

## Not exercised

Nothing runtime-facing changed for a user: every deleted path was unreachable. `/health/timeline`
returns the auth redirect rather than a 404 for a signed-out request, so its removal is evidenced by
the file being gone and the build passing rather than by a 404 — worth stating, since a 307 alone
would not have distinguished "deleted" from "still there".
