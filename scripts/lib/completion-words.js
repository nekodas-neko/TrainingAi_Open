'use strict'
/**
 * Does a queue heading announce that its entry is finished?
 *
 * Split out of `check-backlog-pointers.js` (LA-29) so the word list can be driven with fixtures.
 * It is the list, not the mechanism, that is delicate: every word here is one a heading might also
 * use as ordinary prose, and the two properties below are what keep the false-positive rate at zero
 * against the real file.
 *
 * **Case-sensitive, deliberately.** These are status stamps, written in caps by convention
 * (`✅ SHIPPED 2026-08-24:`), and the same words appear lowercase as prose in live entries —
 * TN-2 *"the Body Battery charge window has closed"* and BF-16b *"the retired all-primary
 * program"* are both open work that a case-insensitive match would flag. Adding an `i` flag here
 * fails both, which is the check crying wolf on its second day.
 *
 * **`ANSWERED` is NOT a completion word, and that is the distinction to preserve.** An investigation
 * can conclude while the action it identified is still owed — LA-27 answered *why* 76 estimates
 * cannot be re-derived and still owes the fix; Q-547 answered the deploy-churn half and still owes
 * a quiet-window baseline. Both are correctly in the queue. `CLOSED` carries no such reading: it
 * says nothing is owed, which is precisely when an entry must leave.
 */
const DONE =
  /(✅|\bSHIPPED\b|\bCOMPLETE\b|\bDONE\b|\bSUPERSEDED\b|\bDROPPED\b|\bFIXED\b|\bRESOLVED\b|\bCLOSED\b)/

function announcesCompletion(heading) {
  return DONE.test(heading)
}

module.exports = { DONE, announcesCompletion }
