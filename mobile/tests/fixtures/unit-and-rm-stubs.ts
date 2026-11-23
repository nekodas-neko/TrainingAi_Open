// #4072 / #4077: plain-HTML stand-ins for what the Preview screens import beyond their own logic, so
// the real ExerciseSummary, StrengthScreen, SessionExerciseList, ExercisePreviewCard and
// NextPrescription render with react-dom/server and a test reads what they print.
import { createElement as h, type ReactNode } from 'react';

type Props = Record<string, unknown> & { children?: ReactNode };
const box = ({ children }: Props) => h('div', null, children);
const text = ({ children }: Props) => h('span', null, children);

export const state: {
  units: Record<string, 'kg' | 'lb'>;
  resources: Record<string, unknown>;
  next: unknown;
} = { units: {}, resources: {}, next: null };

export const View = box;
export const Pressable = box;
export const TouchSurface = box;
export const Stack = box;
export const Card = box;
export const Disclosure = ({ children }: Props) => h('div', null, children);
export const AppText = text;
export const Badge = ({ label }: Props) => h('span', null, label as string);
export const ListRow = ({ title, subtitle }: Props) => h('div', null, `${title} | ${subtitle}`);
export const Icon = () => null;
export const IconButton = () => null;
export const LineChart = () => null;
export const PageDots = () => null;
export const Sheet = () => null;
export const useTheme = () => ({
  theme: new Proxy({}, { get: (_t, key) => (key === Symbol.toPrimitive ? () => 8 : proxy) }),
  textScale: 1,
});
const proxy: Record<string | symbol, unknown> = new Proxy(
  {},
  { get: (_t, key) => (key === Symbol.toPrimitive ? () => 8 : proxy) },
);
export const formatDuration = (s: number) => `${Math.round(s)}s`;
export const RestCard = () => null;
export const EffortQuestion = () => null;
export const ExerciseThumbnail = () => null;
export const ExerciseHistory = () => null;
export const ResourceStatus = () => null;
export const LiftCoachMenu = () => null;
export const gainColor = () => '#888';
export const useWorkoutContext = () => ({ timezone: 'Australia/Brisbane' });
export const useWorkoutResource = (spec: { path: string }) => ({ data: state.resources[spec.path] ?? null });
export const useWeightUnits = () => state.units;
export const ResourceCard = ({ children }: Props) =>
  (children as unknown as (data: unknown) => ReactNode)(state.next);

// #4072 follow-up: the history sheet and the day log.
export const ExerciseHrTrendCard = () => null;
export const AppButton = ({ title }: Props) => h('button', null, title as string);
export const ConfirmationCard = box;
export const Notice = box;
export const NumericStepper = () => null;
export const StatusIndicator = () => null;
export const useHistoryQueue = () => ({ operations: [], ready: true, syncing: false, error: null, queue: null });
export const useWorkoutAction = () => ({ error: null, busy: false, run: async () => {} });
export const journal: { workouts: unknown[] } = { workouts: [] };
export const useWorkoutJournal = () => ({ data: { workouts: journal.workouts, preferences: { units: state.units } } });
