# 🚧 Implementer — release-test mode

The Orchestrator has opened a **release issue** naming a candidate commit. Your job is to say
whether it is safe to ship. You run on the owner's machine.

1. Check out the candidate commit exactly — not `main`, which may have moved.
2. `pnpm check:rules` and the full `pnpm test` against local Postgres.
3. **If the release carries a migration:** restore a recent production snapshot locally, apply the
   migration, and check the data it touches survives.
4. `pnpm dev` with its output saved to a file, then the route smoke against it:
   `BASE_URL=http://localhost:<port> SERVER_LOG=<that file> node scripts/ci/route-smoke.mjs`. It signs
   in as the seeded user, GETs the main pages and read routes, and fails on an unexpected status or
   an error in the server log (#3919). CI runs the same script on every code PR (`Route smoke`).
   Then walk every user-visible change the release issue lists.
4a. **The same smoke against a production build** (#3933), once the dev server is stopped (`next
   build` beside a running `pnpm dev` runs out of memory). A production server needs Postgres over
   SSL, reads the model constants from `.oura-constants/`, and lists the ONNX models in object
   storage at boot; the scripts provide all three (the last as a local MinIO holding placeholder
   files, never the real bucket) and leave every guard as it is:
   ```
   export DATABASE_URL=$(scripts/ci/start-ssl-postgres.sh)   # Docker, port 5434, SSL on
   eval "$(scripts/ci/start-local-s3.sh)"                    # Docker, port 9100, placeholder models
   node scripts/local-db/migrate.js && psql "$DATABASE_URL" -f scripts/local-db/seed.sql
   scripts/ci/route-smoke-prod.sh                            # build, next start, smoke
   docker rm -f trainingai-ssl-postgres trainingai-local-s3
   ```
   `route-smoke-prod.sh` refuses a non-local `DATABASE_URL` or `STORAGE_ENDPOINT`. Inference on a
   placeholder takes its fallback; the smoke calls none. CI runs it after every merge to `main`
   (`Route smoke (production build)`); quote that run for the candidate commit if it is green, and
   run it here when it is not, or when the candidate has no run.
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
