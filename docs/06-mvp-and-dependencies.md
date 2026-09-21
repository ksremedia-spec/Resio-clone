# 06 · MVP Definition and Module Dependencies

## MVP (from the brief §48) mapped to phases

| # | Capability | Phase | Status |
|---|---|---|---|
| 1 | Create an organization | 1 | ✅ |
| 2 | Invite employees (roles) | 1 | ✅ |
| 3 | Create clients | 1 | ✅ |
| 4 | Create projects | 1 | ✅ |
| 5 | Create project schedules (phases, tasks, dependencies, cascade) | 2 | ✅ |
| 6 | Assign tasks | 2 | ✅ |
| 7 | Create daily logs | 2 | ✅ |
| 8 | Upload photos/documents | 1/2 | ✅ |
| 9 | Communicate within projects | 2 | ✅ |
| 10 | Create estimates | 3 | planned |
| 11 | Create budgets | 3 | planned |
| 12 | Create change orders | 3 | planned |
| 13 | Create invoices | 3 | planned |
| 14 | Secure client portal | 4 | planned |
| 15 | Track project activity | 1 | ✅ |
| 16 | iPad with intermittent connectivity | 1 (cache + outbox), 5 (full) | ✅ foundation |

## Build order and why

1. **core** — money/permissions/contracts have no dependencies and everything
   uses them.
2. **auth + organizations + roles** — tenant boundary must exist before any
   data.
3. **clients → projects** — the project is the root aggregate.
4. **activity, documents, notifications, search, sync** — cross-cutting
   services other modules call; built once here.
5. **schedule/tasks** — daily logs reference tasks; time entries reference
   tasks.
6. **daily logs, messaging** — depend on documents (photos) and tasks.
7. **cost codes → estimates → budget** — budget is derived from a locked
   estimate; nothing financial before this.
8. **change orders, POs, bills, invoices, payments** — all write to budget
   lines.
9. **proposals, selections, portals** — depend on estimates, approvals,
   documents, messaging.
10. **time clock + offline completion** — depends on tasks, sync engine.
11. **AI** — depends on stable services; tools call services only.
12. **reports, automations, integrations** — read-mostly consumers.

## Risks and mitigations

* Financial correctness — all maths in `packages/core` with unit tests and
  integer cents.
* Cross-tenant leakage — repository scoping + RLS + security tests.
* Offline data loss — outbox persisted in IndexedDB, never dropped, surfaced
  in UI.
* UI drifting to "responsive website" — design system components only; iPad
  viewport UI tests.
