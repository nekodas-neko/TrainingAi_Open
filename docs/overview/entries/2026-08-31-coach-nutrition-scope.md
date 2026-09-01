# 2026-08-31 · Lane A — Coach gets a named nutrition scope, made of what it never receives (LA-47)

Branch `lane-a/coach-nutrition-scope`. JS/server only — reaches the device through a Railway
deploy, no APK.

## What shipped: piece 2 of the entry, the scope record

`lib/coach/scopes.ts` is a named record — read tools, widget tools, choice sources, patch domains,
prompt section — and `/api/coach` takes an optional `scope` on the body. The Nutrition tab will
open Coach in `nutrition`; everything else stays `general`, which withholds nothing, so every
existing caller is byte-for-byte unchanged.

**The enforcement is the point, and it is not the prompt.** The entry's own line — *scope by
withholding tools, not by instructing* — is implemented three ways, all of which the model cannot
argue with:

1. The training read tools are simply absent from the tool set.
2. `renderChoiceList`'s `source` enum is **rebuilt per request** from the scope's sources, so a
   nutrition-scoped Coach naming `source: "sessions"` fails schema validation and the SDK retries
   it — it never becomes a request the options route has to refuse.
3. `proposeChange`/`askForNumber`'s `domain` enum is narrowed the same way, so this scope
   structurally cannot propose a change to a program session.

The prompt section is still there and is not a contradiction: withholding decides what is
*possible*, prose decides what is *idiomatic*. A scope with the nutrition tools and no hint about
meal planning would be reachable and useless.

**Verified live, both directions.** The same question — *"which session should I do today? show me
my program sessions"* — calls `getReadinessExplanation` unscoped and produces a `handOff` widget
under `nutrition`. A nutrition question under `nutrition` calls `getNutritionDay` +
`getEnergyBalance` as it should.

## A bug my own test caught, which review would not have

`isCoachScopeId` used `value in COACH_SCOPES`. `in` walks the prototype chain, so a client sending
`scope: "toString"` matched, and `coachScope` then returned `Object.prototype.toString` **as a
scope** — where `readTools` is `undefined`, which is not `null`, so `pickTools` would
`new Set(undefined)` and take the request down. `Object.hasOwn` now, with the case pinned at both
the unit and route level.

## What did NOT ship, and why the entry was wrong about it

LA-47's piece 1 is the plan widget, and the entry proposes splitting it: *"Add a member to the union
and a row in `WIDGET_TOOL_NAMES`; the registry row and the component are Lane B's half."* **That
split does not compile.** `components/coach/widget-registry.tsx` narrows by early return and falls
through to `change_preview`, so a new union member is a type error until a branch handles it. And a
branch rendering `null` is worse than none: `widgets.ts` says so itself — a client-side tool call
with no result **wedges the whole thread**, because the provider refuses a request containing an
unanswered tool call. So piece 1 is one change across two lanes, not two changes.

Rather than half-build a card, the settled design went into the backlog entry so whoever pairs on it
does not re-derive it: the widget carries `{ kind, title, planId? }` and **no meals** — the client
renders from the plan it already holds, for exactly the reason `CHOICE_SOURCES` exists — and the two
actions resolve as ordinary `chose` results with fixed ids, needing no new `WidgetResultSchema`
member. Save-all calls `savePlanMealsToLibrary`, which already ships and is already idempotent.

## Not exercised

Native SQLite / Capacitor plugins, safe-area, Samsung WebView, the APK path — untouched. The scope
was exercised against a real Gemini turn on `pnpm dev`; the unit and route tests mock the model, so
what they pin is the tool set and schemas it receives, which is precisely the claim.
