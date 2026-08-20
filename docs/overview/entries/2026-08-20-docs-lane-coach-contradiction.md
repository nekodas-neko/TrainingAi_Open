## 2026-08-20 — `lib/coach/` belongs to Lane A, and the queue said otherwise (PS-1)

**Branch:** `docs/lane-coach-contradiction` · docs-only, no version bump.

`docs/agents/README.md` §3 listed `lib/coach/` under Lane A. Q-407's `Lane.` paragraph told whoever
took it that **`lib/coach/**` belongs to neither lane's declared paths** and to claim the directory
in a baton first. Both cannot be true, and the entry is the one an implementer reads — the README §3
list is not consulted once a queue entry has already answered the question.

**The rule settles it, and the trace is unambiguous.** Six routes under `app/api/coach/**` import
the directory (nine imports in total: `widgets`, `tools`, `dangling-widgets`, `patch` ×2, `apply` ×2,
`threads`, `consequences`), and `apply.ts` / `patch.ts` write storage. *Reached by `app/api/**`, or
it reads or writes storage → Lane A* answers it twice over. Q-407's paragraph now says that, says
plainly that its earlier draft was wrong, and no longer sends anyone to claim a path that needs no
claim.

**Two stale references went with it.** The paragraph cited `docs/agents/README.md` §"A path neither
lane lists" — a section that does not exist; the current heading is *Anything not listed — decide it
by the rule, not by the list*. And the README used this exact contradiction as its live illustration
of why an enumeration misleads; it now records it in the past tense with the resolution, which keeps
the illustration honest rather than leaving a fixed contradiction described as open.

**PS-1's own closing instruction was followed:** `grep -rn 'neither lane\|belongs to neither' docs/`
finds no second entry of this shape. The two remaining hits are the generic sentence in both lane
prompts ("if you need a path neither lane lists, claim it") and Lane B's baton claim on
`lib/github-release.ts`, which is a genuinely unlisted path and a correct use of the mechanism.

**Verification.** `check-backlog-pointers` OK — 210 entries, no duplicates, all tagged, no cycles.
`check-doc-index-size` OK; the backlog shrank by 18 lines so no baseline was raised.

**Not exercised:** nothing runtime. This PR contains no code.

**One drive-by, in the same area.** `projectOverview.md` said work runs through **four** standing
agents in the two places it names them, one commit after the Orchestrator landed (#263). Corrected
in place, at the same line count so the shrink-only ratchet did not need raising. It is the
orientation read every session starts from, and this PR's whole subject is the agent contract.
