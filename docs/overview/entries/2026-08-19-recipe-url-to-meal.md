# 2026-08-19 — Q-409 Lane A: paste a recipe URL, get a meal (the fetch half)

**PR #180** · branch `feat/recipe-url-to-meal` · Implementation Lane A · JS/server only, no APK needed.

## What shipped

`POST /api/nutrition/scan` grew a third input mode. It already took `image` and `text`; it now also
takes `url`, and answers with the same payload plus `sourceUrl` and `recipeYield`. Two new modules
sit behind it:

- **`lib/net/safe-fetch.ts`** — `fetchPublicUrl(url, opts)`. The app's first server-side fetch of a
  user-supplied URL, and therefore its first SSRF surface. The server sits on Railway's private
  network with the database on it, so this fails closed at every step: `https:` only, port 443 only,
  no embedded credentials, every address the hostname resolves to checked against the private /
  loopback / link-local / CGNAT / multicast blocks, `redirect: 'manual'` with each hop re-validated,
  and the response bounded by byte cap, timeout and content-type. Failures return a `reason` code;
  the route maps it to a sentence and never echoes it (Q-320 is exactly that leak).
- **`packages/shared/src/nutrition/recipe-parse.ts`** — `extractRecipeJsonLd`, `parseRecipeYield`,
  `extractReadableText`, `sliceAroundIngredients`. Pure, no node imports, so it stays out of the
  client bundle's way.

## The decisions worth not re-litigating

**Structured data first, model second.** Most recipe sites carry schema.org `Recipe` JSON-LD. It is
exact, free, and it carries `recipeYield`, which is the field that makes the feature correct rather
than merely working. The model is the fallback, and it only ever sees extracted *text* — page markup
is enormous and attacker-controlled, and it is treated as data with an explicit system instruction
saying so.

**The yield division happens in code, not in the prompt.** The model is told to estimate the *whole*
recipe; the route divides by the yield afterwards. Deterministic math does not drift, and CLAUDE.md
says no LLM-reported number may gate an automatic action.

**A missing yield returns `null`, never 1.** Assuming one serving turns a 12-pancake batch into one
pancake's calories — a 4x error that looks entirely plausible on the screen. The route hands back the
whole-recipe numbers with `recipeYield: null` so Lane B's picker can ask.

## Measured, and both measurements changed the code

Two things were assumed in the plan and turned out wrong when run against real pages:

1. **A 1 MB byte cap rejects ordinary recipe pages.** `bbcgoodfood.com/recipes/easy-pancakes` is
   553 KB of markup and is not an outlier. The cap is 3 MB.
2. **The first 4,000 characters of a page with no JSON-LD are navigation chrome.** Wikipedia's banana
   bread article led with "Jump to content / Main menu" — the model would have been sent no food at
   all. `extractReadableText` now drops `nav`/`header`/`footer`/`aside`/`form`, and
   `sliceAroundIngredients` starts at the "Ingredients" heading when the page has one.

## Verification

**32 unit tests** across the two modules (`lib/net/__tests__/safe-fetch.test.ts`,
`packages/shared/src/nutrition/__tests__/recipe-parse.test.ts`), with DNS and `fetch` both injected so
nothing touches the network.

The five SSRF cases this entry named as its acceptance criteria were **also exercised live against
`pnpm dev`**, logged in as the seeded test user, because a guard that only passes with a mocked
resolver is not evidence:

| sent | answered |
|---|---|
| `http://…` | 400 `Only https:// links can be read.` |
| `file:///etc/passwd` | 400 `Only https:// links can be read.` |
| `https://127.0.0.1/x` | 400 `That link cannot be read.` |
| `https://169.254.169.254/latest/meta-data/` | 400 `That link cannot be read.` |
| a page over the byte cap / non-HTML | 400 `That page is too big to read.` / `That link is not a web page.` |

Redirect-into-a-private-address and public-name-resolving-to-private are covered by test rather than
live, because both need a resolver under our control.

The happy path ran end-to-end against the real Gemini key: `bbcgoodfood.com/recipes/easy-pancakes` →
`Easy pancakes`, 12 servings read from the page, 77 kcal per pancake, ingredient weights divided
(100 g flour → 8.3 g), `sourceUrl` and `recipeYield` attached, 3.8 s. A 404 page returns
`Could not read that page.` The no-JSON-LD fallback returned a whole 1,956 kcal loaf with
`recipeYield: null` — which is the correct, honest output and the reason Lane B has to ask.

## What is NOT done

- **The UI.** `components/nutrition/my-meals-picker.tsx` is Lane B and untouched. Until it lands there
  is no way to reach this from the app; the backlog entry now describes only that half.
- **DNS rebinding is not closed out.** The address is validated and then the hostname is connected to
  by name. Closing it means connecting to the pinned IP with the Host header preserved, which undici
  does not expose here. Written into `safe-fetch.ts`'s docstring rather than left implicit.
- **No device verification, and none is needed** — this is a server route with no native, safe-area,
  gesture, notification or offline-store surface. The APK reaches it through the Railway deploy.
- **Not exercised:** Samsung WebView rendering (no UI), drifted prod data (the route reads no user
  rows), native SQLite.

## Also in this PR

`docs/module-map.md`'s "Request body guards" row named `lib/http/request-guards.ts`, which has not
existed since the monorepo extraction — the file is `packages/shared/src/http/request-guards.ts` and
the import specifier is `@trainingai/shared/http/request-guards`. `check-index-doc-paths.js` did not
catch it because it deliberately accepts `lib/foo` as satisfied by `packages/shared/src/foo`. Row
corrected; the check's escape hatch is correct and was left alone.
