import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canRetryAccountCheck } from '../src/features/account/session.ts';
import {
  birthYearOf,
  dateOfBirthForYear,
  editProfileField,
  fillFromServer,
  keysToSaveOnBlur,
  markProfileSaved,
  memberSinceLabel,
  profileFieldValue,
  profilePatch,
  programTile,
} from '../src/features/settings/data/profile.ts';

test('Member since reads the month the account was made in the user timezone', () => {
  assert.equal(memberSinceLabel('2025-03-14T02:00:00.000Z', 'Australia/Brisbane'), 'Mar 25');
  // 31 Dec 20:00 UTC is already 1 Jan in Brisbane: the label follows the user, not UTC.
  assert.equal(memberSinceLabel('2025-12-31T20:00:00.000Z', 'Australia/Brisbane'), 'Jan 26');
  assert.equal(memberSinceLabel('2025-12-31T20:00:00.000Z', 'UTC'), 'Dec 25');
});

test('Member since is blank, not "Invalid", without a usable timestamp', () => {
  assert.equal(memberSinceLabel(undefined, 'UTC'), null);
  assert.equal(memberSinceLabel('not a date', 'UTC'), null);
});

test('Member since is blank, not a crash, for a timezone Intl rejects', () => {
  assert.equal(memberSinceLabel('2025-03-14T02:00:00.000Z', ''), null);
  assert.equal(memberSinceLabel('2025-03-14T02:00:00.000Z', 'AEST'), null);
});

test('the sixth tile follows the current app: cycle, then tenure weeks, then Member since', () => {
  assert.deepEqual(
    programTile({ mode: 'cycle', cycleCurrent: 3, cycleTotal: 6, phaseName: 'Build' }, 'Mar 25'),
    { label: 'Build', value: '3/6' },
  );
  assert.deepEqual(
    programTile({ mode: 'cycle', cycleCurrent: 6, cycleTotal: 6, blockComplete: true }, null),
    { label: 'New block?', value: '6/6' },
  );
  assert.deepEqual(programTile({ mode: 'cycle', cycleCurrent: 2, cycleTotal: 4 }, null), {
    label: 'Cycle',
    value: '2/4',
  });
  assert.deepEqual(programTile({ mode: 'tenure', weeksRunning: 11 }, 'Mar 25'), {
    label: 'On program',
    value: '11w',
  });
  assert.deepEqual(programTile({ mode: 'tenure', weeksRunning: 4 }, 'Mar 25'), {
    label: 'On program',
    value: '4w',
  });
  assert.deepEqual(programTile({ mode: 'tenure', weeksRunning: 12 }, 'Mar 25'), {
    label: 'Review?',
    value: '12w',
  });
  assert.deepEqual(programTile(null, 'Mar 25'), { label: 'Member since', value: 'Mar 25' });
  assert.deepEqual(programTile({ mode: 'tenure' }, null), { label: 'Member since', value: '—' });
  assert.deepEqual(programTile(undefined, null), { label: 'Member since', value: '—' });
});

test('Birth year is read from the stored date of birth', () => {
  assert.equal(birthYearOf('1990-05-17'), '1990');
  assert.equal(birthYearOf(null), '');
  assert.equal(birthYearOf(undefined), '');
});

test('A typed birth year keeps the month and day already on the account', () => {
  assert.equal(dateOfBirthForYear('1991', '1990-05-17', 2026), '1991-05-17');
  assert.equal(dateOfBirthForYear('1991', null, 2026), '1991-01-01');
  // 29 Feb does not exist in 1991: fall back to the current app's 1 January rather than fail.
  assert.equal(dateOfBirthForYear('1991', '1992-02-29', 2026), '1991-01-01');
  assert.equal(dateOfBirthForYear('', '1990-05-17', 2026), null);
});

test('A birth year outside the web field limits is refused, not saved', () => {
  assert.throws(() => dateOfBirthForYear('1919', null, 2026));
  assert.throws(() => dateOfBirthForYear('2017', null, 2026));
  assert.throws(() => dateOfBirthForYear('90', null, 2026));
});

test('Saving the birth year patches dateOfBirth and nothing else', () => {
  assert.deepEqual(profilePatch({ birthYear: '1991' }, ['birthYear'], '1990-05-17'), {
    dateOfBirth: '1991-05-17',
  });
  assert.deepEqual(profilePatch({ heightCm: '180' }, ['heightCm']), { heightCm: 180 });
});

