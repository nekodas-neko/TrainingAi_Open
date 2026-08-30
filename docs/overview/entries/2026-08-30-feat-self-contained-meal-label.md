# 2026-08-30 — the whole meal in the QR (BF-57, engine half), Lane A

**Branch:** `feat/self-contained-meal-label` · **Lane A** · no migration · **no user-visible change
yet** — nothing calls the new payload until Lane B builds the label and the scan branch, so no
version bump.

## What was wrong

The printed label's QR carries a `saved_meals.id` and nothing else, and the scan path resolves that
against the **scanning** user's own meals — local store first, then `GET /api/nutrition/saved-meals`,
which returns only their rows. Another person's id is never in that list, so a shared label fell to
*"That saved meal no longer exists"*: wrong twice over, since the meal exists and the real answer is
"not yours".

Q-389 built it as a **private bookmark** and nothing about it is broken. Sharing was never in scope.

## The design, and the one that was rejected

Making ids globally resolvable would turn a photograph of a label into read access to someone's meal
— name, ingredients, macros — on an app heading for a Play Store health-data declaration, and it
couples two users' data so the author editing theirs reaches into everyone else's history.

The owner chose the opposite: **put the meal in the code.** No round-trip, so it scans offline and
for a user with no account; no privacy surface, because the data is on paper physically handed over;
and it is inherently a copy, so nothing stays coupled. What it costs, plainly: a printed label cannot
be updated (already true), no photo travels in the QR, and the ingredient list has a cap.

## Two rules carry it

**The totals are sacred; the detail is negotiable.** Dropping an ingredient to save bytes changes the
meal's calories with nothing on the label to say so. Nothing is dropped — the tail rolls into one
remainder entry carrying its combined weight and macros. Tested at 1, 2, 3, 5, 8, 12 and 25
ingredients: a trimmed copy's totals equal the original's exactly.

Rolling beats truncating names and it is not close. Cutting names to 8 characters leaves a
10-ingredient meal at **version 16**; rolling the same meal to 4 named plus a remainder fits
**version 11**, and keeps brands readable.

**Both formats, one decoder, indefinitely.** Labels already printed carry the 22-character id token
and must keep working for whoever printed them. `decodeMealLabelScan` is the single entry point; the
shapes cannot collide (22 base64url characters, a leading `[`, 13 digits).

## The budget is a label problem, not a format one

167 bytes needs QR version 9 — 53 modules. What decides whether a phone reads it is millimetres per
module, and today's circle-safe layout gives the code 12.2–16.4 mm, i.e. **0.31 mm/module**, below
the 0.49–0.66 mm this design was built to.

Given the code ~30 mm, version 11 (61 modules) is **0.49 mm/module** — the largest version still
inside that range; version 12 is 0.46 and falls out. So the budget is **251 bytes**, and the payload
is what gives way. **Growing the code on the label is Lane B's half and is the half that matters.**

## Verified

54 tests across two files, 7 mutations, all killed: the tail dropped instead of rolled, the budget
raised to version 12, the format version unchecked, old-format labels no longer resolving, an
over-long name not trimmed, `qrVersionForBytes` off by one, malformed numbers accepted.

**The capacity table is checked against the real encoder.** `packages/shared` stays dependency-free,
so the table comes from the QR spec rather than from the `qrcode` package — which leaves two sources
for one fact. An app-side test makes them agree for **all 20 versions**, asserting both that a
payload of exactly the stated capacity fits and that one byte more does not. It also independently
reproduces the five version figures the entry measured (69→v5, 167→v9, 265→v12, 412→v15, 510→v18)
before this table existed, so the agreement is corroboration rather than a restatement.

Full suite green; `pnpm check:rules` Ran 62 of 62; `tsc --noEmit` clean.

## Not exercised — and this is most of the feature

**Nothing calls any of it.** The label still prints the old token, the scan path still takes only the
id branch, and no user can share a meal yet. BF-57 stays in the queue with the surface as its
`Keep:`: give the QR ~30 mm, say on the label when the list was trimmed, route the `shared-meal`
branch into creating the scanner's own meal, and fix the message on the other one — *"That meal
belongs to someone else"* rather than *"no longer exists"*, which an old-format label scanned by
another user will still hit.

No device pass and no `pnpm dev` check, because there is no runtime surface to exercise: this PR is a
pure module plus its tests.
