# 2026-08-31 — CI refuses `savePreference` inside a `useEffect` (LB-28)

**Branch:** `fix/no-save-preference-in-effect` · **Lane B**

## The footgun

`useEffect(() => localStorage.setItem(K, v), [v])` is a free write. The same line calling
`savePreference` is a **network PATCH on every mount**, and nothing at the call site says so.

One such site shipped: `goals-progress-card.tsx` mirrored its view mode into a preference from a
mount effect. Inside Health's launch burst that PATCH and a `GET` behind it stayed **pending past
sixty seconds**, and nine e2e specs failed on `waitUntil: 'networkidle'` — none of which mentions
preferences. **The screen a failure like that names is never the screen that caused it**, which is
what makes the rule worth enforcing rather than remembering.

`usePersistedPreference` is the shape a mirror wants: local write on the first settled value, PATCH
only on a genuine change, and its guard compares the **value** rather than counting runs, because
StrictMode invokes an effect twice on mount and spends a `firstRun` ref.

## What ships

- `scripts/lib/save-preference-in-effect.js` — the scanner, separate so it can be driven against
  fixtures. It **blanks comments and string literals before counting parentheses**: an unbalanced
  paren in either would extend an effect's span across the rest of the file and report call sites
  nowhere near an effect. It takes the whole `useEffect(…)` call rather than a braced body, so a
  concise `useEffect(() => savePreference('x', v), [v])` — which has no braces — is caught too.
- `scripts/check-save-preference-in-effect.js`, wired into the Custom Rules job. The gate now runs
  **63 of 63**.
- `scripts/__tests__/save-preference-in-effect.test.ts` — ten cases: the shape that shipped, the fix
  that replaced it, concise bodies, `savePreferences`, handlers beside effects, and both
  span-extension hazards.

**Proved by mutation, on the real file**: restoring `goals-progress-card`'s effect makes the check
fail at that exact line; reverting makes it pass.

## The entry's premise was wrong, and it is worth knowing why

LB-28 said *"there are none today"* about sites needing an exemption. **There are two.** The grep
behind that claim looked for `savePreference` on the same line as `useEffect`, which is a shape
nobody writes — the defect always spans lines.

Both are exempted with the reason written in the script:

- **`lib/user/preferences-sync.ts`** — this *is* `usePersistedPreference`. The effect is the
  mechanism, and its value-comparing guard is what makes the PATCH conditional.
- **`app/session-select/session-select-content.tsx`** — Home reconciling `homeSectionOrder` after a
  card widget is toggled in Profile. It returns early unless the order genuinely changed, so it is
  not a per-mount PATCH; the write is the point of the effect rather than a mirror of state.

An exemption here is not a debt row. It says the rule's shape and the site's shape happen to
coincide, which is why each one has to be argued in the diff.

## Not done

- **The second exemption sits next to LB-29 and is not covered by it.** That effect can write during
  the window before hydration settles — a preference overwrite race — which is LB-29's subject, still
  open and still waiting on the owner's choice between a dirty mark and seed-if-absent.
- The rule is deliberately narrow: one helper whose cost is invisible in its name. It is **not** "no
  fetch in an effect", which is most of this codebase and which `check-fetch-once-effects.js`
  already ratchets from a different angle.
