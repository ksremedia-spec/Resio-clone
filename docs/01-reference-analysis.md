# 01 · Reference Analysis and Feature Map

Product name for this implementation: **Buildline**.

The functional reference is the publicly visible Ressio website and help centre
(www.ressiosoftware.com, help.ressiosoftware.com). Only observable workflows and
information architecture were studied; no source, assets, branding or backend
endpoints of the reference product are used anywhere in this repository.

## 1. What the reference product does (observed)

| Area | Observed behaviour | Buildline treatment |
|---|---|---|
| Company dashboard / Project Hub | All active jobs, activity timeline, budget summary, upcoming milestones, open approvals | Same, but ranked by *actionability* (overdue → approvals → conflicts → activity) |
| CRM / Leads | Lead fields (address, budget range, target start, project type, source), configurable pipeline stages, kanban + table, activity log, follow-up reminders, one-click convert to project with all data carried over | Same. Conversion creates Client + Project and links the Lead permanently |
| Estimating | 2–3 tier hierarchy (category / cost item / cost detail), cost codes (NAHB/CSI/custom), qty × unit cost → builder cost → markup → customer price, per-cost-type markups, allowances, templates, cost catalog with type-ahead, lock on approval → becomes live budget | Same. Money in integer cents, markup in basis points, all calculations in `packages/core` so the client can preview off-line with identical results |
| Proposals | Auto-populated from estimate, title/validity/terms, visibility toggles (categories only / items / details; show builder cost; show allowances), statuses Draft → Released → Completed → Cancelled, client approves via link, "apply to estimate" after approval | Same statuses; approval creates immutable `approvals` row; apply-to-estimate locks estimate and snapshots budget |
| Change orders | Flag estimate lines → CO pre-populated, add description/photos, magic-link approval (no login), timestamped approval/decline with client name, updates contract value + budget lines, flows to invoices, event log (created/sent/viewed/approved) | Full 13-step workflow from the brief; every state change is an `activity_log` + `approvals` row, never overwritten |
| Selections & approvals | Categories mirror estimate, choice groups with options and prices, allowance vs selected vs overage, release to client, approve/decline via link, approved selection updates budget and may trigger CO for overage | Same; overage above allowance auto-drafts a CO (never auto-sends) |
| Scheduling | Phases / tasks / milestones, List + Gantt in sync, FS/SS/FF dependencies with lag/lead, cascade on move, critical path, baseline, templates, copy from project, assign employees / subs / clients, sub accepts task from link, task-level public/private, undo/redo | Same; plus resource conflict detection (employee, crew, vendor, equipment) and calendar view; CPM engine in `packages/core` |
| Tasks / To-dos | Ticket-style manager grouped by date, 2-week window, overdue on top, filter by assignee/project/status/type, inline status change; to-dos are internal-only | Same; unified `tasks` table with `kind = schedule | todo` |
| Daily logs | Auto weather from site location, crew headcount by trade with +/-, work completed, delays by cause, photos (timestamped, geotagged, permanent), public/private for client, AI pre-draft | Same, plus voice notes, materials, equipment, visitors, tags; target < 60 s on iPad |
| Budget / job costing | Original / Approved changes / Revised / Committed / Actual (applied) / Invoiced / Paid / Variance, drill from cost code to bill / time entry / PO, committed from POs and accepted bids, QuickBooks mapping | Same columns; drill-down API returns the transaction list per cost code |
| Purchase orders & bills | PO ties to job + budget line, statuses Awaiting approval → Approved → Committed → Matched → Closed, bill matching with over-PO alerts, partial billing, unmatched bill queue | Same |
| Invoices & payments | Draw schedule, milestone, percentage-complete / cost-plus, retainage, statuses sent/viewed/partially paid/paid/overdue, card + ACH via provider, sync to accounting | Same statuses; `PaymentProvider` interface, no provider hard-coded |
| Time clock | Clock in/out from phone, project + cost code, supervisor clocks group, manual entries, office approval before payroll, export | Same plus breaks, offline queueing, corrections with audit |
| Client portal | Magic link, no account; schedule (full or selected phases), public logs, selections, COs, proposals, invoices + pay, documents, messages on tasks; internal notes/financials hidden | Same; separate route tree and separate token type |
| Vendor portal | Sees only its scope: assigned tasks, tagged specs/drawings, compliance docs with expiry reminders, task-level messages, POs, accept task from notification | Same |
| Documents | Files, photos, plan hub, specifications, versions, public/private at task level, QR access | Folders, versions, signed URLs, `StorageProvider` interface |
| Messaging | Job-centric feed, task-level threads, clients/subs on their own threads only | Threads scoped to project and optionally to any object |
| Mobile app | PWA, bottom bar (Projects, Schedule, To-dos, Logs, More), view-only when offline | **Improved**: native iPad shell, sidebar + split view, full offline create/edit with sync queue |
| AI ("Mason") | Q&A across projects, drafts estimates/COs/logs/schedules/invoices, risk summaries, automations with role permissions, scheduled triggers, MCP | Tool-calling assistant that runs through the same service layer + permission checks; destructive/outbound actions require explicit confirmation |
| Integrations | QuickBooks Online, payments, calendars, Drive/Gmail, CompanyCam, insurance | Adapter interfaces: `AccountingProvider`, `PaymentProvider`, `CalendarProvider`, `EmailProvider`, `StorageProvider`, `SmsProvider` |

