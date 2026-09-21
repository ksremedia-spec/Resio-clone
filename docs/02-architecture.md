# 02 · Architecture Proposal

## Goals ranked (from the brief)
1 Reliability · 2 Security · 3 Maintainability · 4 iPad performance · 5 Offline · 6 macOS portability · 7 Scalability.

## Topology

```
┌──────────────────────────── iPad client (apps/ipad) ────────────────────────────┐
│  React 19 + TypeScript, iPad-first UI, Capacitor native shell (camera, files,    │
│  haptics, keyboard, share sheet). Local store: IndexedDB (Dexie) + outbox queue. │
│  Sync engine: pull (cursor) / push (idempotent mutations) / conflict resolution. │
└───────────────────────────────┬─────────────────────────────────────────────────┘
                                │ HTTPS · JSON · Bearer session token
┌───────────────────────────────▼─────────────────────────────────────────────────┐
│  API (apps/api) — Fastify 5, TypeScript                                          │
│  routes → services (all business logic) → repositories (Drizzle ORM)             │
│  cross-cutting: auth, tenant scope, permissions, validation (zod), audit,        │
│  notifications, rate limit, OpenAPI                                              │
│  providers: StorageProvider, EmailProvider, PaymentProvider, AccountingProvider, │
│             CalendarProvider, SmsProvider, WeatherProvider, AiProvider           │
└───────────────┬────────────────────────────┬───────────────────────────────────┘
                │                            │
     PostgreSQL 16 (Drizzle migrations)   Object storage (local disk in dev,
     one schema, `organization_id` on      S3-compatible in prod, signed URLs)
     every tenant table
```

Shared code lives in **packages/core** (money, permissions, calculations,
API contracts). It is imported by the API and the client, so estimate maths,
schedule cascading and permission checks are identical offline and online.

## Decision: client technology

| Option | Pros | Cons |
|---|---|---|
| SwiftUI native | Best-in-class iPad feel; free macOS via multiplatform | Cannot be compiled or tested in a Linux CI/dev container; two implementations of every calculation (Swift + TS) violates "logic once" |
| React Native | Native widgets | Weak split-view / drag-drop story on iPad; also untestable here |
| **React + Capacitor (chosen)** | One codebase testable with Playwright at iPad viewports; native plugins for camera, filesystem, haptics, keyboard, share; the same iPad build runs on Apple-silicon Macs ("Designed for iPad") and a Mac Catalyst/Electron target is a packaging change, not a rewrite | Must be *designed* as an iPad app (sidebar, split view, sheets, gestures) rather than a responsive site — this is enforced by the design system and UI tests |

The brief forbids "wrapping a responsive website". Buildline therefore ships an
iPad interaction model (persistent sidebar, two-column split views, sheets and
popovers, swipe actions, drag-and-drop, keyboard shortcuts, 44-pt targets,
safe-area aware, landscape-first) and a native shell. There is no "mobile web"
layout; portrait iPad collapses the sidebar into an overlay.

## Decision: backend technology

* **Fastify 5** on Node 22 — fast, schema-first, first-class OpenAPI.
* **PostgreSQL 16** with **Drizzle ORM** — typed schema in TypeScript, SQL
  migrations committed to the repo, real relational integrity.
* **Money**: `bigint` cents in Postgres, `number` cents in TS (safe to 2^53),
  percentages as basis points (1 % = 100 bp). Rounding is explicit
  (`roundHalfUp`) and lives in `packages/core/src/money.ts`.
* **Auth**: email/password (scrypt), opaque session tokens stored hashed,
  per-org membership, magic links for portals. Provider interface prepared for
  Apple / Google / Microsoft / SSO.
* **Tenant isolation**: every tenant table has `organization_id`; the
  repository layer accepts an `OrgScope` and every query is filtered by it;
  tests assert cross-tenant reads/writes are rejected. Row-level security
  policies are also generated in the migration as defence in depth.
* **Audit**: `activity_log` written inside the same transaction as the change.
* **Files**: `StorageProvider` (local disk in dev/tests, S3-compatible in
  production). Database stores metadata only. Downloads use signed, expiring
  URLs.

## Layering rules (enforced by folder structure)

```
apps/api/src/
  routes/       HTTP only: parse, call service, serialise. No SQL.
  services/     Business logic, permission checks, audit, notifications.
  repositories/ Drizzle queries, always scoped by organization.
  providers/    Interfaces + adapters for external systems.
  db/           schema.ts, migrations/, seed.ts
  plugins/      Fastify plugins (auth, error handling, rate limit, swagger)
```

Services are the only entry point for the AI tool layer, the sync endpoints,
and the HTTP routes — so authorization cannot be bypassed by a new caller.

## Offline-first (client)

```
UI ── reads ──▶ Local store (Dexie) ◀── pull sync (per-org cursor, per-project detail)
UI ── writes ─▶ Outbox (mutation, clientMutationId, baseVersion) ─▶ push sync
                 ▲                                                    │
                 └──── apply server result / conflict resolution ◀────┘
```

* Every mutable record carries `version` (int) and `updated_at`.
* Push is idempotent: `client_mutation_id` is unique per org; replays return
  the original result.
* Conflicts: server compares `baseVersion`; last-writer-wins for scalar fields
  with a recorded conflict entry, append-only records (logs, photos, time
  entries, messages) never conflict. Nothing is discarded: a rejected
  mutation stays in the outbox flagged `needs_attention`.
* Photos captured offline are stored in the app's filesystem and uploaded when
  online; the daily log references them by local id until then.

## Security controls

Server-side permission check in every service · tenant scope in every
repository · zod validation on every input · rate limiting on auth and portal
routes · hashed tokens · session invalidation on password change / deactivate
· signed file URLs · HTTPS only (HSTS in production config) · audit log ·
secrets from environment only · RLS policies.

## Phases

Phase 1 Foundation → Phase 2 Project core → Phase 3 Financial core → Phase 4
Client experience → Phase 5 Field experience → Phase 6 AI → Phase 7 Advanced.
The full database schema (all phases) is defined up-front so that later phases
add services and UI, not migrations that reshape core tables.
