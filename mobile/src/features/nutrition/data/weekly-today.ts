// The Nutrition tab's 7-day chart with today's figure taken from the phone (#3756).
//
// The chart read the server's weekly summary for every day, today included, while the energy card
// above it read the phone's own food store. A food logged offline, or not yet synced, moved the card
// and left today's bar and the week's average behind. Earlier days stay on the server's figures.

type Macros = { calories: number; proteinG: number; carbsG: number; fatG: number };
export type WeekDay = Macros & { date: string; logged?: boolean; isToday?: boolean };

export type TodayOnPhone = {
  date: string;
  /** `recordedIntake().intake`: the figure the energy card shows. */
  intake: number | null;
  /** The phone's own totals for today, for the protein, carbs and fat bars. */
  totals: Macros | null | undefined;
  /** Whether the phone holds food logs, or unsynced food edits, for today. */
  recorded: boolean;
};

/**
 * The week with today's row replaced by what the phone has recorded. With nothing recorded on the
 * phone for today the server's row stands, so a day logged on another device still draws.
 */
export function weekWithToday<T extends WeekDay>(days: readonly T[], today: TodayOnPhone): T[] {
  return days.map((day) => {
    if (day.date !== today.date || !today.recorded || today.intake == null) {
      return day;
    }
    return {
      ...day,
      proteinG: today.totals?.proteinG ?? day.proteinG,
      carbsG: today.totals?.carbsG ?? day.carbsG,
      fatG: today.totals?.fatG ?? day.fatG,
      calories: today.intake,
      // Every food removed on the phone leaves an unlogged day, not a day of eating nothing.
      logged: today.intake > 0,
    };
  });
}

/** The caption's "avg of N logged days": unlogged days are left out, never averaged in as zero. */
export function loggedAverage(days: readonly WeekDay[]) {
  const logged = days.filter((day) => day.logged !== false);
  return {
    days: logged.length,
    calories: logged.length
      ? Math.round(logged.reduce((sum, day) => sum + day.calories, 0) / logged.length)
      : null,
  };
}
