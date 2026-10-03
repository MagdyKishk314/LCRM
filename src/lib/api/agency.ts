import type { Account, ModuleKey } from '@/shared';
import { apiGet } from './server';

/**
 * Agency console reads.
 *
 * These deliberately omit `accountId`, so no `X-Account-Id` header is sent and the API's
 * `resolveAgency` middleware establishes agency scope instead of pinning one sub-account.
 */

export interface AgencyAccountRow {
  id: string;
  name: string;
  slug: string;
  status: Account['status'];
  markets: string[];
  enabledModules: ModuleKey[];
  /** Seats on this sub-account. CRM figures are deliberately not exposed here. */
  users: number;
  createdAt: string;
}

export interface AgencyOverview {
  agency: {
    id: string;
    name: string;
    status: string;
    branding: { logoUrl?: string; primaryColor?: string; customDomain?: string };
    enabledModules: ModuleKey[];
  };
  plan: {
    id: string;
    name: string;
    limits: { accounts: number; users: number; contacts: number };
    modules: ModuleKey[];
  } | null;
  /** No cross-account sums by design — those figures only mean something per client. */
  totals: {
    accounts: number;
    activeAccounts: number;
    users: number;
  };
  accounts: AgencyAccountRow[];
}

export interface AgencyAccess {
  membershipId: string;
  scope: 'platform' | 'agency' | 'account';
  accountId: string | null;
  accountName: string | null;
  roleId: string;
  roleName: string | null;
  status: 'active' | 'invited' | 'suspended';
}

export interface AgencyPerson {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: 'active' | 'invited' | 'suspended';
  lastLoginAt?: string;
  access: AgencyAccess[];
}

export interface AuditEntry {
  id: string;
  action: string;
  entity: string;
  entityId?: string;
  createdAt: string;
  accountName: string | null;
  user: { name: string; email: string } | null;
}

export function getOverview() {
  return apiGet<AgencyOverview>('/core/agency/overview');
}

export function getAgency() {
  return apiGet<Record<string, unknown>>('/core/agency');
}

export function getPeople() {
  return apiGet<{ data: AgencyPerson[] }>('/core/agency/users');
}

export function getAudit(params: { accountId?: string; limit?: number } = {}) {
  const query = new URLSearchParams();
  if (params.accountId) query.set('accountId', params.accountId);
  if (params.limit) query.set('limit', String(params.limit));
  const suffix = query.toString() ? `?${query}` : '';
  return apiGet<{ data: AuditEntry[] }>(`/core/agency/audit${suffix}`);
}
