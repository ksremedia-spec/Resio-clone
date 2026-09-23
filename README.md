# Buildline

iPad-first construction management platform for residential builders and
remodelers: projects, clients, schedules with dependencies, daily logs,
documents, messaging, financials, client and vendor portals, and an AI
assistant that works through the same permission-checked services.

The product reference for workflows is the publicly visible Ressio website;
the implementation, data model, branding and code are entirely our own.

## Repository layout

```
packages/core   Shared domain: money (integer cents), permissions + system roles,
                estimate/budget maths, schedule engine (dependencies, cascade,
                critical path, resource conflicts), zod API contracts.
apps/api        Fastify 5 + Drizzle + PostgreSQL 16 backend. Services own all
                business logic and authorization; routes are thin.
apps/ipad       React + Vite + Capacitor iPad client (sidebar + split views,
                sheets, drag/drop, offline cache and outbox sync).
docs/           Architecture, feature map, data model, API map, iPad
                navigation, MVP plan, permission matrix, deployment.
```

## Try it without any setup (demo mode)

Install Node.js 22+ from https://nodejs.org, then double-click
`start-demo.command` (macOS) or run `./start-demo.sh`. It installs, builds,
seeds demo data into an embedded database (PGlite, no PostgreSQL needed) and
opens http://localhost:4000. Plain-English instructions, demo accounts and
iPad-over-Wi-Fi steps are in `TESTING.md`.

## Developer quick start

Requirements: Node 22+, pnpm 10, PostgreSQL 16 reachable at
`postgres://postgres@localhost:5432` (or set `DATABASE_URL`; use
`pglite://./data/dev` for the embedded database).

```bash
pnpm install
pnpm db:migrate          # creates the database if missing and applies apps/api/drizzle/*.sql
pnpm db:seed             # demo organization "R. P. Valois & Co."
pnpm dev:api             # http://localhost:4000  (Swagger UI at /docs)
pnpm dev:ipad            # http://localhost:5173  (open at an iPad viewport)
```

Demo sign-in after seeding: `owner@demo.buildline.app` / `demo-password-123`
(team members `marcus@`, `priya@`, `tom@`, `rosa@`, `jake@demo.buildline.app`
share the same password and hold the Project Manager, Estimator, Office,
Field Supervisor and Field Crew roles).

## Tests

```bash
pnpm test                                 # core unit tests + API tests (real Postgres)
pnpm --filter @buildline/api test         # API only; uses buildline_test database
pnpm --filter @buildline/ipad test:ui     # Playwright at iPad Pro landscape/portrait
```

The API tests cover authentication, invitations and roles, tenant isolation,
permission enforcement, optimistic concurrency, documents and signed URLs,
schedule cascading and conflicts, daily logs, messaging and offline sync.

## Putting it on the company iPads

This build is for R. P. Valois & Co.'s own devices, not the public App Store.
`docs/11-server-setup.md` explains hosting the server in plain English and
`docs/10-testflight.md` explains installing the app on the company iPads
through TestFlight (or Ad Hoc). The iOS project lives in `apps/ipad/ios`
(bundle id `com.rpvalois.buildline`); the sign-in screen lets an installed
app be pointed at a different server without rebuilding.

## Documentation

* `docs/01-reference-analysis.md` – feature map and per-module analysis
* `docs/02-architecture.md` – architecture and technology decisions
* `docs/03-data-model.md` – entity relationship model
* `docs/04-api-module-map.md` – API/module map and dependencies
* `docs/05-ipad-navigation.md` – iPad navigation architecture
* `docs/06-mvp-and-dependencies.md` – MVP definition and build order
* `docs/07-permission-matrix.md` – permission matrix
* `docs/08-deployment.md` – environments, storage, email, production checklist
* `docs/09-ipad-client.md` – client architecture, offline engine, native build

## Status

All seven phases are implemented with tests: 1 (foundation), 2 (project
core), 3 (financial core), 4 (client experience), 5 (time clock, payroll
export, bid requests, vendor portal), 6 (AI assistant) and 7 (reports,
leads/CRM, automations, offline download).

The AI assistant works two ways. With `ANTHROPIC_API_KEY` set it uses Claude
(`AI_MODEL`, default `claude-sonnet-5`) through the Messages API with tool
use. Without a key it falls back to a built-in rule-based provider that
understands everyday questions, so the feature and its tests need no network.
Either way, every tool runs with the signed-in person's own permissions, and
anything that writes data is staged for a tap-to-confirm before it happens.

Automations react to activity events inside the same database transaction
that wrote the activity, so a rule can never fire for a change that rolled
back. Time-based rules (overdue invoices and to-dos, lead follow-ups) are
evaluated hourly by the API server and on demand from Settings → Automations.
Reports are computed from the same tables the screens use and download as CSV.
