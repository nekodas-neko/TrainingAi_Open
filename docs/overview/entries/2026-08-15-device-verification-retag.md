# 2026-08-15 — tagging the device-verification wall by what it is actually waiting on

Q-254, the re-tagging half. Docs only; no version bump. The striking half is still open and now
depends on Q-297, not on access.

## The problem this addresses

`projectOverview.md` carried **83** rows marked "NOT verified on device", the oldest reaching back to
v1.45. They read as one undifferentiated wall, which made every one of them look like it needed a
phone — and made the whole set easy to skip. The 2026-08-14 review had already argued they were
several different gates wearing one label; this puts that on the rows themselves.

Each row now ends with a `· needs:` tag. Measured split:

| Tag | Count | What it means |
|---|---|---|
| `browser` | 32 | Somebody running the app. Unblocked by Q-249's harness — once a spec exists. |
| `android` | 26 | An Android runtime: local SQLite migrations, offline, notifications, back button, deep links, PiP. Q-250's territory. |
| `data` | 11 | Real accumulated / owner / ring data. **No emulator or browser conjures this** — a real night's sleep, the owner's live program, a validated ±5bpm band. |
| `hardware` | 13 | A Ring 5, a chest strap, a scale, GPS. Owner-only, permanently. |

`grep -cE '^### .*needs: browser' projectOverview.md` and friends are the live counts — anchor on the
heading, or the prose describing this counts itself.

## Two things worth being precise about

**The 2026-08-14 projection is superseded, in both directions.** It read "~25 need nothing but
somebody running the app / 17 Android / ~10 data / 25 hardware" from a reading pass. Measured, the
browser bucket is larger (32) and the hardware bucket smaller (13). The shape of the finding held —
roughly 40% of the wall never needed a phone — but the specific numbers did not, which is the
ordinary difference between reading and counting.

**A tag is a claim about the gate, not about verification.** A row tagged `browser` has not been
verified by anything; it means a browser is the thing it is waiting for. Nothing was struck here.
That matters because the temptation this entry creates is precisely the one CLAUDE.md forbids —
"never mark an issue fixed from intent" — and a re-tagging pass is exactly the kind of work that
could quietly turn into a striking pass if nobody says out loud that it must not.

## Why nothing was struck

Q-249 shipped the harness with **one** spec: the five-tab instant-paint walk. That spec covers
**none** of the 32 browser rows — it asserts that each tab paints without a skeleton, not that
bodyweight sets count toward volume or that the injury warning appears. So the honest count of rows
this session could strike is zero.

Q-254 is therefore updated rather than removed, and its remaining half is now blocked on writing
specs (Q-297), not on any access the owner needs to grant. That reframing is most of this entry's
value: the wall's largest bucket is no longer waiting on a phone, a device farm, or a decision — it
is waiting on someone writing tests against a harness that now exists.

## How the tags were assigned

From each row's own heading text, by keyword, with the four buckets applied in priority order:
`data` first (a row that needs real accumulated data cannot be satisfied by a browser or an emulator,
whatever else its heading mentions), then `hardware`, then `android`, else `browser`.

The classifier was wrong twice before it was right, and both are worth recording because they are
easy to repeat. The first pass lowercased the heading but left uppercase literals in the patterns
(`SQLite`, `GPS`, `BLE`, `APK`, `PiP`, `WebView`), so those never matched and a batch of Android
rows were mislabelled `browser`. The second pass had no `data` bucket at all, so "±5bpm band
unvalidated" and "real-night value" landed in `browser` — rows a browser can never close.

## Verification

`pnpm check:rules` — **35 of 35**. Docs-only; no code touched, so no build, suite or E2E run is
implicated. The counts in this entry and in `projectOverview.md` were read back from the file after
writing, not from the script that wrote them.
