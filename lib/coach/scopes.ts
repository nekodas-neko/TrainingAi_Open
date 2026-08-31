import { CHOICE_SOURCES, WIDGET_TOOL_NAMES, type ChoiceSource, type WidgetToolName } from './widgets'
import { COACH_PATCH_DOMAINS, type CoachPatchDomain } from './patch'

/**
 * A named Coach scope — what this conversation is about, expressed as what it can reach (LA-47).
 *
 * **Scope by withholding, never by instructing.** A prompt saying "do not read workout data" is a
 * request a model will occasionally ignore; a tool it never receives is a boundary it cannot cross.
 * Every field below narrows something the SDK or the apply path already validates, so an
 * out-of-scope call is refused by the same machinery that refuses a malformed one — not by the
 * model choosing to behave.
 *
 * A named record rather than an inline filter in the route, so a second scope costs a row here
 * instead of a refactor. **This one line is all that survives of Q-408** — do not re-derive that
 * architecture; Q-407 records why it was removed.
 *
 * The prompt section is still here, and it is not a contradiction: withholding decides what is
 * *possible*, prose decides what is *idiomatic*. A scope with the nutrition tools and no hint about
 * meal planning would be reachable and useless.
 */
export interface CoachScope {
  /** Read tools (`lib/ai-chat/tools.ts`) this scope may call. `null` means every one of them. */
  readTools: readonly string[] | null
  /** Widget tools this scope may render. */
  widgetTools: readonly WidgetToolName[]
  /** Sources `renderChoiceList` may name. Narrowing the enum makes an out-of-scope source a
   *  schema error the SDK retries the model on, rather than a request the options route serves. */
  choiceSources: readonly ChoiceSource[]
  /** Patch domains this scope may propose against. The apply path already refuses a field outside
   *  its domain; this refuses the domain itself. */
  patchDomains: readonly CoachPatchDomain[]
  /** Appended to the system prompt. Says what this conversation is for, never what it may not do —
   *  the fields above already answer that, and a list of prohibitions reads as a challenge. */
  systemSection: string
}

const NUTRITION_READ_TOOLS = [
  'getNutritionDay',
  'getEnergyBalance',
  'getMealPlan',
  'getDayCheckins',
  'getMilestones',
] as const

/**
 * The nutrition scope is deliberately narrow on the WRITE side and generous on the read side.
 *
 * `getMilestones` and `getDayCheckins` are in because a question about eating is routinely a
 * question about how the week went; `getWorkoutsByExercise` and the training-load tools are out
 * because nothing in a meal-planning conversation needs them and each one is a round trip the user
 * waits through. On the write side only `nutrition_targets` and `user_goals` are reachable, so this
 * scope structurally cannot propose a change to a program session.
 */
export const COACH_SCOPES = {
  general: {
    readTools: null,
    widgetTools: Object.keys(WIDGET_TOOL_NAMES) as WidgetToolName[],
    choiceSources: CHOICE_SOURCES,
    patchDomains: COACH_PATCH_DOMAINS,
    systemSection: '',
  },
  nutrition: {
    readTools: NUTRITION_READ_TOOLS,
    widgetTools: ['renderChoiceList', 'proposeChange', 'handOff', 'askForNumber', 'renderChart'],
    choiceSources: ['grocery_stores', 'proteins', 'carbs', 'fats', 'vegetables', 'dietary_restrictions'],
    patchDomains: ['nutrition_targets', 'user_goals'],
    systemSection: `
## This conversation is about food
The user opened you from the Nutrition tab, so start there: their meal plan, what they have eaten,
their targets. You cannot see or change their training here — if they ask about a workout, say so in
one sentence and hand off to the program screen rather than guessing.
`.trim(),
  },
} as const satisfies Record<string, CoachScope>

export type CoachScopeId = keyof typeof COACH_SCOPES

/** `Object.hasOwn`, not `in`: `in` walks the prototype chain, so a client sending
 *  `scope: "toString"` matched, and `coachScope` then handed the route `Object.prototype.toString`
 *  as a scope — `scope.readTools` is `undefined` there, which is not `null`, so `pickTools` would
 *  `new Set(undefined)` and take the request down. Caught by the unit test below, not by review. */
export function isCoachScopeId(value: unknown): value is CoachScopeId {
  return typeof value === 'string' && Object.hasOwn(COACH_SCOPES, value)
}

/** The scope for an id, falling back to `general`. An unknown id widens rather than fails: a
 *  client sending a scope this build does not know about should get a working Coach, and the
 *  narrow scopes are a routing convenience, not a security boundary — every tool they withhold is
 *  one the user could reach from the general scope anyway. */
export function coachScope(id: unknown): CoachScope {
  return isCoachScopeId(id) ? COACH_SCOPES[id] : COACH_SCOPES.general
}

/** Keep only the entries a scope allows. `null` (the general scope) keeps everything. */
export function pickTools<T extends Record<string, unknown>>(
  tools: T,
  allowed: readonly string[] | null,
): Partial<T> {
  if (allowed == null) return tools
  const set = new Set(allowed)
  return Object.fromEntries(Object.entries(tools).filter(([name]) => set.has(name))) as Partial<T>
}
