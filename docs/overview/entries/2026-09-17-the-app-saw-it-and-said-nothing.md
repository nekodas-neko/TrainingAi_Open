# 2026-09-17 — the app detected a real event and showed nothing

**Tuning.** Docs-only. A routine production read after TN-34/BF-13/TN-39 shipped turned up a live
physiological signal in the owner's data, and the tuning question it raised was not whether the
metric works — it does — but whether anything reaches the user. It does not.

## The finding

The illness radar's `watch` band has fired **twice in 72 days**, and on those days readiness averages
**32 against 64** on normal days. It is inert in two places at once: `ILLNESS_READINESS_PENALTY.watch
= 0`, and the Home banner returns `null` for anything below `elevated`. So the band described in its
own comment as *advisory-only* carries no advisory.

**The two bands that would produce UI — `elevated` (65) and `fever` — have never fired.** As far as
72 days of data show, the illness banner has never rendered. The only band that fires is the silent
one. Filed as **TN-45**, `Gate: owner`, because what appears on Home about the owner's health is his
wording to choose.

Two fixes are explicitly ruled out in the entry: raising the `watch` penalty (readiness already fell
to 31 on its own, so penalising again double-counts the same physiology — the gap is visibility, not
weight) and moving the thresholds (n=2 cannot support it).

## The correction that made the finding trustworthy

Reporting this yesterday, this agent also told the owner his **sleep had collapsed to 3.1 h**. That
was wrong. `sleep_sessions` holds sessions rather than nights, and five of the last thirteen days
record a **midday Brisbane fragment** as the day's only session — averaging a nap with a night
describes neither. That is PS-17, already 🔴 LIVE; it gains the current numbers and the consequence
the entry did not state: **any multi-day sleep average is unusable while it is live.**

**The physiological finding survived the correction because it was tested rather than assumed.** The
obvious confound — that short records mechanically depress overnight HRV — is false here: HRV
averages **50 ms on fragment nights against 45 ms on real ones**, and the two lowest readings in the
window (28 and 19 ms) both sit on genuine ~7-hour nights.

## TN-42 amended

Its "temperature is the binding constraint on readiness" framing was true structurally and wrong
about the present. Temperature has recovered to 84–96 and is now the healthiest contributor; the
current drag is `hrvBalance` (87 → 0 over six weeks) tracking the real event above. Amended rather
than rewritten, because both halves are true and only the emphasis misled.

## Not exercised

Docs-only; no code changed, nothing run on device, no scoring change shipped. Every figure is the
owner's own rows through `claude_ro`, row-scoped to one user, and the most recent week is four days.
**No cause was diagnosed** — respiratory rate falling argues mildly against a respiratory infection
and the training taper argues against acute overreaching, but the data does not settle it and the
owner was given the measurement rather than a conclusion.
