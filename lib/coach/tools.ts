import { tool } from 'ai'
import { z } from 'zod'
import type { WorkoutRepository } from '@/lib/data/repository'
import { ChoiceListSchema, ChangePreviewSchema, HandoffSchema, NumberDialSchema, ChartSchema, PlanCardSchema } from './widgets'
import { CoachPatchSchema } from './patch'
import { COACH_SCOPES, pickTools, type CoachScope } from './scopes'
import { injurySafeAlternatives } from '@trainingai/shared/workout/injury-substitution'

/**
 * The widget tools, plus the one read tool they cannot work without.
 *
 * Neither widget tool has an `execute`. That is the whole mechanism: a tool without `execute` is a
 * **client-side tool** — the SDK validates the model's arguments against the schema (retrying the
 * model on a mismatch), streams the call to the client, and suspends the conversation until the
 * client supplies a result via `addToolResult`. Typed payload out, the user's answer back in.
 *
 * Do not give either of them an `execute` to "make it work server-side". An `execute` would feed
 * the result back to the model and the turn would continue without ever pausing for the user,
 * which is the opposite of a widget.
 */
/**
 * The scope's narrowed schemas (LA-47).
 *
 * Rebuilt per request rather than defined once, because that is what makes a scope a boundary
 * instead of a suggestion: the SDK validates the model's arguments against whatever schema it was
 * given and retries on a mismatch, so a nutrition-scoped Coach naming `source: "sessions"` fails
 * validation — it is not a request anything downstream has to refuse. On the general scope the
 * narrowed enums equal the full ones, so nothing changes.
 */
function scopedSchemas(scope: CoachScope) {
  const choiceList = ChoiceListSchema.extend({
    source: z.enum(scope.choiceSources as [string, ...string[]]).optional(),
  })
  const patch = CoachPatchSchema.extend({
    domain: z.enum(scope.patchDomains as [string, ...string[]]),
  })
  return {
    choiceList,
    changePreview: ChangePreviewSchema.extend({ patch }),
    numberDial: NumberDialSchema.extend({ patch }),
  }
}

