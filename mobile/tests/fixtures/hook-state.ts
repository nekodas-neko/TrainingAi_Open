// A `react` stand-in for one component under test: its `useState` reads from and writes to
// `held`, so a test can tap a control, then render again in the new state.
import React from 'react';

export const held: { value?: unknown } = {};
export function useState<T>(initial: T): [T, (next: T) => void] {
  const value = ('value' in held ? held.value : initial) as T;
  return [value, (next) => void (held.value = next)];
}
export default React;
