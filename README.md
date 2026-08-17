# TrainingAI

Personal AI-powered gym training tracker and health dashboard. Logs workouts, tracks body
metrics, sleep, mood and biometrics, ingests Oura Ring data, and provides AI-driven periodization
and analysis via Gemini.

> **No third-party model weights are included in this repository.** A clone will build, start and
> pass its test suite, and the Oura-derived health figures will be unavailable until a source for
> them is configured — the application fetches them at runtime and fails the boot in production
> rather than serving a degraded result quietly. See [`NOTICE`](./NOTICE) for what that means, and
> `lib/oura-models/constants/README.md` for the mechanics.

Runs as an offline-first PWA (with a Capacitor Android shell) on a Samsung Galaxy S25 Ultra.
Deployed on Railway, auto-deploys from `main`.

> **New to the codebase?** Read [`CLAUDE.md`](CLAUDE.md) — it is the authoritative, up-to-date
> description of the stack, data model, key files, conventions, and the Oura integration. Then
> [`projectOverview.md`](projectOverview.md) for current status and what's left to do.

---

## Tech Stack

| Layer | Detail |
|---|---|
| Framework | Next.js 15 + React 19 + TypeScript |
| Styling | Tailwind CSS v4 + Radix UI + shadcn/ui |
| AI | Google Gemini 3.1 Flash Lite via `@ai-sdk/google` |
| Database | PostgreSQL on Railway via Drizzle ORM (`DATABASE_URL`) |
| Offline store | On-device SQLite (`@capacitor-community/sqlite`) — the offline-first source of truth, synced to Postgres via a mutation outbox |
| Auth | Google OAuth2 + credentials — session stored in a JWT cookie |
| Biometrics | Oura Ring v2 Cloud API (readiness, sleep, HRV, SpO₂, activity) |
| Native shell | Capacitor (Android) |
| Hosting | Railway — auto-deploys from `main` |
| PWA | Service worker + Next.js manifest/icons |

---

## Architecture at a glance

- **Offline-first.** The on-device SQLite local store is the source of truth; the API/Postgres is
  backup + cross-device sync. Writes go to the local store **and** a mutation outbox, which pushes
  to the server in the background. UIs read local-first and fall back to the API. (Full rules in
  `CLAUDE.md`.)
- **Fully user-defined training.** No hardcoded session names or training cycles — programs,
  progression styles, and schedules all live in the DB and are edited in-app.
- **AI periodization.** A Gemini-driven engine prescribes sets/reps/intensity per session from RPE
  trend, ACWR, sleep/HRV, soreness and volume, with deterministic guards (emergency deload, phase
  ceilings) that never depend on an LLM's self-reported number.
- **Timezone-correct.** All "today" dates use the user's timezone (AEST default) via
  `lib/date-utils.ts`, never raw UTC.

See the **Data Model** and **Oura Ring v2 API Integration** sections of `CLAUDE.md` for the full
table list and endpoint mapping.

---

## Feature areas

- **Home** — Oura score chips, readiness card, Body Battery, day timeline (wakeup/workouts/meals/walks),
  training recommendation, customizable widgets.
- **Workout** — four-mode flow (pre → active → summary → done) with per-set logging, rest/set timers,
  RPE capture, live 1RM readout, supersets/circuits, injury-aware substitution.
- **Health** — Body / Training / Progress tabs; Oura detail pages (readiness/sleep/heart-rate/activity)
  with AI insight cards, hypnogram, trends, ACWR/training-load.
- **Nutrition** — food logging (scan/barcode/manual/saved meals), macro rings, supplements, End-of-Day
  review.
- **More** — programs & progression-style editor, profile, friends/leaderboard, achievements, admin.

---

## Environment Variables

Required in Railway (see `CLAUDE.md` § Environment Variables for the authoritative list):

```env
DATABASE_URL=                   # PostgreSQL connection string
SESSION_SECRET=                 # JWT signing
GOOGLE_CLIENT_ID=               # OAuth
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=
GOOGLE_GENERATIVE_AI_API_KEY=   # Gemini
HEALTH_CONNECT_INGEST_SECRET=   # Tasker auth for the (currently dormant) HC ingest route
WEBHOOK_USER_ID=
NEXT_PUBLIC_THUNDERFOREST_API_KEY=  # optional — Atlas map tiles; falls back to OSM when unset (must be referrer-restricted)
```

---

## Running Locally

Use **pnpm** (Railway deploys with `pnpm install --frozen-lockfile`):

```bash
pnpm install
pnpm dev            # dev server (picks up .env.local)
pnpm build          # production build
pnpm start          # production server
pnpm lint           # lint
pnpm test           # unit tests
```

Open [http://localhost:3000](http://localhost:3000).

**Local database (Claude Code on the web):** sessions can't reach the production Railway Postgres,
so `pnpm db:local` provisions a local Postgres 16 instance (port 5433) with all migrations applied
and seed data. It runs automatically at session start; re-running is idempotent. Full details in
`CLAUDE.md` § Local Development Database.

---

## Documentation map

| Doc | Purpose |
|-----|---------|
| [`CLAUDE.md`](CLAUDE.md) | Authoritative architecture, data model, key files, conventions, Oura integration |
| [`projectOverview.md`](projectOverview.md) | Lean index — current status, Known Issues & Risks, What's Left To Do |
| [`docs/implementation-backlog.md`](docs/implementation-backlog.md) | Priority-ordered queue of ready-to-build work |
| [`docs/planned_upgrades.md`](docs/planned_upgrades.md) | Open uplift ideas/findings |
| [`docs/overview/`](docs/overview/) | Session journal (completed work, batched) + shipped-uplift archive |
| [`docs/oura-ring-data-reference.md`](docs/oura-ring-data-reference.md) | Oura v2 field reference |
| [`docs/device-smoke-checklist.md`](docs/device-smoke-checklist.md) | On-device verification steps (Samsung S25) |
