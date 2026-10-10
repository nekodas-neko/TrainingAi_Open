import type { TextStyle } from 'react-native';

export const spacing = { none: 0, xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 };
export const radii = { small: 8, control: 12, card: 16, pill: 999 };
export const icons = { strokeWidth: 2 };
export const sizes = {
  touchTarget: 44,
  button: 48,
  icon: 24,
  iconSmall: 20,
  emphasizedIcon: 28,
  avatar: 48,
  navigation: 80,
  workoutButton: 56,
  workoutLift: 24,
  contentWidth: 680,
};
export const typography = {
  title: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
  hero: { fontSize: 24, lineHeight: 30, fontWeight: '700' },
  heading: { fontSize: 17, lineHeight: 24, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 22 },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  caption: { fontSize: 12, lineHeight: 18 },
  eyebrow: { fontSize: 11, lineHeight: 16, fontWeight: '600', letterSpacing: 0.8 },
  metric: { fontSize: 24, lineHeight: 30, fontWeight: '700' },
  tab: { fontSize: 10, lineHeight: 14, fontWeight: '500' },
} satisfies Record<string, TextStyle>;
export type Space = keyof typeof spacing;
export type TextVariant = keyof typeof typography;
export const domainTones = {
  light: {
    sleep: {
      foreground: '#7e54e0',
      background: '#f7f4fe',
      border: '#e1d5fd',
    },
    heart: {
      foreground: '#cb3a3a',
      background: '#fef2f2',
      border: '#fbcece',
    },
    activity: {
      foreground: '#1b8175',
      background: '#f0fcfb',
      border: '#c8f4ee',
    },
    nutrition: {
      foreground: '#994ccc',
      background: '#fbf4ff',
      border: '#eed5ff',
    },
    recovery: {
      foreground: '#047c90',
      background: '#eefafc',
      border: '#beecf4',
    },
  },
  dark: {
    sleep: {
      foreground: '#9e76f7',
      background: '#252539',
      border: '#3f3369',
    },
    heart: {
      foreground: '#f15959',
      background: '#36211a',
      border: '#652a25',
    },
    activity: {
      foreground: '#2dd4bf',
      background: '#153a2f',
      border: '#1b6154',
    },
    nutrition: {
      foreground: '#c265ff',
      background: '#2e263a',
      border: '#52346c',
    },
    recovery: {
      foreground: '#06b6d4',
      background: '#0e3533',
      border: '#0c555c',
    },
  },
};
