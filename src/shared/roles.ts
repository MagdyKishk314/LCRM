import type { Permission } from './permissions';

export type MembershipScope = 'platform' | 'agency' | 'account';

export interface SystemRoleDef {
  key: string;
  name: string;
  description: string;
  scope: MembershipScope;
  permissions: Permission[];
}

/**
 * Seeded roles. Every agency gets a clone of the agency/account roles it can then edit,
 * so changing a role in one agency never touches another.
 */
export const SYSTEM_ROLES: SystemRoleDef[] = [
  {
    key: 'platform_admin',
    name: 'Platform admin',
    description: 'LandCaller HQ. Unrestricted across every agency and sub-account.',
    scope: 'platform',
    permissions: ['*'],
  },
  {
    key: 'agency_owner',
    name: 'Agency owner',
    description: 'Full control of the agency, its sub-accounts, billing and module entitlements.',
    scope: 'agency',
    permissions: ['*'],
  },
  {
    key: 'agency_admin',
    name: 'Agency admin',
    description: 'Full control of the agency and its sub-accounts, excluding billing.',
    scope: 'agency',
    permissions: [
      'core:*:*',
      'contacts:*:*',
      'pipelines:*:*',
      'email:*:*',
      'telephony:*:*',
      'campaigns:*:*',
      'reporting:*:*',
    ],
  },
  {
    key: 'agency_user',
    name: 'Agency user',
    description: 'Works across sub-accounts but cannot change settings or team membership.',
    scope: 'agency',
    permissions: [
      'core:account:read',
      'core:user:read',
      'contacts:contact:read',
      'contacts:contact:create',
      'contacts:contact:update',
      'contacts:list:read',
      'contacts:task:read',
      'contacts:task:manage',
      'contacts:appointment:read',
      'pipelines:opportunity:read',
      'pipelines:opportunity:create',
      'pipelines:opportunity:update',
      'pipelines:pipeline:read',
      'email:message:read',
      'email:message:send',
      'email:template:read',
      'reporting:report:read',
    ],
  },
  {
    key: 'account_admin',
    name: 'Sub-account admin',
    description: 'Full control of one sub-account, including its users and settings.',
    scope: 'account',
    permissions: [
      'core:settings:*',
      'core:user:*',
      'core:role:read',
      'core:audit:read',
      'contacts:*:*',
      'pipelines:*:*',
      'email:*:*',
      'telephony:*:*',
      'campaigns:*:*',
      'reporting:report:read',
    ],
  },
  {
    key: 'account_user',
    name: 'Sub-account user',
    description: 'Day-to-day CRM work inside one sub-account.',
    scope: 'account',
    permissions: [
      'contacts:contact:read',
      'contacts:contact:create',
      'contacts:contact:update',
      'contacts:list:read',
      'contacts:list:manage',
      'contacts:task:read',
      'contacts:task:manage',
      'contacts:appointment:read',
      'contacts:appointment:manage',
      'pipelines:opportunity:read',
      'pipelines:opportunity:create',
      'pipelines:opportunity:update',
      'pipelines:pipeline:read',
      'email:message:read',
      'email:message:send',
      'email:template:read',
      'telephony:call:place',
      'telephony:call:read',
      'reporting:report:read',
    ],
  },
  {
    key: 'caller',
    name: 'Caller',
    description:
      'Cold-call seat: dialer queue, dispositions and contact notes. Deliberately cannot export lists or change settings.',
    scope: 'account',
    permissions: [
      'contacts:contact:read',
      'contacts:contact:update',
      'contacts:list:read',
      // A caller books callbacks and sets follow-ups; that is the job.
      'contacts:task:read',
      'contacts:task:manage',
      'contacts:appointment:read',
      'contacts:appointment:manage',
      'pipelines:opportunity:read',
      'pipelines:opportunity:create',
      'telephony:call:place',
      'telephony:call:read',
      'telephony:sms:send',
      'campaigns:campaign:read',
    ],
  },
];

export function systemRole(key: string): SystemRoleDef | undefined {
  return SYSTEM_ROLES.find((r) => r.key === key);
}

export function rolesForScope(scope: MembershipScope): SystemRoleDef[] {
  return SYSTEM_ROLES.filter((r) => r.scope === scope);
}
