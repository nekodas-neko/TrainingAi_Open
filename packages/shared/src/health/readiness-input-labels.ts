// Which readiness inputs a score is missing, in words. Shared by the web Readiness screen and the
// native one so a partial score reads the same on both (#2935).

const INPUT_LABELS: Record<string, string> = {
  sleep: 'sleep stages',
  hrv: 'overnight HRV',
  restingHeartRate: 'resting heart rate',
  temperature: 'body temperature',
  activity: 'daily activity',
}

/**
 * "Based on part of the usual picture — no sleep stages and overnight HRV today, so those factors
 * sit at neutral." null when nothing is missing. Text, never colour alone; names the missing
 * signals rather than any device, since which device supplies them is not the user's problem.
 */
export function limitedInputsNote(missing: readonly string[]): string | null {
  const names = missing.map(key => INPUT_LABELS[key] ?? key)
  if (names.length === 0) return null
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return `Based on part of the usual picture — no ${list} today, so those factors sit at neutral.`
}
