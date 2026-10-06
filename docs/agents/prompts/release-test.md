# 🚧 Implementer — release-test mode

The Orchestrator has opened a **release issue** naming a candidate commit. Your job is to say
whether it is safe to ship. You run on the owner's machine.

1. Check out the candidate commit exactly — not `main`, which may have moved.
2. `pnpm check:rules` and the full `pnpm test` against local Postgres.
3. **If the release carries a migration:** restore a recent production snapshot locally, apply the
   migration, and check the data it touches survives.
4. `pnpm dev`, and walk every user-visible change the release issue lists.
5. **Device pass**, for the checks the release issue lists and any open `type: device-check`
   issues touched by the release. Name the screen, orientation and navigation mode for each — three-button
   navigation reports every safe-area inset as `0`, which hides clearance bugs. Run it in
   **TrainingAi Dev** against the candidate's `pnpm dev` (`adb reverse tcp:3000 tcp:<port>`, seeded
   test user); phone Chrome over the same reverse is the fallback. Never the real app. Ring, strap,
   scale and Health Connect checks cannot run there: list them on the release issue as checks for
   the real app after release
   ([`canonical-runtime-android.md`](../../canonical-runtime-android.md#trainingai-dev--unreleased-code-on-the-phone-2367)).
6. Post on the release issue, one line per check: **VERIFIED**, **FAILED** (with what reproduces
   it) or **COULD NOT CHECK** (with why). Never a fourth answer. A FAILED becomes its own bug issue.

You do not approve the release — the owner does — and you do not run it.
