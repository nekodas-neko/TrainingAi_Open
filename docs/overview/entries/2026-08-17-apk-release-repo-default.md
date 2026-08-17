# 2026-08-17 — Q-457: the APK release lookup defaulted to the repo it had just left

**Branch:** `claude/implementation-lane-b-0o7kb9` · **No version bump** — no user-visible change while `APK_RELEASE_REPO` is set · **Lane:** Implementation B

## What was wrong

```ts
const APK_RELEASE_REPO = process.env.APK_RELEASE_REPO ?? 'nekodas-neko/TrainingAI'
```

The fallback was the **pre-cut, archived, private** repository. Correct before the public-repo
migration, a trap after it, in two directions:

- **Deployment.** If the variable is ever unset, cleared, or missed on a new environment, the app
  reads releases from an archived repo whose APK never changes again — and fails *looking like
  something else*: a 404 surfacing as "Could not fetch release info" rather than as a
  misconfiguration. `CLAUDE.md` records this exact surface being dead for two weeks over the related
  `GITHUB_RELEASES_TOKEN` question, which is why the shape matters more than the odds.
- **Public clone.** The default pointed at a repo the cloner cannot read at all, so the update card
  and More → Download APK were broken out of the box with no indication why.

Premise re-verified against `main` before changing anything: the literal, both test fixtures, and the
comment block that already described the variable as "no longer optional in practice".

## What shipped

The default is now `nekodas-neko/TrainingAi_Open`, so an unset variable degrades to *correct* rather
than to a silent dead end. It stays a fallback rather than becoming a required variable, for the
reason the original comment gave and which still holds: throwing here would take down the More screen
over a stale env var, which is worse than a stale version number.

## The guard is the interesting half

The entry noted the two fixtures at `github-release.test.ts:49,58` "pin the old repo's URL and so
would not catch the flip". Updating them to the new URL — the literal instruction — would have left
that still true: they assert on a **payload** that a test author writes, so they say nothing about
which repository the module actually *asks*. That is precisely how the wrong default survived the
migration with a green suite.

So the fixtures were updated **and** a real guard added: it asserts on the URL passed to `fetch`,
with `APK_RELEASE_REPO` unset (which is the suite's environment, asserted explicitly so the test
cannot quietly become vacuous if someone sets it). Mutation-checked — putting the old default back
fails it:

```
Expected: "/repos/nekodas-neko/TrainingAi_Open/"
Received: "https://api.github.com/repos/nekodas-neko/TrainingAI/releases/tags/apk-latest"
```

## What was NOT exercised

- **Railway.** This session cannot read the deployment's environment. `CLAUDE.md` states
  `APK_RELEASE_REPO` is set to the public repo, so **this was never a live outage** — the entry says
  so too, and it should not be written up as one. What changed is that the default is no longer a
  trap.
- **A real GitHub call.** The test mocks `fetch`; nothing here confirms the public repo's
  `apk-latest` release resolves. That is separately evidenced — `CLAUDE.md` records it verified in a
  logged-out browser on 2026-08-17.
- **The device.** No APK was built or installed.

## Path ownership

`lib/github-release.ts` and its test are listed by neither lane. Lane A's baton recorded no claimed
paths, so Lane B took it and recorded the claim in its own baton for the duration.
