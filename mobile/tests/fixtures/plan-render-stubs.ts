// Stand-ins for what the pre-workout screen and its plan card import, so the REAL SessionScreen and
// PlanStartCard render under react-dom/server (#4104). Each box writes its name and its plain props
// into the markup, so a test reads back exactly what the screen passed. Functions and elements are
// not props a test compares; elements are drawn by the layout stand-in where they are children.
import { createElement as h, isValidElement, useState, type ReactNode } from 'react';
import { radii, sizes, spacing } from '../../src/shared/theme/tokens.ts';

type Props = Record<string, unknown> & { children?: ReactNode };
type Screen = Record<string, any>;
export const screen = () => (globalThis as unknown as { __screen: Screen }).__screen;

const plain = (props: Props) =>
  JSON.stringify(props, (key, value) =>
    key === 'children' || typeof value === 'function'
      ? undefined
      : isValidElement(value)
        ? '[element]'
        : value,
  );
const box = (name: string) =>
  function Box({ children, ...props }: Props) {
    return h('div', { 'data-ui': name, 'data-props': plain(props) }, children);
  };

export const View = box('View');
export const Stack = box('Stack');
export const Card = box('Card');
export const Badge = ({ label }: Props) => h('span', { 'data-ui': 'Badge' }, String(label));
export const Icon = ({ name }: Props) => h('i', { 'data-ui': 'Icon', 'data-icon': name });
export const AppText = ({ children, variant, tone, numberOfLines }: Props) =>
  h(
    'span',
    { 'data-ui': 'AppText', 'data-variant': variant, 'data-tone': tone, 'data-lines': numberOfLines },
    children,
  );
export const AppButton = ({ title, variant, busy, disabled }: Props) =>
  h(
    'button',
    { 'data-ui': 'AppButton', 'data-variant': variant, 'data-busy': !!busy, 'data-disabled': !!disabled },
    String(title),
  );
export const IconButton = ({ label }: Props) => h('button', { 'data-ui': 'IconButton' }, String(label));
export const Notice = ({ title, message }: Props) =>
  h('div', { 'data-ui': 'Notice' }, `${title}: ${message}`);
export const StateCard = ({ title }: Props) => h('div', { 'data-ui': 'StateCard' }, String(title));
export const Sheet = () => null;
export const TouchSurface = ({ children, accessibilityLabel }: Props) =>
  h('div', { 'data-ui': 'TouchSurface', 'aria-label': accessibilityLabel }, children);
export const LiftCoachMenu = box('LiftCoachMenu');
export const useTheme = () => ({ theme: { spacing, sizes, radii, anatomy: {}, colors: {} } });

// The screen's own collaborators, as recorders.
export const ExercisePreviewCard = box('ExercisePreviewCard');
export const SessionExerciseList = box('SessionExerciseList');
export const PrescriptionControls = box('PrescriptionControls');
export const ExerciseHistory = box('ExerciseHistory');
export const StartWorkoutCard = ({ actionLabel }: Props) =>
  h('button', { 'data-ui': 'StartWorkoutCard' }, String(actionLabel ?? 'Start Workout'));
export function WorkoutLayout({ children, footer, actions, ...props }: Props) {
  return h(
    'div',
    { 'data-ui': 'WorkoutLayout', 'data-props': plain(props) },
    h('div', { 'data-ui': 'actions' }, actions as ReactNode),
    h('div', { 'data-ui': 'body' }, children),
    h('div', { 'data-ui': 'footer' }, footer as ReactNode),
  );
}

// Hooks the screen reads. `useState` is real; everything else comes from the test's fixture.
export const useWorkoutContext = () => screen().workout;
export const useWorkoutJournal = () => screen().journal;
export const useWeightUnits = () => screen().units ?? {};
export const useSessionPreparation = () => screen().preparation;
export const useWorkoutResource = () => ({ data: [], error: null, loading: false });
export { useState };
