import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { weekHasAnything } from '@/components/health/week/week-has-data';
import type { WeeklyDigestMetrics } from '@trainingai/shared/health/weekly-digest-metrics';
import { stripComments } from '../../scripts/lib/strip-comments.js';

const read = (p: string) => stripComments(readFileSync(path.join(process.cwd(), p), 'utf8'));

const emptyWeek = (): WeeklyDigestMetrics => ({
  weekStart: '2026-09-14',
  weekEnd: '2026-09-20',
  priorWeekStart: '2026-09-07',
  training: { sessions: 0, priorSessions: 0, volumeKg: 0, priorVolumeKg: 0, volumeChangePct: null, byDay: [] },
  muscleSets: [],
  prs: [],
  hrv: { week: null, priorWeek: null, byDay: [], source: null },
  readiness: { week: null, priorWeek: null, byDay: [] },
  sleepScore: { week: null, priorWeek: null, byDay: [] },
  sleepHours: { week: null, priorWeek: null, byDay: [] },
  stressHighMinutes: { week: null, priorWeek: null, byDay: [] },
  illness: null,
  resilience: null,
  ots: null,
  weightChangeKg: null,
  friendCount: null,
});

describe('weekHasAnything — RV-211 ①', () => {
  it('an account with nothing in it has nothing to announce', () => {
    expect(weekHasAnything(emptyWeek())).toBe(false);
    expect(weekHasAnything(null)).toBe(false);
    expect(weekHasAnything(undefined)).toBe(false);
  });

  it('one session, one PR or a single night is enough', () => {
    const one = emptyWeek(); one.training.sessions = 1;
    expect(weekHasAnything(one)).toBe(true);

    const pr = emptyWeek(); pr.prs = [{ exerciseName: 'Bench', estimated1rm: 100, description: '100 kg' }];
    expect(weekHasAnything(pr)).toBe(true);

    const slept = emptyWeek(); slept.sleepHours.week = 7.2;
    expect(weekHasAnything(slept)).toBe(true);
  });

  // `weightChangeKg` is newest-minus-oldest across a TWO-WEEK window and `hrv.source` is chosen for
  // that whole window, so either can be populated by the prior week alone. Counting them would
  // announce a week that had nothing in it — which is the bug, not the fix.
  it('does not count the two fields that can be filled by the prior week', () => {
    const priorOnly = emptyWeek();
    priorOnly.weightChangeKg = -1.4;
    priorOnly.hrv.source = 'overnight';
    priorOnly.hrv.priorWeek = 48;
    expect(weekHasAnything(priorOnly)).toBe(false);
  });
});

describe('the banner and the card stop claiming things — RV-211', () => {
  it('the recap banner suppresses an empty week, and only when metrics arrived', () => {
    const src = read('components/weekly-recap-banner.tsx');
    expect(src).toMatch(/data\.metrics != null && !weekHasAnything\(data\.metrics\)/);
    // A cache entry written before `metrics` shipped has none, and absent must read as
    // "don't suppress" — otherwise an old seed hides a real week.
    expect(src).toMatch(/if \(emptyWeek\) return null;/);
  });

  it('Body Battery shows no band, no trend and no number when nothing drove the arc', () => {
    const src = read('components/body-battery-card.tsx');
    expect(src).toMatch(/const noData = !battery\.hasData/);
    expect(src).toMatch(/noData \? 'No data yet' : battery\.label/);
    expect(src).toMatch(/noData \? '—' : battery\.current/);
    expect(src).toMatch(/!noData && <TrendBadge/);
  });

  // RV-38's finding was that gating the "Limited data" chip on `hasData` made the qualification
  // WEAKER as the data got worse. This must not reintroduce that: `lowData` still keys on
  // `!conf.sufficient`, and `noData` only ever adds a stronger statement on top.
  it('does not re-gate the Limited data chip on hasData', () => {
    const src = read('components/body-battery-card.tsx');
    expect(src).toMatch(/const lowData = conf != null && !conf\.sufficient/);
    expect(src).not.toMatch(/const lowData =[^\n]*hasData/);
  });

  it('the week strip says rest only when a program says so', () => {
    const src = read('app/session-select/components/week-strip-card.tsx');
    expect(src).toMatch(/const hasProgram = activeSessions\.length > 0/);
    expect(src).toMatch(/hasProgram \? \(\s*<span className="text-xs">rest<\/span>/);
    // The old aria-label called every session-less day a rest day, future ones included.
    expect(src).toMatch(/day\.isFuture\s*\?\s*""/);
  });
});
