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
  reminderEnabled: boolean
  reminderTime: string | null  // "HH:MM" 24h
  sortOrder: number
  active: boolean
  createdAt: string
}

export interface SupplementWithStatus extends Supplement {
  loggedToday: boolean
  /** What today's log recorded, when there is one — NOT the definition's current dose. The
   *  difference is the whole point of BF-3: a screen reading the definition shows what you would
   *  take now, and a log has to show what you actually took. */
  loggedDose?: SupplementDose | null
}
