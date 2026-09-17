# 2026-09-17 — TN-22's re-test fails, and the obvious explanation is wrong

**Tuning.** Docs-only. TN-22 sat at #5 in Lane A's ready list with its storage half already shipped
and its second half — *"on a re-test at n ≥ 30 the metric correlates negatively with readiness at
|r| ≥ 0.3"* — never run. Running it is Tuning's job, and it is cheaper than an implementer opening
the entry to find out.

## The result

| window | n | corr(`stress_high_minutes`, readiness) |
|---|---:|---:|
| since 2026-09-01 | 17 | **+0.562** |
| since 2026-08-20 | 29 | **+0.134** |
| TN-33's original | 18 | +0.072 |

The test wants **≤ −0.3**. Every window is positive, and the magnitude swings with the window — the
signature of a metric carrying little signal rather than one with an inverted sign.

## The explanation that was wrong

LA-112 shipped the day before, having found **41% of stress buckets were recorded during sleep**.
That makes contamination the obvious cause, and it would have been an easy story to write down.

**It is false.** `corr(stress_high_minutes, hours slept) = −0.133` over the same 29 days. Stress
minutes do not rise with sleep, so removing sleep buckets will not flip the sign on its own.

Worth recording because the plausible story and the true one point at different next steps: one says
*re-measure after LA-112 and it will resolve*, the other says *the scalar may not be about recovery
at all*.

## What does not change

**TN-33's autocorrelation result still stands.** The stress *series* has real temporal structure —
lag-1 +0.637 against a night-preserving null of +0.454. The daily *scalar* not predicting readiness
is a different claim. A signal can be real and not be about recovery.

**And this vindicates TN-34**, unwired the day before for firing off a number measured as carrying no
signal. This is that measurement on more data, still failing.

## What is owed

One re-test after ≈ 30 days of post-LA-112 data (≈ 2026-10-16), because every window above prices the
*old* metric. If it is still positive then, the honest next step is retiring the scalar rather than
re-tuning it — stated now so that conclusion is not treated as a surprise later.

## Not exercised

Docs-only; no code changed, nothing run on device, no scoring change shipped. All correlations are
the owner's own rows through `claude_ro`, row-scoped to one user, and n is 17–29 — below the entry's
own threshold of 30, which is why the amendment narrows the `Keep:` rather than closing the entry.
