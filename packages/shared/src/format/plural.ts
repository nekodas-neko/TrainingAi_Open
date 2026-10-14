/**
 * A count with its noun: `plural(1, 'set', 'sets')` is "1 set", `plural(3, 'set', 'sets')` is
 * "3 sets". The plural form is spelled out rather than derived, because English plurals are not
 * all `+ s` ("1 change" / "2 changes" is, "1 dose" / "2 doses" is, "1 entry" / "2 entries" isn't).
 *
 * The native app and the server each had a private copy (#2902); the singular-count fix in the
 * workout screens ("1 sets", #2849) should use this one.
 */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}
