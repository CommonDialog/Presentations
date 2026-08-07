// Global permission catalog. Seeded into the permissions table at boot
// (idempotent); role templates are instantiated per organization at signup.

export const PERMISSIONS = {
  'accounts:read': 'View accounts',
  'accounts:write': 'Create and edit accounts',
  'contacts:read': 'View contacts',
  'contacts:write': 'Create and edit contacts',
  'leads:read': 'View leads',
  'leads:write': 'Create, edit and convert leads',
  'deals:read': 'View deals and pipelines',
  'deals:write': 'Create, edit and move deals',
  'activities:read': 'View activities and timelines',
  'activities:write': 'Log and edit activities',
  'tasks:read': 'View tasks',
  'tasks:write': 'Create and edit tasks',
  'projects:read': 'View projects',
  'projects:write': 'Create and edit projects',
  'documents:read': 'View documents',
  'documents:write': 'Upload and manage documents',
  'reports:read': 'View dashboards and reports',
  'ai:use': 'Use AI features (copilot, summaries)',
  'ai:review': 'Approve or reject AI proposals',
  'workflows:manage': 'Create and edit workflow automations',
  'settings:manage': 'Manage pipelines, custom fields and org settings',
  'users:manage': 'Manage users and roles',
} as const;

export type PermissionCode = keyof typeof PERMISSIONS;

export const ALL_PERMISSION_CODES = Object.keys(PERMISSIONS) as PermissionCode[];

const MEMBER_EXCLUDED: readonly PermissionCode[] = [
  'workflows:manage',
  'settings:manage',
  'users:manage',
];

// System roles every organization gets at creation.
export const SYSTEM_ROLES: ReadonlyArray<{
  name: string;
  description: string;
  permissions: readonly PermissionCode[];
}> = [
  {
    name: 'Admin',
    description: 'Full access, including user and organization management',
    permissions: ALL_PERMISSION_CODES,
  },
  {
    name: 'Member',
    description: 'Day-to-day CRM work; no administration',
    permissions: ALL_PERMISSION_CODES.filter((c) => !MEMBER_EXCLUDED.includes(c)),
  },
];
