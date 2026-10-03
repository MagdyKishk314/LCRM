import type { Permission, PermissionDef } from '../permissions';

export type ModuleKey =
  | 'core'
  | 'contacts'
  | 'pipelines'
  | 'email'
  | 'telephony'
  | 'campaigns'
  | 'reporting'
  | 'calendars'
  | 'automations'
  | 'forms'
  | 'billing'
  | 'whitelabel';

/** Where a module can be switched on. */
export type ModuleScope = 'agency' | 'account' | 'both';

export type ModuleStatus = 'stable' | 'beta' | 'planned';

export interface NavItem {
  label: string;
  /** Path relative to the account root, e.g. `contacts` -> /app/{accountId}/contacts */
  href: string;
  icon: string;
  /** Hidden unless the user holds at least one of these. Empty = visible to any member. */
  permissions?: Permission[];
  children?: NavItem[];
}

/**
 * Sidebar section a module's nav entries are filed under.
 *
 * Deliberately separate from `ModuleKey`: several modules share one heading, so the
 * sidebar reads as a product ("Main", "Marketing") rather than as an inventory of the
 * modules it happens to be assembled from.
 */
export type NavGroup = 'Main' | 'Marketing' | 'Calling' | 'Insights' | 'Automation' | 'Admin';

/** Render order of the sidebar headings. */
export const NAV_GROUP_ORDER: NavGroup[] = [
  'Main',
  'Calling',
  'Marketing',
  'Automation',
  'Insights',
  'Admin',
];

export interface ModuleManifest {
  key: ModuleKey;
  name: string;
  description: string;
  /** Sidebar heading this module's entries appear under. */
  navGroup: NavGroup;
  /** lucide-react icon name. */
  icon: string;
  version: string;
  status: ModuleStatus;
  /** Core modules are always on and cannot be disabled by anyone. */
  core: boolean;
  scope: ModuleScope;
  /** Enabling this module auto-enables these; disabling one of these is blocked while this is on. */
  dependsOn: ModuleKey[];
  permissions: PermissionDef[];
  nav: NavItem[];
  /** Order in the sidebar and the module catalog. */
  order: number;
}

/** Per-tenant toggle state, stored on the agency and on each account. */
export interface ModuleToggleState {
  enabled: ModuleKey[];
  /** Explicit additions beyond the plan — upsells sold to a single sub-account. */
  grants?: ModuleKey[];
  /** Explicit removals that beat everything else. */
  denies?: ModuleKey[];
}
