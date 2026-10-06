// #2120. The phrase that unlocks account deletion — typed by the user in the sheet AND required in
// the request body, so the route refuses a deletion that did not come through the typed step (a
// replayed or hand-written request) as well as the button refusing one that did not type it.
export const ACCOUNT_DELETION_PHRASE = 'DELETE'
