import { z } from 'zod'
import { CoachPatchSchema } from './patch'

/**
 * The widget vocabulary AI Coach may render inside the conversation.
 *
 * These are the argument schemas of **client-side tools** — tools declared without an `execute`
 * function. The SDK validates the model's arguments against them and makes the model retry on a
 * mismatch, then streams the call to the client and waits for `addToolResult`. That validation is
 * the whole reason this is not the `<sheet_chart>` in-text block pattern
 * (`packages/shared/src/parse-chart-blocks.ts`): a malformed chart block silently disappears and
 * the user loses a picture, but a malformed *input* widget would put an Apply button over a payload
 * nobody checked.
 *
 * Adding a widget means adding a member here and a row in `components/coach/widget-registry.tsx`.
 * The union is the extension point; the protocol does not change.
 */

/** Semantic colour keys, resolved to theme tokens client-side. Never a hex literal — CLAUDE.md
 *  bans those in favour of the tuned OKLCH tokens, and a model-authored hex would break one of
 *  the two themes. */
export const WIDGET_COLOR_KEYS = ['cyan', 'green', 'amber', 'purple', 'destructive'] as const
export type WidgetColorKey = (typeof WIDGET_COLOR_KEYS)[number]

/**
 * Lists the app can build itself from stored data.
 *
 * **This is the cheap path and the model should take it whenever it applies.** Measured
 * 2026-08-09: a nine-option picker the model wrote out in full cost ~554 output tokens, and output
 * tokens are essentially all of Coach's latency. Every one of those rows — the ids, the names, the
 * equipment — is data the app already holds, so having a language model re-type it is paying to
 * transcribe your own database.
 *
 * Naming a source instead also makes an invented id **structurally impossible** for these lists
 * rather than merely forbidden: the model never writes an id at all. That bug class shipped twice
 * in this feature already.
 */
/**
 * The lists the app can fill on the model's behalf.
 *
 * The first three come from the user's own program. The rest are the meal-plan flow's curated
 * catalogues (Q-407): they were literals inside `meal-plan-setup-sheet.tsx` that the Coach would
 * otherwise have had to type out — six store names, thirty-two staples — which is the ~554-output-
 * token transcription this mechanism exists to stop.
 */
export const CHOICE_SOURCES = [
  'sessions', 'exercises', 'swap_candidates',
  'grocery_stores', 'proteins', 'carbs', 'fats', 'vegetables', 'dietary_restrictions',
] as const
export type ChoiceSource = (typeof CHOICE_SOURCES)[number]

export const ChoiceListSchema = z.object({
  kind: z.literal('choice_list'),
  prompt: z.string().min(1).max(160),
  /** Flat rather than a discriminated union on purpose: Gemini's function-declaration schema is
   *  fussy about unions, and this feature has already lost a day to one (`z.literal(false)`). */
  source: z.enum(CHOICE_SOURCES).optional(),
  /** The session id for `exercises`, the session-exercise id for `swap_candidates`. Unused by
   *  `sessions`. */
  sourceId: z.string().optional(),
  /**
   * Let the user pick several, not one (Q-407). The owner's complaint was literal — *"there should
   * be options for 'select all' as I keep clicking each grocery store"* — and there was no
   * configuration that produced it: the widget resolved one option and its callback was singular.
   *
   * Flat fields rather than a discriminated union of single/multi variants, for the same reason
   * `source` is flat two lines up: Gemini's function-declaration schema is fussy about unions and
   * this feature has already lost a day to one. Both default false, so every existing call site
   * keeps behaving exactly as it did.
   */
  multi: z.boolean().optional(),
  /** Offer a "Select all" row. Only meaningful with `multi`; ignored without it. */
  selectAll: z.boolean().optional(),
  /** Only for a list the app cannot derive — a chart legend, a set of judgement calls. If `source`
   *  is set these are ignored. */
  options: z
    .array(
      z.object({
        /** A real DB id — `program_sessions.id`, `session_exercises.id`. Never a name: session
         *  identity is the id (CLAUDE.md), and the resolved value is fed straight back into a
         *  patch. */
        id: z.string().min(1),
        title: z.string().min(1).max(80),
        /** Whatever makes the options distinguishable — schedule days, set counts, a trend. */
        subtitle: z.string().max(140).optional(),
        colorKey: z.enum(WIDGET_COLOR_KEYS).optional(),
      }),
    )
    .min(1)
    .max(24)
    .optional(),
})
export type ChoiceListArgs = z.infer<typeof ChoiceListSchema>

/**
 * Where Coach sends you when the answer is "not in here".
 *
 * The refusal is one sentence and the destination is real. A boundary with no exit reads as a dead
 * end, and the app already has proper screens for the things Coach deliberately does not do —
 * building a program from scratch, logging a run, editing a past workout.
 */
export const HandoffSchema = z.object({
  kind: z.literal('handoff'),
  title: z.string().min(1).max(60),
  subtitle: z.string().max(100).optional(),
  /** An in-app path. Restricted to a known list so a model cannot send the user off-site. */
  destination: z.enum(['program_builder', 'log_activity', 'profile', 'nutrition']),
})
export type HandoffArgs = z.infer<typeof HandoffSchema>

