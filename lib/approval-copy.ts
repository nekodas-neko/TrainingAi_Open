/**
 * The one sentence that explains why a new account cannot sign in yet (LA-162).
 *
 * Two screens say it — the `?registered=1` toast on sign-in and the `/pending` page a new sign-in
 * lands on — and they disagreeing is the bug this exists to prevent: the toast read *"Sign in below —
 * or wait for approval if not yet invited"*, which was true while an invite activated the account and
 * stopped being true when `RV-192` made **every** password registration start inactive. A registrant
 * who followed it signed in and landed on `/pending`, reading the opposite advice.
 */
export const AWAITING_APPROVAL_SENTENCE =
  'Access will be granted once an admin approves it — usually within a day.'
