// Plain-English guide for every health-score contributor: what it measures, what it's measured
// against, what a high vs low score means, and how to move it. Powers the tap-to-expand deep-dive
// on the Readiness / Sleep / Activity / Heart-Rate detail screens so a bar is never just a number.
//
// Keyed by the canonical Oura snake_case contributor keys (see lib/oura/contributors.ts). The
// app's own readiness composite uses camelCase keys — `guideFor` resolves both.

export interface ContributorGuide {
  measures: string
  against: string
  /** What a high (good) score means. */
  high: string
  /** What a low score means / could indicate. */
  low: string
  /** Concrete, actionable ways to improve it. */
  remediate: string[]
}

const GUIDE: Record<string, ContributorGuide> = {
  // ── Readiness contributors ────────────────────────────────────────────────
  resting_heart_rate: {
    measures: 'Your lowest heart rate overnight — how slowly your heart beats at complete rest.',
    against: 'Your own 2-week average resting HR. At or below baseline scores high; elevated scores low.',
    high: 'At or below your baseline — your body is well recovered and your "rest & digest" nervous system is in charge.',
    low: 'Elevated versus your baseline — a common early sign of incomplete recovery, illness, alcohol, a late meal, or stress.',
    remediate: [
      'Prioritise sleep and stay hydrated.',
      'Avoid alcohol and heavy meals in the 3 hours before bed.',
      'Keep intense training earlier in the day.',
      'If it stays high for several days with other symptoms, treat it as a possible illness cue and ease off.',
    ],
  },
  hrv_balance: {
    measures: 'Heart-rate variability — the beat-to-beat variation in your heart rate overnight, a proxy for nervous-system recovery.',
    against: 'Your rolling HRV baseline. Higher-than-usual variation is good; a drop signals stress or fatigue.',
    high: 'HRV at or above your baseline — strong recovery and readiness to train hard.',
    low: 'HRV below your baseline — your nervous system is still under load from training, stress, illness, or poor sleep.',
    remediate: [
      'Protect sleep — it is the single biggest HRV lever.',
      'Add an easy day or a deload if HRV has been low for several days.',
      'Manage stress load: daylight, breathwork, lighter caffeine.',
      'Avoid alcohol, which sharply suppresses overnight HRV.',
    ],
  },
  body_temperature: {
    measures: 'Your overnight body-temperature deviation from your personal normal.',
    against: 'Your baseline (0.0°C). Small swings are normal; a sustained rise can precede illness.',
    high: 'Temperature is close to your baseline — nothing unusual.',
    low: 'Temperature is off your baseline. A rise can precede illness, or reflect alcohol, a late workout, a warm room, or (for some) menstrual-cycle phase.',
    remediate: [
      'Watch for other illness signs (sore throat, congestion) and rest if they appear.',
      'Keep the bedroom cool.',
      'Note alcohol and late training — both raise night-time temperature.',
      'One elevated night is not alarming; a multi-day trend matters more.',
    ],
  },
  previous_night: {
    measures: 'How well you slept last night — duration, efficiency, and stages combined into one score.',
    against: 'An ideal night for your age, and your own recent nights.',
    high: 'Last night gave you solid, restorative sleep.',
    low: 'Last night fell short on duration or quality, so today’s recovery bank is lower.',
    remediate: [
      'Keep a consistent sleep and wake time.',
      'Wind down screen-free for 30–60 min before bed.',
      'Cut caffeine after early afternoon.',
      'Aim for a dark, cool, quiet room.',
    ],
  },
  sleep_balance: {
    measures: 'Whether you have gotten enough sleep across the last two weeks — your accumulated sleep debt.',
    against: 'Your two-week sleep need. Consistently meeting it scores high; a running deficit scores low.',
    high: 'You are keeping up with your sleep need over the fortnight.',
    low: 'You have built up a sleep debt across recent nights — a few consistent full nights will rebuild it.',
    remediate: [
      'Bank sleep with several consistent full nights, not one long lie-in.',
      'Move bedtime earlier by 15–30 min.',
      'Protect the sleep window on training days.',
    ],
  },
  previous_day_activity: {
    measures: 'How much you moved yesterday — total activity and training load.',
    against: 'Your typical daily activity. Both very high and very low pull this down.',
    high: 'Yesterday’s activity was in a healthy range that supports recovery.',
    low: 'Yesterday was either very hard (needing recovery) or very sedentary.',
    remediate: [
      'Balance hard days with easy movement rather than total rest.',
      'After a big session, prioritise a walk and steps over another hard effort.',
      'Avoid long, fully sedentary days.',
    ],
  },
  recovery_index: {
    measures: 'How quickly your resting heart rate settled to its lowest point during the night.',
    against: 'An early settle-point (≥ ~6 h before waking) is ideal — it means you recovered early and slept undisturbed.',
    high: 'Your heart rate settled early in the night — efficient overnight recovery.',
    low: 'Your heart rate stayed elevated into the night — late meals, alcohol, late training, or stress can delay this.',
    remediate: [
      'Finish eating 2–3 hours before bed.',
      'Avoid alcohol in the evening.',
      'Move intense training earlier in the day.',
      'Give yourself a calm pre-sleep routine.',
    ],
  },
  activity_balance: {
    measures: 'Whether your recent activity is building fitness sustainably or tipping into overtraining.',
    against: 'Your recent activity trend. Steady, progressive load scores high; a sudden spike scores low.',
    high: 'Your training load is well balanced against your recent fitness.',
    low: 'Your recent load has spiked above what your fitness supports — injury and overtraining risk rise.',
    remediate: [
      'Progress load gradually — around 10% per week.',
      'Follow hard weeks with lighter ones.',
      'Let this recover before adding more volume.',
    ],
  },

  // ── Sleep contributors ────────────────────────────────────────────────────
  deep_sleep: {
    measures: 'Time in deep (slow-wave) sleep — the most physically restorative stage, when tissue repairs and growth hormone peaks.',
    against: 'Age-appropriate deep-sleep targets. Deep sleep naturally declines with age.',
    high: 'Plenty of deep sleep — strong physical recovery.',
    low: 'Light on deep sleep. Alcohol, late training, heat, and inconsistent timing all cut it.',
    remediate: [
      'Keep the room cool and dark.',
      'Avoid alcohol and late heavy meals.',
      'Consistent bed/wake times deepen slow-wave sleep.',
      'Get daylight and exercise — earlier in the day.',
    ],
  },
  rem_sleep: {
    measures: 'Time in REM (dreaming) sleep — consolidates memory, learning, and emotional recovery.',
    against: 'Age-appropriate REM targets, which concentrate in the second half of the night.',
    high: 'Good REM — mental and emotional recovery on track.',
    low: 'Low REM. Alcohol and cutting the morning short (waking before the last REM-heavy cycles) reduce it most.',
    remediate: [
      'Don’t cut the morning short — REM concentrates in the final hours.',
      'Avoid alcohol before bed.',
      'Keep a regular wake time.',
    ],
  },
  efficiency: {
    measures: 'The share of your time in bed that you were actually asleep.',
    against: '85%+ is considered efficient; lots of waking pulls it down.',
    high: 'You slept soundly with little time awake.',
    low: 'You spent a lot of time in bed awake — trouble falling or staying asleep.',
    remediate: [
      'Only go to bed when sleepy.',
      'If awake more than 20 min, get up and reset.',
      'Reserve the bed for sleep.',
      'Limit caffeine and late screens.',
    ],
  },
  latency: {
    measures: 'How long it took you to fall asleep after getting into bed.',
    against: 'Around 15–20 min is ideal — much faster can signal sleep debt, much slower signals trouble settling.',
    high: 'You fell asleep within a healthy window.',
    low: 'You took a long time to drop off, or fell asleep instantly from exhaustion.',
    remediate: [
      'Wind down before bed rather than going straight from screens.',
      'Keep a consistent bedtime.',
      'Avoid late caffeine and intense evening exercise.',
    ],
  },
  restfulness: {
    measures: 'How undisturbed your sleep was — tossing, turning, and brief wake-ups.',
    against: 'Fewer disturbances score higher.',
    high: 'Calm, settled sleep.',
    low: 'A restless night — stress, a warm room, alcohol, or noise commonly cause it.',
    remediate: [
      'Keep the room cool, dark, and quiet.',
      'Limit alcohol.',
      'Address stress before bed with journaling or breathing.',
    ],
  },
  timing: {
    measures: 'Whether you slept at a time aligned with your body clock (circadian midpoint).',
    against: 'Your natural chronotype and a socially-typical night window.',
    high: 'Your sleep timing matched your body clock.',
    low: 'You slept notably earlier or later than ideal — jet lag, late nights, or an irregular schedule.',
    remediate: [
      'Anchor a consistent wake time, even on weekends.',
      'Get morning daylight to set your clock.',
      'Avoid bright light late at night.',
    ],
  },
  total_sleep: {
    measures: 'Total time actually asleep across the night.',
    against: 'Your personal sleep need — typically 7–9 h for adults.',
    high: 'You got enough total sleep.',
    low: 'You slept less than your body needs — the simplest lever is more time in bed.',
    remediate: [
      'Move bedtime earlier.',
      'Protect a full sleep window on training days.',
      'A short (20 min) nap can offset a poor night.',
    ],
  },

  // ── Activity contributors ─────────────────────────────────────────────────
  meet_daily_targets: {
    measures: 'How consistently you have hit your daily activity goal recently.',
    against: 'Your activity-goal target over the last several days.',
    high: 'You are regularly hitting your movement goal.',
    low: 'You have missed your daily target on recent days.',
    remediate: [
      'Set a realistic daily step / activity goal.',
      'Break movement into short bouts across the day.',
      'Walk after meals.',
    ],
  },
  move_every_hour: {
    measures: 'How well you avoided long sedentary stretches during the day.',
    against: 'Standing or walking at least briefly most waking hours.',
    high: 'You broke up sitting well.',
    low: 'Long sedentary stretches — common on desk days.',
    remediate: [
      'Stand or walk a few minutes each hour.',
      'Use a timer or a standing desk.',
      'Take calls walking.',
    ],
  },
  recovery_time: {
    measures: 'Whether you gave your body enough recovery relative to recent training.',
    against: 'The recovery your recent load calls for.',
    high: 'You balanced training with adequate recovery.',
    low: 'Recent hard training hasn’t been matched with enough recovery.',
    remediate: [
      'Schedule easy or rest days after hard sessions.',
      'Prioritise sleep on recovery days.',
      'Keep recovery days genuinely easy.',
    ],
  },
  stay_active: {
    measures: 'Your total low-intensity daily movement (steps, walking, general activity) outside workouts.',
    against: 'A healthy daily non-exercise activity level.',
    high: 'Plenty of everyday movement — the base of your daily energy burn.',
    low: 'Low background movement today.',
    remediate: [
      'Add walks — they add up fast.',
      'Take the stairs, park further away.',
      'Aim for a daily step target.',
    ],
  },
  training_frequency: {
    measures: 'How regularly you have done intense training sessions recently.',
    against: 'A sustainable weekly training frequency for your fitness.',
    high: 'Consistent training frequency.',
    low: 'Few recent hard sessions — either a rest phase or a gap.',
    remediate: [
      'Aim for regular sessions rather than sporadic bursts.',
      'Even short sessions maintain frequency.',
      'During deloads this is expected to dip.',
    ],
  },
  training_volume: {
    measures: 'The overall amount of training load you have accumulated recently.',
    against: 'Your recent volume trend — enough to progress, not so much you can’t recover.',
    high: 'Solid training volume supporting progress.',
    low: 'Low recent volume — fine during recovery, worth building otherwise.',
    remediate: [
      'Build volume gradually week to week.',
      'Balance volume with recovery days.',
      'Track weekly sets per muscle to progress sensibly.',
    ],
  },

  // ── Activity Score v2 contributors (goal-anchored, 2026-07-22) — the app's own components,
  // replacing the frozen Oura activity contributors above (kept for the pre-re-key fallback path).
  steps: {
    measures: 'Today’s step count.',
    against: 'Your personal daily step goal (set in Profile, or a sensible default for your activity level).',
    high: 'You’ve hit or exceeded your step goal today.',
    low: 'Below your step goal so far today.',
    remediate: [
      'A 20–30 minute walk covers most of a typical shortfall.',
      'Take calls or breaks walking instead of sitting.',
      'Park further away or take the stairs.',
    ],
  },
  activeEnergy: {
    measures: 'Active calories burned today from movement and exercise (not resting metabolism).',
    against: 'A goal derived from your BMR (body weight, height, age, sex) — roughly a WHO-guideline day of deliberate movement.',
    high: 'You’ve burned a solid amount of active energy today.',
    low: 'Low active-energy burn so far today.',
    remediate: [
      'Brisk walking, cycling, or any sustained movement raises this quickly.',
      'A logged workout usually closes most of the gap on its own.',
    ],
  },
  zoneMinutes: {
    measures: 'Minutes spent in zone 2+ heart-rate effort today (moderate or vigorous; vigorous counts double).',
    against: 'WHO’s ~22 min/day guideline (150 min/week of moderate activity).',
    high: 'You’ve hit a solid block of elevated-effort time today.',
    low: 'Little sustained elevated-effort time today.',
    remediate: [
      'A brisk walk, run, or ride that raises your heart rate counts.',
      'Even 2–3 short bouts across the day add up.',
    ],
  },
  moveHours: {
    measures: 'How many of your waking hours had at least some detected movement.',
    against: 'Avoiding long unbroken sedentary stretches — moving at least briefly most hours.',
    high: 'You broke up sitting well today.',
    low: 'Long sedentary stretches today — common on desk/travel days.',
    remediate: [
      'Stand or walk a few minutes each hour.',
      'Use a timer or reminder to get up regularly.',
    ],
  },
  strengthFreq: {
    measures: 'How many strength sessions you’ve logged in the last 7 days.',
    against: 'Your weekly training-frequency goal — rewards training beyond the WHO 2×/week floor.',
    high: 'You’re training at or above your weekly frequency goal.',
    low: 'Fewer sessions than your weekly goal in the last 7 days.',
    remediate: [
      'Fit in a session, even a short one — frequency matters more than any single session’s length.',
      'During a deliberate deload or rest phase this is expected to dip.',
    ],
  },
  strengthVolume: {
    measures: 'Total logged training volume (sets × reps × weight) over the last 7 days.',
    against: 'Your typical session volume × your weekly frequency goal.',
    high: 'Solid training volume this week relative to your norm.',
    low: 'Lower training volume than usual this week.',
    remediate: [
      'Build volume gradually week to week rather than jumping sharply.',
      'A deload week is expected to show low volume here — that’s by design.',
    ],
  },
}

// Composite (camelCase) → canonical Oura (snake_case) key aliases.
const ALIASES: Record<string, string> = {
  restingHeartRate: 'resting_heart_rate',
  previousNight: 'previous_night',
  hrvBalance: 'hrv_balance',
  temperature: 'body_temperature',
  sleepBalance: 'sleep_balance',
  prevDayActivity: 'previous_day_activity',
  recoveryIndex: 'recovery_index',
  activityBalance: 'activity_balance',
}

export function guideFor(key: string): ContributorGuide | null {
  return GUIDE[key] ?? GUIDE[ALIASES[key]] ?? null
}
