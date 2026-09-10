# 2026-09-10 — a correction that left the thing it corrected in place (Q-31 / Q-50)

**PR:** `lane-a/dhrv-deletable-contradiction` · **Lane A** · docs only, nothing implemented.

## Two entries, opposite instructions, both live

Q-31's headline bullet said `inference/dhrv` is *"one Oura dependency deletable today at zero product
cost"*. Q-50 item 1 — worked earlier the same session — concludes the opposite: the module is
production-unreachable **on purpose**, its golden test is what pins D5's own regression against
Oura's original, and deleting it discards that validation while the replacement is young. **D7
decides it, not a sweep.**

Q-50 also claimed the wording *"has been corrected in the three docs that carried it."* It had not
been. Three live copies survived:

1. **Q-31's own bullet** — the entry an implementer actually works from, at position 6 in READY.
2. **`docs/domains/platform/README.md`** — the orientation read for the pillar.
3. **The triage plan itself**, which is the worst of the three: the correction sits as a ⚠️ note
   *above* the original paragraph, and the paragraph still ends *"It is the cheapest row here and
   should ship first."*

## The shape of the failure, which is the part worth keeping

**A correction placed beside the text it corrects does not correct anything — it creates two claims,
and the reader follows whichever they reach first.** In the triage plan the two are adjacent: a note
saying "do not do this" immediately followed by "do this first". Someone working Q-31 top-down reads
the bullet, opens the plan, finds a paragraph telling them to ship it first, and deletes the golden
test that validates D5.

Strike the wrong sentence. Do not annotate it. That is what this PR does in all three places, and
Q-50's own claim about the correction is amended rather than left standing as a false record of a fix.

The call-graph finding underneath was never wrong — `buildDaytimeStressSeries` genuinely has no
caller. What was wrong is the inference from it: **production-unreachable is what the retention *is*,
not evidence against it.**

## Fourth of the day, and the first that was a contradiction rather than staleness

After Q-91-followup (a claim that hid a live pre-rollup-repaint bug), Q-50 (a safety net deleted
months earlier), and Q-1a (a security precondition that inverts when you "fix" it). Those three were
stale; this one was two live claims disagreeing, which is why it survived a correction pass aimed at
staleness.

**Not exercised:** no code changed. The call-graph claim was re-checked against `main` at `efbe8ea5`;
the retention rationale is quoted from `module-map.md` and the on-device progress doc.