/**
 * A single number, set on a dial rather than typed.
 *
 * For tier-1 values the dial IS the confirmation — there is no separate ChangePreview, because a
 * number you can see and set back does not need a second screen agreeing that you meant it. The
 * delta line is the part that matters: a number with no reference to the one it replaces is not
 * something anyone can judge.
 */
export const NumberDialSchema = z.object({
  kind: z.literal('number_dial'),
  title: z.string().min(1).max(60),
  patch: CoachPatchSchema,
})
export type NumberDialArgs = z.infer<typeof NumberDialSchema>

export const ChangePreviewSchema = z.object({
  kind: z.literal('change_preview'),
  title: z.string().min(1).max(80),
  patch: CoachPatchSchema,
})
export type ChangePreviewArgs = z.infer<typeof ChangePreviewSchema>

/**
 * A picture, not a question.
 *
 * Every other widget here asks the user something. This one only shows, which makes it the odd one
 * out in exactly one load-bearing way: **nothing will ever answer it.** A client-side tool call with
 * no result wedges the whole thread — the provider refuses a request containing an unanswered tool
 * call — so the chart resolves itself the moment it renders, and the turn carries on to whatever
 * the model wanted to say next.
 *
 * Shape is deliberately narrower than `parse-chart-blocks.ts`'s `ChartPayload`, which it feeds:
 * one optional `colorKey` per dataset instead of that schema's `string | string[]` colour fields.
 * Gemini's function declarations are fussy about unions (this feature lost a day to a
 * `z.literal(false)` once already), and a model-authored colour has to be a theme token anyway —
 * a hex literal breaks one of the two themes.
 */
export const CHART_TYPES = ['line', 'bar', 'pie'] as const

export const ChartSchema = z.object({
  kind: z.literal('chart'),
  chartType: z.enum(CHART_TYPES),
  title: z.string().max(60).optional(),
  /** X-axis categories — dates, exercise names, muscle groups. One per point in every dataset. */
  labels: z.array(z.string().max(40)).min(2).max(40),
  datasets: z
    .array(
      z.object({
        label: z.string().min(1).max(40),
        data: z.array(z.number()).min(2).max(40),
        colorKey: z.enum(WIDGET_COLOR_KEYS).optional(),
      }),
    )
    .min(1)
    .max(4),
})
export type ChartArgs = z.infer<typeof ChartSchema>

/**
 * Note what is NOT here: consequences. The model proposes the patch and the client asks
 * `POST /api/coach/preview` what it costs, so a consequence is always a measurement rather than a
 * plausible sentence about someone's training. A model that could author "this drops your weekly
 * lower-back sets from 11 to 4" could also author a wrong version of it, and the user would have
 * no way to tell.
 */
export const CoachWidgetSchema = z.discriminatedUnion('kind', [
  ChoiceListSchema,
  ChangePreviewSchema,
  HandoffSchema,
  NumberDialSchema,
  ChartSchema,
])
export type CoachWidget = z.infer<typeof CoachWidgetSchema>
export type CoachWidgetKind = CoachWidget['kind']

/** Tool name → widget kind. The tool name is what the model calls; the kind is what renders. */
export const WIDGET_TOOL_NAMES = {
  renderChoiceList: 'choice_list',
  proposeChange: 'change_preview',
  handOff: 'handoff',
  askForNumber: 'number_dial',
  renderChart: 'chart',
} as const satisfies Record<string, CoachWidgetKind>

export type WidgetToolName = keyof typeof WIDGET_TOOL_NAMES

export function isWidgetToolName(name: string): name is WidgetToolName {
  return name in WIDGET_TOOL_NAMES
}

/** What the client sends back as the tool result once the user has answered. Kept small and
 *  human-readable: it re-enters the model's context, so it should read like something the user
 *  said rather than a serialised event. */
export const WidgetResultSchema = z.union([
  /**
   * One option, or several (Q-407). `label` is the readable half either way — the single option's
   * title, or the picked titles joined — because this string re-enters the model's context and
   * should read like something the user said.
   *
   * `id` and `ids` are both optional with a refine rather than `id` staying required and carrying
   * the first of many: a field documented as "the option they chose" holding one of five is the
   * kind of quiet lie that is true until someone reads it. Nothing consumes `id` today except the
   * bubble, which renders `label`.
   */
  z.object({
    status: z.literal('chose'),
    id: z.string().optional(),
    ids: z.array(z.string()).min(1).max(24).optional(),
    label: z.string(),
  }).refine(v => v.id != null || v.ids != null, 'chose needs id or ids'),
  z.object({ status: z.literal('applied'), summary: z.string() }),
  z.object({ status: z.literal('cancelled') }),
  z.object({ status: z.literal('stale'), detail: z.string() }),
  /** The chart's own result — sent by the client on render, never by the user. Without it the
   *  unanswered tool call wedges every following turn. */
  z.object({ status: z.literal('shown') }),
])
export type WidgetResult = z.infer<typeof WidgetResultSchema>
