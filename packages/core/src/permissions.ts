/**
 * Permission keys and system roles. Roles are seeded per organization from
 * SYSTEM_ROLES and may be customised per company afterwards.
 */

export const PERMISSIONS = [
  'org.manage',
  'members.invite',
  'members.manage',
  'roles.manage',
  'clients.read', 'clients.write',
  'leads.read', 'leads.write',
  'vendors.read', 'vendors.write',
  'projects.read', 'projects.write', 'projects.archive',
  'schedule.read', 'schedule.write',
  'tasks.read', 'tasks.write',
  'daily_logs.read', 'daily_logs.write',
  'documents.read', 'documents.write', 'documents.share',
  'messages.read', 'messages.write',
  'estimates.read', 'estimates.write',
  'proposals.read', 'proposals.write',
  'budget.read', 'budget.write',
  'change_orders.read', 'change_orders.write',
  'purchasing.read', 'purchasing.write',
  'bills.read', 'bills.write',
  'invoices.read', 'invoices.write',
  'payments.read', 'payments.write',
  'selections.read', 'selections.write',
  'time.clock', 'time.manage', 'time.approve',
  'activity.read',
  'reports.read',
  'ai.use',
  'automations.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSIONS);

export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}

export type SystemRoleKey =
  | 'owner'
  | 'project_manager'
  | 'estimator'
  | 'office'
  | 'field_supervisor'
  | 'field_crew'
  | 'vendor'
  | 'client';

export interface RoleDefinition {
  key: SystemRoleKey;
  name: string;
  description: string;
  /** Limit project-scoped data to projects the user is a member of. */
  restrictToAssignedProjects: boolean;
  /** External roles never see internal-only data even if a permission is granted. */
  external: boolean;
  /** Default landing experience. */
  defaultMode: 'office' | 'field' | 'portal';
  permissions: Permission[];
}

const ALL: Permission[] = [...PERMISSIONS];
const RW = (...mods: string[]): Permission[] =>
  ALL.filter((p) => mods.some((m) => p.startsWith(`${m}.`)));
const R = (...mods: string[]): Permission[] =>
  ALL.filter((p) => mods.some((m) => p === `${m}.read`));

export const SYSTEM_ROLES: readonly RoleDefinition[] = [
  {
    key: 'owner',
    name: 'Owner / Administrator',
    description: 'Full access to the company, its people, projects and finances.',
    restrictToAssignedProjects: false,
    external: false,
    defaultMode: 'office',
    permissions: ALL,
  },
  {
    key: 'project_manager',
    name: 'Project Manager',
    description: 'Runs projects: schedules, budgets, clients, vendors, documents and communication.',
    restrictToAssignedProjects: false,
    external: false,
    defaultMode: 'office',
    permissions: [
      'members.invite',
      ...RW('clients', 'leads', 'vendors', 'projects', 'schedule', 'tasks', 'daily_logs', 'documents', 'messages',
        'estimates', 'proposals', 'budget', 'change_orders', 'purchasing', 'bills', 'invoices', 'payments', 'selections'),
      'time.clock', 'time.manage', 'time.approve', 'activity.read', 'reports.read', 'ai.use', 'automations.manage',
    ],
  },
  {
    key: 'estimator',
    name: 'Estimator',
    description: 'CRM, estimating, proposals, cost catalog and bids.',
    restrictToAssignedProjects: false,
    external: false,
    defaultMode: 'office',
    permissions: [
      ...RW('clients', 'leads', 'vendors', 'estimates', 'proposals', 'change_orders', 'selections', 'documents', 'messages'),
      ...R('projects', 'schedule', 'tasks', 'daily_logs', 'budget', 'activity', 'reports'),
      'time.clock', 'ai.use',
    ],
  },
  {
    key: 'office',
    name: 'Office / Finance',
    description: 'Budgets, bills, purchase orders, invoices, payments and reports.',
    restrictToAssignedProjects: false,
    external: false,
    defaultMode: 'office',
    permissions: [
      'members.invite',
      ...RW('clients', 'vendors', 'budget', 'purchasing', 'bills', 'invoices', 'payments', 'change_orders', 'documents', 'messages'),
      ...R('leads', 'projects', 'schedule', 'tasks', 'daily_logs', 'estimates', 'proposals', 'selections', 'activity'),
      'time.clock', 'time.manage', 'time.approve', 'reports.read', 'ai.use',
    ],
  },
  {
    key: 'field_supervisor',
    name: 'Field Supervisor',
    description: 'Schedules, daily logs, tasks, documents, photos and time clock for assigned projects.',
    restrictToAssignedProjects: true,
    external: false,
    defaultMode: 'field',
    permissions: [
      ...RW('schedule', 'tasks', 'daily_logs', 'documents', 'messages'),
      ...R('clients', 'vendors', 'projects', 'change_orders', 'purchasing', 'selections', 'activity'),
      'time.clock', 'time.manage', 'time.approve', 'ai.use',
    ],
  },
  {
    key: 'field_crew',
    name: 'Field Crew',
    description: 'Assigned tasks, schedule, daily logs and time tracking.',
    restrictToAssignedProjects: true,
    external: false,
    defaultMode: 'field',
    permissions: [
      ...R('vendors', 'projects', 'schedule', 'tasks', 'documents', 'selections'),
      'tasks.write', 'daily_logs.read', 'daily_logs.write', 'messages.read', 'messages.write', 'time.clock', 'ai.use',
    ],
  },
  {
    key: 'vendor',
    name: 'Subcontractor / Vendor',
    description: 'Only projects and information explicitly shared.',
    restrictToAssignedProjects: true,
    external: true,
    defaultMode: 'portal',
    permissions: ['projects.read', 'schedule.read', 'tasks.read', 'tasks.write', 'documents.read', 'messages.read', 'messages.write', 'purchasing.read', 'selections.read'],
  },
  {
    key: 'client',
    name: 'Homeowner / Client',
    description: 'Client portal with limited access.',
    restrictToAssignedProjects: true,
    external: true,
    defaultMode: 'portal',
    permissions: ['projects.read', 'schedule.read', 'daily_logs.read', 'documents.read', 'messages.read', 'messages.write',
      'selections.read', 'change_orders.read', 'proposals.read', 'invoices.read', 'payments.read', 'activity.read'],
  },
];

export function systemRole(key: SystemRoleKey): RoleDefinition {
  const role = SYSTEM_ROLES.find((r) => r.key === key);
  if (!role) throw new Error(`unknown system role ${key}`);
  return role;
}

/** Sidebar / feature visibility derived from permissions. */
export const NAV_PERMISSIONS: Record<string, Permission | null> = {
  dashboard: null,
  projects: 'projects.read',
  leads: 'leads.read',
  schedule: 'schedule.read',
  tasks: 'tasks.read',
  clients: 'clients.read',
  vendors: 'vendors.read',
  estimating: 'estimates.read',
  budget: 'budget.read',
  invoices: 'invoices.read',
  messages: 'messages.read',
  documents: 'documents.read',
  time: 'time.clock',
  reports: 'reports.read',
  ai: 'ai.use',
  settings: null,
};
