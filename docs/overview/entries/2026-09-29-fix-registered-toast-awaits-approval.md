# 2026-09-29 — LA-162: the "Account created" toast told an invited registrant the opposite of what happens

**Lane B.** Branch `fix/registered-toast-awaits-approval`. UI copy only — no migration, no API change,
no APK.

## The copy

On `?registered=1` the sign-in screen toasted *"Sign in below — or wait for approval if not yet
invited."* That was true while an invite activated a password account. `RV-192` (#1779) made **every**
password registration start inactive, invited or not — so the first half became wrong, and a registrant
who followed it signed in and landed on `/pending`, which says the opposite.

## The sentence now exists once

Both screens say why the account cannot be used yet, and **them disagreeing is the whole bug**, so the
sentence is named once in `lib/approval-copy.ts` and imported by the toast and by `/pending`. That is a
deliberate step past what the entry asked for (it asked only for the toast to change): fixing one of two
copies of a sentence leaves the next drift available, and this drift had already shipped once. The
wording is `/pending`'s own, so the screen a registrant actually reaches is the authority rather than a
third phrasing.

`app/__tests__/approval-copy-one-place.test.ts` fails if either screen inlines the sentence again, if
the toast regains *"Sign in below"*, or if the sentence stops naming both the approval and the rough
wait — a wait with no end reads as a failure.

## ✅ The entry's "check first, unconfirmed" is answered: NO, and it matters

`LA-162` carried a second, unconfirmed half — that `router.push('/sign-in?registered=1')` *"did not
navigate after a successful POST"* in three dev-mode runs, with the note that **if it were real the
toast would never be seen at all**, which would have made this whole fix cosmetic.

**It navigates.** Driven end to end in a browser — `/register`, a unique email, submit — the URL becomes
`/sign-in?registered=1` and the toast renders. Lane A's own suspicion was right: Fast Refresh rebuilds
were logged around each of their submits, and a rebuild mid-submit remounts the component and loses the
pending navigation. This run had no file edits during it and no Fast Refresh churn.

**Stated precisely, because the entry asked for something slightly different:** it asked for *"one run
against a production build"*, and this was the dev server. A production build cannot reach the local
Postgres — `next start` sets `NODE_ENV=production`, which turns SSL on for the pool
(`playwright.config.ts` documents exactly this, and it is why the harness runs `pnpm dev`). What this
run does is remove the *suspected cause* and show the flow working; it does not exercise a production
build.

## Why there is no committed e2e for it

`POST /api/auth/register` is rate-limited to **5 attempts per IP per 15 minutes**. A committed spec
would couple the suite to that budget — one registration per run, two if a retry fires — and turn a
busy afternoon of CI into false reds that look nothing like their cause. The suite is also at the
ceiling `LB-166` measured four days ago. So the browser verification was done from a **scratch spec run
locally and then deleted**, along with the three user rows the runs created, and what is committed is
the source-level guard above.

One thing seen and deliberately not filed: the toast renders **twice** in dev, because React StrictMode
double-invokes the effect. Production runs it once.

## Not exercised

- **The device.** Copy on a WebView screen; no native plugin, safe-area, gesture or offline-first path
  is involved.
- **A real invited registrant.** The flow was driven with a fresh self-registration. Whether an invite
  row changes anything here is `RV-192`'s territory, and its whole point is that it no longer does.
- **A production build**, as above.
