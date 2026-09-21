# 07 · Permission Matrix

Permissions are string keys (`module.action`). System roles are seeded per
organization from `packages/core/src/permissions.ts` and can be cloned and
customised per company (stored in `roles` / `role_permissions`). A role may
also set `restrict_to_assigned_projects = true`, which limits project-scoped
data to projects where the user is a `project_member`.

Legend: ● full · ○ read · ◐ own/assigned only · – none

| Permission | Owner/Admin | Project Manager | Estimator | Office/Finance | Field Supervisor | Field Crew | Vendor | Client |
|---|---|---|---|---|---|---|---|---|
| org.manage | ● | – | – | – | – | – | – | – |
| members.invite / members.manage | ● | ○ | – | ○ | – | – | – | – |
| roles.manage | ● | – | – | – | – | – | – | – |
| clients.read / clients.write | ● | ● | ● | ● | ○ | – | – | – |
| leads.* | ● | ● | ● | ○ | – | – | – | – |
| vendors.* | ● | ● | ● | ● | ○ | ○ | ◐ | – |
| projects.read | ● | ● | ● | ● | ◐ | ◐ | ◐ | ◐ |
| projects.write / projects.archive | ● | ● | – | – | – | – | – | – |
| schedule.read / schedule.write | ● | ● | ○ | ○ | ● | ◐ | ◐ | ○ (shared) |
| tasks.read / tasks.write | ● | ● | ○ | ○ | ● | ◐ | ◐ | – |
| daily_logs.read / daily_logs.write | ● | ● | ○ | ○ | ● | ● | – | ○ (public) |
| documents.read / write / share | ● | ● | ● | ● | ● / ◐ | ○ | ◐ | ◐ |
| messages.read / messages.write | ● | ● | ● | ● | ● | ◐ | ◐ | ◐ |
| estimates.* | ● | ● | ● | ○ | – | – | – | – |
| proposals.* | ● | ● | ● | ○ | – | – | – | ◐ approve |
| budget.read / budget.write | ● | ● | ○ | ● | – | – | – | ○ (shared) |
| change_orders.* | ● | ● | ● | ● | ○ | – | – | ◐ approve |
| purchasing.* / bills.* | ● | ● | – | ● | ○ | – | ◐ | – |
| invoices.* / payments.* | ● | ● | – | ● | – | – | – | ◐ pay |
| selections.* | ● | ● | ● | ○ | ○ | – | – | ◐ approve |
| time.clock (own) | ● | ● | ● | ● | ● | ● | – | – |
| time.manage / time.approve | ● | ● | – | ● | ● | – | – | – |
| activity.read | ● | ● | ○ | ○ | ○ | – | – | ○ (public) |
| reports.read | ● | ● | ○ | ● | – | – | – | – |
| ai.use | ● | ● | ● | ● | ● | ◐ | – | – |
| automations.manage | ● | ● | – | – | – | – | – | – |
| notifications (own) | ● | ● | ● | ● | ● | ● | ● | ● |

Every service method starts with `ctx.require('permission.key')` and, for
project-scoped data, `ctx.requireProjectAccess(projectId)`. Portal tokens carry
an explicit capability list derived from the project's sharing settings and
never map onto internal permissions.
