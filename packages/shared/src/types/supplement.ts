/** How much of a substance, as a number the app can do arithmetic on. */
export interface SupplementDose {
  /** Null when the supplement has only a free-text dose, which is every row that predates BF-3. */
  amount: number | null
  unit: string | null
  /** The definition's free-text `dose` as it read at the time. The snapshot that makes a titration
   *  survive a dose change even for a supplement nobody ever entered as a number. */
  doseText: string | null
}

export interface Supplement {
  id: string
  userId: string
  name: string
  /** Free text ("2 mg", "1 scoop"). Still the display fallback; `defaultAmount`/`unit` are the
   *  structured form a log stamps and a correlation can use. */
  dose: string | null
  /** Optional on the TYPE, always set by the server mapper. Optional so the Lane B call sites that
   *  build a Supplement literal keep compiling until that lane adds the fields to its own UI —
   *  making them required would edit five files another session owns for no behavioural gain. */
  defaultAmount?: number | null
  unit?: string | null
  /**
   * The presence window (BF-69). A date OUTSIDE it is a TRUE ZERO; a date INSIDE it with no
   * contribution is UNKNOWN and must be excluded from an aggregate, never coerced to 0.
   *
   * Optional on the type for the same reason as `defaultAmount` above — the Lane B call sites that
   * build a `Supplement` literal keep compiling until that lane adds the fields to its own UI.
   */
  startedOn?: string | null
  stoppedOn?: string | null
  /** "Ask me when logging" — the variable-dose flag, for a substance on a titration schedule. */
  dosePrompt?: boolean
  reminderEnabled: boolean
  reminderTime: string | null  // "HH:MM" 24h
  sortOrder: number
  active: boolean
  createdAt: string
}

/** The day's exposure to one substance, summed from its live contributions (BF-69). */
export interface SupplementDayAmount {
  /** Null when no contribution on the day carried a number — a tick means "taken", not "took none
   *  of it", and 0 would be the "unknown coerced to zero" mistake one level down. */
  amount: number | null
  /** The unit of the first contribution carrying one. Contributions of one substance are recorded
   *  in one unit in practice; a mixed-unit day would need converting, which is not this stage. */
  unit: string | null
  /** How many separate acts of taking it the amount came from. A day with two is not a bug. */
  contributions: number
}

export interface SupplementWithStatus extends Supplement {
  /** BF-69 — the checked state of the supplements page's tick, so this tracks the MANUAL
   *  contribution specifically rather than "was it taken today". A meal's dose turning it on would
   *  leave a control that refuses to turn off; `loggedAmount` is what answers the day-level
   *  question. */
  loggedToday: boolean
  /** What today's log recorded, when there is one — NOT the definition's current dose. The
   *  difference is the whole point of BF-3: a screen reading the definition shows what you would
   *  take now, and a log has to show what you actually took. */
  loggedDose?: SupplementDose | null
  /**
   * BF-69 — the day's TOTAL across every live contribution, which `loggedDose` cannot be once a
   * second writer exists. Present whenever the day has any contribution at all; its own `amount`
   * is null when none of them carried a number.
   */
  loggedAmount?: SupplementDayAmount | null
}
