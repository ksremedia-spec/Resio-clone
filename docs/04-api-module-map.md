# 04 · API and Module Map

REST, JSON, versioned under `/v1`. OpenAPI served at `/docs` (Swagger UI) and
`/docs/json`. Every non-auth route requires `Authorization: Bearer <session>`
and an active organization (`X-Organization-Id` header or the session's
default). Portal routes use `Authorization: Bearer <portal token>`.

Conventions: cursor pagination `?cursor=&limit=`; sorting `?sort=field:asc`;
filtering via explicit query params; every list is scoped by organization and
by permission; every mutation writes `activity_log`; errors are
`{ error: { code, message, details? } }`.

| Module | Routes (Phase) | Service | Permissions |
|---|---|---|---|
| Auth | `POST /v1/auth/register`, `/login`, `/logout`, `/logout-all`, `/password/forgot`, `/password/reset`, `/email/verify`, `GET /v1/auth/me` (1) | AuthService | – |
| Organizations | `GET/PATCH /v1/organization`, `GET /v1/organizations` (switch) (1) | OrganizationService | `org.manage` |
| Members & roles | `GET /v1/members`, `PATCH /v1/members/:id`, `POST /v1/invitations`, `GET /v1/invitations`, `POST /v1/invitations/:token/accept`, `GET/POST/PATCH /v1/roles` (1) | MembershipService, RoleService | `members.*`, `roles.manage` |
| Clients | CRUD `/v1/clients`, `/v1/clients/:id/contacts` (1) | ClientService | `clients.*` |
| Projects | CRUD `/v1/projects`, `/v1/projects/:id/members`, `/favorite`, `/archive`, `GET /v1/projects/:id/overview` (1) | ProjectService | `projects.*` |
| Dashboard | `GET /v1/dashboard` (1) | DashboardService | tile-level |
| Activity | `GET /v1/activity`, `GET /v1/projects/:id/activity` (1) | ActivityService | `activity.read` |
| Documents | `/v1/folders`, `/v1/documents`, `POST /v1/documents/upload`, `GET /v1/documents/:id/download` (signed) (1) | DocumentService, StorageProvider | `documents.*` |
| Notifications | `GET /v1/notifications`, `POST /:id/read`, `GET/PUT /v1/notification-preferences` (1) | NotificationService | own |
| Search | `GET /v1/search?q=` (1, extended each phase) | SearchService | per-entity |
| Sync | `GET /v1/sync/pull?since=`, `POST /v1/sync/push` (1 skeleton, 5 full) | SyncService | per-entity |
| Tasks & schedule | `/v1/projects/:id/phases`, `/v1/projects/:id/tasks`, `/v1/tasks/:id/dependencies`, `/v1/tasks/:id/move`, `/v1/tasks` (cross-project manager), `/v1/schedule/conflicts` (2) | ScheduleService | `schedule.*`, `tasks.*` |
| Daily logs | `/v1/projects/:id/daily-logs` (+entries, photos) (2) | DailyLogService | `daily_logs.*` |
| Messaging | `/v1/projects/:id/threads`, `/v1/threads/:id/messages`, `/read` (2) | MessageService | `messages.*` |
| Cost codes & catalog | `/v1/cost-codes`, `/v1/cost-catalog`, `/v1/estimate-templates` (3) | CatalogService | `estimates.*` |
| Estimates | `/v1/projects/:id/estimate` (+sections, lines, lock) (3) | EstimateService | `estimates.*` |
| Budget | `/v1/projects/:id/budget`, `/lines/:id/transactions` (3) | BudgetService | `budget.*` |
| Purchase orders / bills | `/v1/purchase-orders`, `/v1/bills`, `/match` (3) | ProcurementService | `purchasing.*`, `bills.*` |
| Change orders | `/v1/projects/:id/change-orders`, `/send`, `/void` (3) | ChangeOrderService | `change_orders.*` |
| Invoices & payments | `/v1/projects/:id/invoices`, `/send`, `/payments` (3) | InvoiceService, PaymentProvider | `invoices.*` |
| Proposals | `/v1/projects/:id/proposals`, `/release`, `/apply` (4) | ProposalService | `proposals.*` |
| Selections | `/v1/projects/:id/selections`, `/release` (4) | SelectionService | `selections.*` |
| Portal (client) | `/portal/client/*` with portal token: overview, schedule, logs, photos, documents, selections, approvals, change-orders, proposals, invoices, pay, messages (4) | PortalService | share flags |
| Portal (vendor) | `/portal/vendor/*`: bid requests, bids, tasks, documents, POs, messages, compliance (4) | VendorPortalService | share flags |
| Time clock | `/v1/time/clock-in`, `/clock-out`, `/break`, `/v1/time-entries`, `/approve`, `/export` (5) | TimeService | `time.*` |
| Leads | `/v1/leads`, `/convert` (3/4) | LeadService | `leads.*` |
| Vendors & bids | `/v1/vendors`, `/v1/bid-requests`, `/v1/bids` (3) | VendorService | `vendors.*` |
| Reports | `/v1/reports/*` (7) | ReportService | `reports.read` |
| AI | `POST /v1/ai/conversations`, `/messages`, `/confirm` (6) | AiService + tool registry | tool-level |
| Automations | `/v1/automations`, `/runs` (7) | AutomationService | `automations.manage` |

## Module dependencies

```
core(money, permissions) ─▶ auth ─▶ organizations/members/roles ─▶ clients ─▶ projects
projects ─▶ activity, documents, notifications, search, sync
projects ─▶ schedule/tasks ─▶ daily logs ─▶ time clock
projects ─▶ cost codes ─▶ estimates ─▶ proposals ─▶ budget ─▶ change orders ─▶ invoices ─▶ payments
budget ◀─ purchase orders ◀─ bills ; budget ◀─ time entries
estimates ─▶ selections ─▶ change orders
projects + documents + approvals ─▶ client portal / vendor portal
everything ─▶ AI tools (read/write through services only)
```
