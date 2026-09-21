# 03 · Data Model (ERD)

All tenant tables carry: `id uuid pk`, `organization_id`, `created_at`,
`updated_at`, `created_by`, `updated_by`, `version int`, and `archived_at`
where soft-delete applies. Money columns are `bigint` cents; percentages are
`integer` basis points. The authoritative definition is
`apps/api/src/db/schema.ts`; migrations are in `apps/api/drizzle/`.

## Entity groups

```
IDENTITY                     CRM / CLIENTS               PROJECT
organizations                clients                     projects ──┬ project_members
users                        contacts                    project_phases
memberships (user↔org+role)  leads                       tasks ──── task_dependencies
roles                        lead_activities             task_assignees
role_permissions             vendors                     checklists / checklist_items
sessions                     vendor_contacts             daily_logs / daily_log_entries
invitations                  vendor_compliance_docs      time_entries
portal_access_tokens                                     documents / document_versions
                                                         folders
FINANCIAL                                                attachments (polymorphic)
cost_codes                   change_orders               comments (polymorphic)
cost_catalog_items           change_order_lines          message_threads / messages
estimate_templates           invoices / invoice_lines     message_participants / message_reads
estimates                    payments                    notifications
estimate_sections            purchase_orders / _lines     notification_preferences
estimate_line_items          bills / bill_lines           approvals (polymorphic, immutable)
proposals / proposal_signers selections / selection_options   activity_log (immutable)
budgets / budget_lines       specifications               automations / automation_runs
bid_requests / bids                                       ai_conversations / ai_messages
                                                         sync_mutations (idempotency)
```

## Key relationships

* `organizations 1─* memberships *─1 users`; membership has one `role`.
* `roles 1─* role_permissions` (permission keys from `packages/core`). System
  roles are seeded per organization and can be cloned/edited per company.
* `projects *─1 clients`; `projects 1─* project_members` (internal users,
  vendors, client contacts with `access_level`).
* `leads *─1 clients?`, `leads 1─1 projects?` (set on conversion).
* `tasks *─1 projects`, `tasks *─1 project_phases?`,
  `task_dependencies (predecessor, successor, type FS|SS|FF|SF, lag_days)`.
* `estimates 1─* estimate_sections 1─* estimate_line_items *─1 cost_codes`.
* `proposals *─1 estimates`; `proposal_signers`; `approvals` rows record each
  decision.
* `budgets 1─* budget_lines *─1 cost_codes`; a budget is created from the
  locked estimate; lines keep `original_cents`, and computed columns come from
  `change_order_lines`, `purchase_order_lines`, `bills`, `time_entries`,
  `invoice_lines`, `payments`.
* `change_orders 1─* change_order_lines *─1 budget_lines?`.
* `invoices 1─* invoice_lines`, `invoices 1─* payments`.
* `selections 1─* selection_options`; `selections *─1 estimate_line_items?`.
* `daily_logs 1─* daily_log_entries` (typed entries: crew, work, material,
  equipment, visitor, issue, delay, note, voice) and attachments.
* `documents 1─* document_versions`; `attachments (object_type, object_id,
  document_id)` link a document to any record.
* `message_threads (project_id, object_type?, object_id?) 1─* messages`.
* `activity_log (actor_id, verb, object_type, object_id, project_id, diff jsonb,
  client_visible)` — append-only, no UPDATE/DELETE grants.
* `approvals (object_type, object_id, decision, decided_by_user_id |
  decided_by_contact_id, signature_document_id, snapshot jsonb)` — append-only.

## Status enums (selected)

* project: `lead | pre_construction | active | on_hold | complete | archived`
* task: `not_started | in_progress | blocked | complete | cancelled`
* estimate: `draft | locked`
* proposal: `draft | released | approved | declined | cancelled`
* change_order: `draft | pending_internal | sent | viewed | approved | declined | void`
* invoice: `draft | sent | viewed | partially_paid | paid | overdue | void`
* purchase_order: `draft | awaiting_approval | approved | committed | matched | closed | void`
* bill: `draft | approved | scheduled | paid | void`
* selection: `pending | released | approved | declined`
* time_entry: `open | submitted | approved | rejected | exported`

## Indexing strategy

Every tenant table: `(organization_id, id)` and `(organization_id, updated_at)`
for sync; project-child tables: `(project_id, <sort column>)`; text search on
projects/clients/vendors/documents/messages via `tsvector` GIN indexes.