export function buildWidgetTools(
  repo: WorkoutRepository,
  userId: string,
  scope: CoachScope = COACH_SCOPES.general,
) {
  const scoped = scopedSchemas(scope)
  const all = {
    /**
     * Why this exists: without it the model has no source of real ids and **invents them**.
     * Measured on the first end-to-end run of this route — asked "I want to change my workout",
     * it produced a perfectly-formed ChoiceList whose option ids were `push-123`, `pull-456`,
     * `legs-789`. The apply path refuses an unknown target so nothing unsafe could follow, but the
     * widget was a dead end: every option resolved to a row that does not exist.
     *
     * A system-prompt instruction not to invent ids is necessary and not sufficient. The fix is to
     * give the model somewhere to get them.
     */
    getProgramStructure: tool({
      description:
        "The user's active program: every session and every exercise in it, each with the database id needed to reference it. Call this before showing any list of sessions or exercises, or before proposing a change to one. Never invent an id.",
      inputSchema: z.object({}),
      async execute() {
        const program = await repo.getActiveProgram(userId)
        if (!program) return { program: null, note: 'No active program.' }
        return {
          program: {
            id: program.id,
            name: program.name,
            sessions: program.sessions
              .slice()
              .sort((a, b) => a.position - b.position)
              .map(s => ({
                id: s.id,
                name: s.name,
                exercises: s.exercises
                  .slice()
                  .sort((a, b) => a.position - b.position)
                  .map(e => ({
                    id: e.id,
                    name: e.exerciseName,
                    position: e.position,
                    styleId: e.styleId ?? null,
                    muscleGroups: e.muscleGroups,
                  })),
              })),
          },
        }
      },
    }),

    /**
     * The `from` side of every goal and injury change.
     *
     * Same lesson as `getProgramStructure`: in Phase 1 the model invented ids because nothing gave
     * it real ones. Goals, macro targets and active injuries are all things it would otherwise have
     * to remember or guess, and a wrong `from` is not harmless — it makes the apply path refuse the
     * patch as stale, which reads to the user as the feature being broken.
     */
    getGoalsAndInjuries: tool({
      description:
        "The user's current goals (steps, calories, water), macro targets, any active injuries with their ids, and whether a deload week is currently running. Call this before proposing a change to any of them — every `from` value must come from here, and marking an injury recovered needs its id as targetId.",
      inputSchema: z.object({}),
      async execute() {
        const [goals, targets, injuries, program] = await Promise.all([
          repo.getUserGoals(userId),
          repo.getNutritionTargets(userId),
          repo.listInjuries(userId),
          repo.getActiveProgram(userId),
        ])
        return {
          /** The `from` side of an `early_deload` patch. */
          deloadRunning: program?.earlyDeloadWeekStart != null,
          goals: {
            stepsGoal: goals.stepsGoal,
            calorieGoal: goals.calorieGoal,
            waterGoalMl: goals.waterGoalMl,
          },
          macroTargets: targets
            ? { calories: targets.calories ?? null, proteinG: targets.proteinG ?? null, carbsG: targets.carbsG ?? null, fatG: targets.fatG ?? null }
            : null,
          activeInjuries: injuries
            .filter(i => !i.resolvedDate)
            .map(i => ({ id: i.id, muscleName: i.muscleName, severity: i.severity, since: i.startedDate })),
        }
      },
    }),

    /**
     * The tool whose absence dead-ended the swap flow.
     *
     * Observed on-device 2026-08-09: the user asked to change an exercise, picked one from the
     * list, and got a prose question — "what would you like to replace it with?" — and no widget.
     * Reproduced locally. The model was not misbehaving: nothing exposed the exercise catalogue, so
     * a list of candidates was not something it *could* draw. A picker needs a source of options.
     *
     * Matching reuses `injurySafeAlternatives` rather than re-deriving "same main muscle" here —
     * one formula, one place — which also makes every suggestion injury-aware for free.
     */
    findSwapCandidates: tool({
      description:
        'Exercises the user could swap an exercise FOR. Pass the session exercise id from getProgramStructure. Returns catalogue exercises training the same main muscles, excluding anything that loads an injured area. Call this before showing a list of replacements — without it you have no real exercise names or ids and must not invent them. Optional `query` narrows by name when the user asked for something specific ("something with dumbbells").',
      inputSchema: z.object({
        exerciseId: z.string().min(1),
        query: z.string().max(60).optional(),
      }),
      async execute({ exerciseId, query }) {
        const program = await repo.getActiveProgram(userId)
        const current = program?.sessions
          .flatMap(s => s.exercises)
          .find(e => e.id === exerciseId)
        if (!current) return { candidates: [], note: 'No such exercise in the active program.' }

        const [library, injuries] = await Promise.all([
          repo.listExerciseLibrary(),
          repo.listInjuries(userId),
        ])
        const entry = library.find(e => e.name === current.exerciseName)
        const mainMuscles = entry
          ? entry.muscles.filter(m => m.role === 'main').map(m => m.muscle)
          : current.muscleGroups
        const injured = injuries.filter(i => !i.resolvedDate).map(i => i.muscleName)

        const matches = injurySafeAlternatives(
          { name: current.exerciseName, mainMuscles },
          injured,
          library,
          200,
        )
        const q = query?.trim().toLowerCase()
        const filtered = q ? matches.filter(e => e.name.toLowerCase().includes(q)) : matches

        return {
          replacing: current.exerciseName,
          avoidingInjuries: injured,
          candidates: filtered.slice(0, 12).map(e => ({
            id: e.id,
            name: e.name,
            mainMuscles: e.muscles.filter(m => m.role === 'main').map(m => m.muscle),
            equipment: e.equipment,
          })),
        }
      },
    }),

    renderChoiceList: tool({
      description: [
        'Show the user a list to pick from instead of asking them to type a name.',
        '',
        '**Prefer `source` and write NO options.** The app fills the rows from the database itself,',
        'which is faster for the user and cannot go wrong:',
        '· source "sessions" — every session in the program. No sourceId.',
        '· source "exercises" — exercises to choose between. sourceId = a session id to limit it to',
        '  that session; omit sourceId for every exercise in the program, which is what you want',
        '  when the user said "change an exercise" without naming a day.',
        '· source "swap_candidates" — replacements for an exercise. sourceId = the session exercise',
        '  id. Same matching as findSwapCandidates, so you do NOT need to call that tool first when',
        'you are only going to show the list.',
        '',
        'Write `options` yourself ONLY for a list the app cannot derive — a chart legend, a set of',
        'judgement calls. Then every id must come from a tool result; an invented one produces a',
        'list the user cannot act on.',
        '',
        'Do not use this at all when the user has already been specific enough to act on.',
      ].join(' '),
      inputSchema: scoped.choiceList,
    }),

    renderChart: tool({
      description: [
        'Draw a chart in the conversation. Use it when the answer is a series the user asked to',
        'see — a trend over time, a comparison between a handful of things — instead of listing',
        'the numbers in prose. If they said "on a chart", "show me", or "graph", they want this.',
        '',
        'Every number must come from a tool result. `labels` are the x-axis categories (dates,',
        'exercise names) and each dataset\'s `data` lines up with them one for one. "line" for',
        'anything over time, "bar" to compare separate things, "pie" only for parts of a whole.',
        '',
        'It shows something; it does not ask anything, so you can keep talking straight after it —',
        'one short sentence naming what the picture shows. Do NOT also list the same numbers in',
        'text, and do NOT follow it with a choice list of the same items unless the user actually',
        'has to pick one of them.',
      ].join(' '),
      inputSchema: ChartSchema,
    }),

    showMealPlan: tool({
      description: [
        "Show the user their meal plan as a card, with a button that copies every meal into My",
        'Foods. Use it when they ask what is on their plan, after you have helped them change it,',
        'and whenever a planning conversation reaches its end — the plan is disposable and the',
        'saved meals are what survives it, so this is how a meal-plan conversation finishes.',
        '',
        'Call getMealPlan first: if it returns available:false there is nothing to show, so say so',
        'and offer to help them build one instead of calling this.',
        '',
        'Do NOT write the meals out. This tool takes a title and nothing else — the app fills in',
        'every meal, its calories and its ingredient count from the plan it already holds, which is',
        'faster than you typing them and cannot disagree with what is stored. Omit planId for their',
        'active plan, which is what "my plan" means; pass one only when they asked about a',
        'different plan you read from getMealPlan.',
      ].join(' '),
      inputSchema: PlanCardSchema,
    }),

    handOff: tool({
      description:
        "Point the user at the screen that does something you cannot. Use for building a whole new program (program_builder), logging a run or activity (log_activity), account and profile settings (profile), or logging food (nutrition). Say in one sentence why it is not something you do, then hand off — do not apologise, and offer the nearest thing you CAN do afterwards.",
      inputSchema: HandoffSchema,
    }),

    askForNumber: tool({
      description:
        'Let the user set a single number on a dial instead of typing it. Use when they asked for a change without saying how much — "bump my calories a bit" has no number in it. If they DID give a number, skip this and use proposeChange. One change only, and `from` must be the current value from getGoalsAndInjuries.',
      inputSchema: scoped.numberDial,
    }),

    proposeChange: tool({
      // The worked example is not decoration. Measured on the first run of this route, the model
      // took three attempts to produce a valid patch — first `{field:"name",newValue:…}`, then a
      // change missing `id` and `from`. The schema rejected both and the SDK retried, so nothing
      // invalid ever reached the client, but each retry is a round-trip the user waits through.
      description: [
        "Propose a change to the user's program and show it for confirmation. Nothing is written",
        'until the user confirms — you are proposing, not applying.',
        '',
        'Each change needs exactly four keys: `id` (any short unique string of your own), `field`,',
        '`from` (the CURRENT value, read from a tool result — never remembered), and `to`.',
        '',
        'Pick the `domain` and use only its fields:',
        '· "session_exercise" — fields "exerciseName", "styleId", "position", "removed".',
        '  `targetId` is the session EXERCISE id from getProgramStructure. There is NO field for',
        '  sets, reps, percentage or rest — those are not stored on the exercise.',
        '  If the user names a replacement that findSwapCandidates did NOT return and that is not',
        '  in the catalogue at all (say "Jefferson curl"), you can still swap to it: add a second',
        '  change with field "newExerciseMuscles" whose `to` is the MAIN muscles it trains, comma',
        '  separated ("Hamstrings, Lower back"), and optionally "newExerciseEquipment"',
        '  ("Barbell"). That creates the exercise and swaps to it in one confirmation. Those',
        '  muscles drive deload and recovery, so give the real ones and let the user check them.',
        '· "nutrition_targets" — fields "calories", "proteinG", "carbsG", "fatG". `targetId` is null.',
        '· "user_goals" — fields "stepsGoal", "calorieGoal", "waterGoalMl". `targetId` is null.',
        '· "injury" — fields "muscleName", "severity" ("mild"/"moderate"/"severe"), "notes",',
        '  "resolved". `targetId` is null when logging a new one, and the injury id from',
        '  getGoalsAndInjuries when marking one recovered.',
        '· "early_deload" — one field, "deloadNow". `targetId` is null. `to` true starts a deload',
        '  week today, false cancels one already running; `from` is `deloadRunning` from',
        '  getGoalsAndInjuries. You do NOT choose the date — the app stamps today in the user\'s own',
        '  timezone. Use this when they say they are beaten up, need a lighter week, or ask to',
        '  deload now.',
        '· "program_phase" — fields "phaseSetId", "sessionsPerCycle", "phaseMode". `targetId` is',
        '  null. This one is heavier than the others: it can move the user backwards through a',
        '  block they have already earned, so it gets its own confirmation screen. Propose it only',
        '  when the user clearly asked to change their periodisation, never as a suggestion.',
        '',
        'Example: {"kind":"change_preview","title":"Swap Deadlift","patch":{"domain":"session_exercise",',
        '"targetId":"<exercise id>","changes":[{"id":"c1","field":"exerciseName",',
        '"from":"Barbell Deadlift","to":"Romanian Deadlift"}]}}',
        '',
        'Logging an injury records it and nothing else — the app already works injuries into what it',
        'prescribes. Do not offer to remove or swap exercises because of one.',
        '',
        'Do not describe what the change will cost; the app measures that itself and shows it.',
      ].join(' '),
      inputSchema: scoped.changePreview,
    }),
  }

  // `getProgramStructure` and `findSwapCandidates` are read tools that live here rather than in
  // `lib/ai-chat/tools.ts`, so they are filtered by the same list — a scope that withholds the
  // widgets that need an exercise id has no use for the tool that supplies one.
  return pickTools(all, [...scope.widgetTools, ...(scope.readTools ?? Object.keys(all))])
}