test('An old Profile details draft with a full date of birth fills Birth year and never clears it', () => {
  const user = {
    displayName: 'Sam',
    heightCm: 180,
    dateOfBirth: '1990-05-17',
    sex: 'male',
    activityLevel: 'moderate',
    fitnessGoal: 'build_muscle',
    timezone: 'Australia/Brisbane',
  };
  // Saved before Birth year existed: `dateOfBirth` is in it, `birthYear` is not.
  const old = {
    fields: {
      displayName: 'Sam',
      heightCm: '180',
      dateOfBirth: '1990-05-17',
      sex: 'male',
      activityLevel: 'moderate',
      fitnessGoal: 'build_muscle',
      timezone: 'Australia/Brisbane',
    },
    dirty: [] as string[],
  };
  const keys = ['displayName', 'heightCm', 'birthYear', 'sex', 'timezone'];
  const filled = fillFromServer(old.fields, old.dirty, user, keys);
  assert.equal(filled.birthYear, '1990');
  // Blur on an untouched Birth year saves nothing; even if it were asked for, a draft with no
  // `birthYear` key patches no dateOfBirth at all, so the stored date cannot be nulled.
  assert.deepEqual(profilePatch(old.fields, ['birthYear'], user.dateOfBirth), {});
  assert.ok(!('dateOfBirth' in profilePatch(old.fields, keys, user.dateOfBirth)));
  // A key the user edited is left alone by the refill.
  assert.equal(fillFromServer({ ...old.fields, birthYear: '1991' }, ['birthYear'], user, keys).birthYear, '1991');
  // Clearing the field on purpose still clears it.
  assert.deepEqual(profilePatch({ birthYear: '' }, ['birthYear'], user.dateOfBirth), { dateOfBirth: null });
});

test('Tapping into Birth year and out again keeps the birth year and sends nothing', () => {
  const user = { dateOfBirth: '1990-05-17', displayName: 'Sam', heightCm: 180, sex: 'male', timezone: 'Australia/Brisbane' };
  const keys = ['displayName', 'heightCm', 'birthYear', 'sex', 'timezone'];
  // The screen opens: every field is filled from the account.
  let draft = {
    fields: Object.fromEntries(keys.map((key) => [key, profileFieldValue(user, key)])),
    dirty: [] as string[],
  };
  assert.equal(draft.fields.birthYear, '1990');
  // The draft is stored on the phone between opens.
  draft = JSON.parse(JSON.stringify(draft));
  // Tap into the field and out of it again, three times: no keystroke, so nothing is dirty and
  // leaving the field saves nothing.
  for (let i = 0; i < 3; i++) assert.deepEqual(keysToSaveOnBlur(draft, 'birthYear'), []);
  assert.equal(draft.fields.birthYear, '1990');
  assert.deepEqual(draft.dirty, []);
  // A refill from the server (the account refreshed behind the screen) keeps the year too.
  assert.equal(fillFromServer(draft.fields, draft.dirty, user, keys).birthYear, '1990');
  // Typing into a different field and leaving it never sends the birth year.
  draft = editProfileField(draft, 'displayName', 'Sam B');
  const keysSaved = keysToSaveOnBlur(draft, 'displayName');
  assert.deepEqual(keysSaved, ['displayName']);
  assert.deepEqual(profilePatch(draft.fields, keysSaved, user.dateOfBirth), { displayName: 'Sam B' });
  draft = markProfileSaved(draft, keysSaved, draft.fields);
  assert.equal(draft.fields.birthYear, '1990');
  assert.deepEqual(draft.dirty, []);
  // Editing the year and leaving it saves the new year with the old month and day.
  draft = editProfileField(draft, 'birthYear', '1991');
  assert.deepEqual(profilePatch(draft.fields, keysToSaveOnBlur(draft, 'birthYear'), user.dateOfBirth), {
    dateOfBirth: '1991-05-17',
  });
});

test('A field typed over while its save was in flight stays dirty', () => {
  let draft = editProfileField({ fields: { displayName: 'A' }, dirty: [] }, 'displayName', 'Ab');
  const sent = { ...draft.fields };
  draft = editProfileField(draft, 'displayName', 'Abc');
  assert.deepEqual(markProfileSaved(draft, ['displayName'], sent).dirty, ['displayName']);
});

test('Retry account check is offered only when the account check did not finish cleanly', () => {
  const profile = { id: 'u', email: 'a@b.c', name: null, timezone: null, signInProviders: [] };
  const signedIn = { hasSession: true, profile, message: null } as Parameters<typeof canRetryAccountCheck>[0];
  assert.equal(canRetryAccountCheck(signedIn), false);
  assert.equal(canRetryAccountCheck({ ...signedIn, profile: null }), true);
  assert.equal(canRetryAccountCheck({ ...signedIn, message: 'Could not check your account.' }), true);
  assert.equal(canRetryAccountCheck({ hasSession: false, profile: null, message: null }), false);
});
