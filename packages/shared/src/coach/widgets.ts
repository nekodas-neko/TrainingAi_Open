import { z } from 'zod';
import { CoachPatchSchema } from './patch';
export const WIDGET_COLOR_KEYS = ['cyan', 'green', 'amber', 'purple', 'destructive'] as const;
export type WidgetColorKey = (typeof WIDGET_COLOR_KEYS)[number];
export const CHOICE_SOURCES = [
  'sessions',
  'exercises',
  'swap_candidates',
  'grocery_stores',
  'proteins',
  'carbs',
  'fats',
  'vegetables',
  'dietary_restrictions',
] as const;
export type ChoiceSource = (typeof CHOICE_SOURCES)[number];
export const ChoiceListSchema = z.object({
  kind: z.literal('choice_list'),
  prompt: z.string().min(1).max(160),
  source: z.enum(CHOICE_SOURCES).optional(),
  sourceId: z.string().optional(),
  multi: z.boolean().optional(),
  selectAll: z.boolean().optional(),
  options: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1).max(80),
        subtitle: z.string().max(140).optional(),
        colorKey: z.enum(WIDGET_COLOR_KEYS).optional(),
      }),
    )
    .min(1)
    .max(24)
    .optional(),
});
export type ChoiceListArgs = z.infer<typeof ChoiceListSchema>;
export const HandoffSchema = z.object({
  kind: z.literal('handoff'),
  title: z.string().min(1).max(60),
  subtitle: z.string().max(100).optional(),
  destination: z.enum(['program_builder', 'log_activity', 'profile', 'nutrition']),
});
export type HandoffArgs = z.infer<typeof HandoffSchema>;
export const NumberDialSchema = z.object({
  kind: z.literal('number_dial'),
  title: z.string().min(1).max(60),
  patch: CoachPatchSchema,
});
export type NumberDialArgs = z.infer<typeof NumberDialSchema>;
export const ChangePreviewSchema = z.object({
  kind: z.literal('change_preview'),
  title: z.string().min(1).max(80),
  patch: CoachPatchSchema,
});
export type ChangePreviewArgs = z.infer<typeof ChangePreviewSchema>;
export const CHART_TYPES = ['line', 'bar', 'pie'] as const;
export const ChartSchema = z.object({
  kind: z.literal('chart'),
  chartType: z.enum(CHART_TYPES),
  title: z.string().max(60).optional(),
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
});
export type ChartArgs = z.infer<typeof ChartSchema>;
export const PlanCardSchema = z.object({
  kind: z.literal('plan_card'),
  title: z.string().min(1).max(60),
  planId: z.string().optional(),
});
export type PlanCardArgs = z.infer<typeof PlanCardSchema>;
export const PLAN_CARD_ACTIONS = { saveAll: 'save_all', redo: 'redo' } as const;
export const CoachWidgetSchema = z.discriminatedUnion('kind', [
  ChoiceListSchema,
  ChangePreviewSchema,
  HandoffSchema,
  NumberDialSchema,
  ChartSchema,
  PlanCardSchema,
]);
export type CoachWidget = z.infer<typeof CoachWidgetSchema>;
export type CoachWidgetKind = CoachWidget['kind'];
export const WIDGET_TOOL_NAMES = {
  renderChoiceList: 'choice_list',
  proposeChange: 'change_preview',
  handOff: 'handoff',
  askForNumber: 'number_dial',
  renderChart: 'chart',
  showMealPlan: 'plan_card',
} as const satisfies Record<string, CoachWidgetKind>;
export type WidgetToolName = keyof typeof WIDGET_TOOL_NAMES;
export function isWidgetToolName(name: string): name is WidgetToolName {
  return name in WIDGET_TOOL_NAMES;
}
export const WidgetResultSchema = z.union([
  z
    .object({
      status: z.literal('chose'),
      id: z.string().optional(),
      ids: z.array(z.string()).min(1).max(24).optional(),
      label: z.string(),
    })
    .refine((v) => v.id != null || v.ids != null, 'chose needs id or ids'),
  z.object({ status: z.literal('applied'), summary: z.string() }),
  z.object({ status: z.literal('cancelled') }),
  z.object({ status: z.literal('stale'), detail: z.string() }),
  z.object({ status: z.literal('shown') }),
]);
export type WidgetResult = z.infer<typeof WidgetResultSchema>;