## 2. Per-module analysis (template applied to every module)

Each module in `docs/modules/` (created as modules are built) answers:
1. Problem solved · 2. Roles · 3. Inputs · 4. Outputs · 5. Workflow · 6. Relationships ·
7. Edge cases · 8. Permissions · 9. iPad considerations · 10. Improvements.

The Phase 1 modules are analysed below.

### Organizations, users, roles
1. **Problem**: one company (tenant) with employees of differing responsibilities, plus outside parties (clients, vendors) that must see only what is shared.
2. **Roles**: Owner/Admin, Project Manager, Estimator, Office/Finance, Field Supervisor, Field Crew, Subcontractor/Vendor, Homeowner/Client.
3. **Inputs**: company profile, invitations (email + role), acceptance, password, profile.
4. **Outputs**: memberships, sessions, permission set.
5. **Workflow**: sign up → org created with Owner → invite → invitee accepts (existing or new account) → membership active. Deactivate revokes sessions.
6. **Relationships**: every record carries `organization_id`; project-level access adds `project_members`.
7. **Edge cases**: a user in multiple orgs (supported; session carries `active organization`), invite to an existing email, expired invites, last owner cannot be removed/demoted.
8. **Permissions**: `org.manage`, `members.invite`, `members.manage`, `roles.manage`.
9. **iPad**: settings as a split view (list of sections left, detail right); invite sheet.
10. **Improvements**: permission matrix editable per company (custom roles are stored rows, not code).

### Clients & contacts
1. Homeowners and their contacts (spouse, architect, designer) attached to projects.
2. PM, Estimator, Office, Owner.
3. Name, company, emails, phones, billing address, notes, portal invitation.
4. Client record linked to projects, proposals, invoices, portal access.
5. Create client → add contacts → attach to project → invite to portal.
6. Lead conversion creates client; invoices bill the project client.
7. Same person as client on two projects; client with no email (no portal).
8. `clients.read|write`.
9. Split view list/detail, contact cards with tap-to-call/mail.
10. Merge duplicates (later).

### Projects
1. The single connected record: everything hangs off a project.
2. All internal roles; external roles via `project_members` and sharing flags.
3. Name, number, client, address (geo for weather), type, contract type (fixed / cost-plus / T&M), status, dates, description, colour, favourites.
4. Hub with overview, counts and financial summary.
5. Create → assign team → (Phase 2+) schedule, logs, docs, estimate…
6. Parent of nearly every other table.
7. Archive with active invoices (blocked until resolved); project number uniqueness per org.
8. `projects.read|write|archive`; project membership for non-admin roles when `restrict_to_assigned_projects` is set on the role.
9. Sidebar → Projects list (searchable, favourites first) → project hub with segmented sections; field mode toggle.
10. Favourites and "recently opened" surfaced first; field mode with 6 big actions.

### Dashboard
1. What needs attention today across the company.
2. Owner, PM, Office (scoped by permissions); field roles see the field dashboard.
3. None (derived).
4. Active projects, overdue tasks, upcoming deadlines (7 days), pending approvals, unpaid invoices, budget warnings, schedule conflicts, recent activity, recent messages.
5. Read-only; every tile deep-links.
6. Reads across modules through the service layer (respects permissions).
7. Large orgs: every tile is paginated and count-capped server-side.
8. Individual tiles hidden when the permission is missing (server omits them).
9. Two-column card grid in landscape, single column in portrait.
10. No vanity charts; tiles are lists of things to do.

### Audit / activity history
1. Immutable record of who changed what.
2. All (write), Owner/PM (read), clients see only public entries.
3. Every mutating service call.
4. `activity_log` rows: actor, verb, object type/id, project, before/after diff, visibility.
5. Written in the same transaction as the change.
6. Feeds dashboard, project activity, client portal, AI summaries.
7. Financial diffs stored in cents; large text diffs truncated with hash.
8. `activity.read`; `client_visible` flag.
9. Timeline list, grouped by day.
10. Human-readable sentence rendered from structured data, never free text only.

### Documents & storage
1. Central place for plans, photos, contracts.
2. All internal; clients/vendors via sharing flags.
3. File upload (multipart or pre-signed), folder, project, visibility, tags, EXIF.
4. Versioned `documents`, `document_versions`, signed download URLs.
5. Request upload → provider signed URL or direct multipart → finalise → thumbnail job.
6. Attachments link any object to a document.
7. Duplicate names, huge files (limit + resumable later), offline capture queued.
8. `documents.read|write|share`.
9. Camera roll import, drag-drop into folder, Quick Look preview.
10. Photo metadata retained (taken-at, GPS, device) for daily-log evidence.
