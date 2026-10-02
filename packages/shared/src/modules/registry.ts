import { MODULE_CATALOG } from './catalog';
import {
  NAV_GROUP_ORDER,
  type ModuleKey,
  type ModuleManifest,
  type ModuleToggleState,
  type NavGroup,
  type NavItem,
} from './types';
import {
  hasAnyPermission,
  resolvePermissionsAgainst,
  type Permission,
  type PermissionDef,
} from '../permissions';

const BY_KEY = new Map<ModuleKey, ModuleManifest>(MODULE_CATALOG.map((m) => [m.key, m]));

export function getModule(key: ModuleKey): ModuleManifest | undefined {
  return BY_KEY.get(key);
}

export function listModules(): ModuleManifest[] {
  return [...MODULE_CATALOG].sort((a, b) => a.order - b.order);
}

export function coreModules(): ModuleKey[] {
  return MODULE_CATALOG.filter((m) => m.core).map((m) => m.key);
}

/** Every permission any module defines — used to build the role editor. */
export function allPermissionDefs(): PermissionDef[] {
  return MODULE_CATALOG.flatMap((m) => m.permissions);
}

/** The complete permission vocabulary: every concrete key any module declares. */
export function permissionVocabulary(): Permission[] {
  return allPermissionDefs().map((d) => d.key);
}

/**
 * Resolve a membership's effective permissions.
 *
 * Role grants form the base, explicit grants add to it, and explicit denies win over
 * both — including over wildcards, since grants are expanded against the full catalog
 * before denies are applied. The result contains concrete permissions only.
 */
export function resolvePermissions(input: {
  rolePermissions: readonly Permission[];
  grant?: readonly Permission[];
  deny?: readonly Permission[];
}): Permission[] {
  return resolvePermissionsAgainst(permissionVocabulary(), input);
}

/** Permissions belonging to modules that are actually enabled. */
export function permissionDefsForModules(enabled: readonly ModuleKey[]): PermissionDef[] {
  const set = new Set(enabled);
  return MODULE_CATALOG.filter((m) => set.has(m.key)).flatMap((m) => m.permissions);
}

/**
 * Expand a set of module keys to include everything they depend on.
 *
 * Enabling `campaigns` silently enables `telephony` and `contacts` — the alternative is a
 * module that is on but broken, which is worse than an implicit extra toggle.
 */
export function withDependencies(keys: readonly ModuleKey[]): ModuleKey[] {
  const out = new Set<ModuleKey>();

  const visit = (key: ModuleKey) => {
    if (out.has(key)) return;
    out.add(key);
    getModule(key)?.dependsOn.forEach(visit);
  };

  keys.forEach(visit);
  return [...out];
}

/**
 * Which enabled modules would break if `key` were switched off?
 *
 * Returned to the UI so the toggle can be blocked with a message naming the blocker,
 * rather than failing silently or cascading a disable the user did not ask for.
 */
export function dependentsOf(key: ModuleKey, enabled: readonly ModuleKey[]): ModuleKey[] {
  const set = new Set(enabled);
  return MODULE_CATALOG.filter(
    (m) => set.has(m.key) && m.key !== key && m.dependsOn.includes(key),
  ).map((m) => m.key);
}

export interface ResolveInput {
  /** Modules the agency's plan sells. */
  planModules: readonly ModuleKey[];
  /** Agency-level toggle state — the ceiling for every sub-account beneath it. */
  agency: ModuleToggleState;
  /** Account-level toggle state. Omit when resolving for the agency itself. */
  account?: ModuleToggleState;
}

/**
 * Resolve the effective module set for one account (or one agency, if `account` is omitted).
 *
 * The agency is a ceiling, not a contributor: a sub-account can never enable something its
 * agency has not turned on, no matter what its own toggles or grants say. Core modules are
 * always present. Dependencies are expanded last, so a granted module brings its chain with it.
 */
export function resolveModules(input: ResolveInput): ModuleKey[] {
  const { planModules, agency, account } = input;

  const plan = new Set(planModules);
  const agencyGrants = new Set(agency.grants ?? []);
  const agencyDenies = new Set(agency.denies ?? []);

  // Agency ceiling: sold by the plan or explicitly granted, minus explicit denies.
  const ceiling = new Set<ModuleKey>(
    agency.enabled.filter((k) => (plan.has(k) || agencyGrants.has(k)) && !agencyDenies.has(k)),
  );
  agencyGrants.forEach((k) => {
    if (!agencyDenies.has(k)) ceiling.add(k);
  });

  let effective: Set<ModuleKey>;

  if (!account) {
    effective = ceiling;
  } else {
    const accountGrants = new Set(account.grants ?? []);
    const accountDenies = new Set(account.denies ?? []);

    effective = new Set<ModuleKey>(
      account.enabled.filter((k) => ceiling.has(k) && !accountDenies.has(k)),
    );
    // A per-account upsell still cannot exceed the agency ceiling.
    accountGrants.forEach((k) => {
      if (ceiling.has(k) && !accountDenies.has(k)) effective.add(k);
    });
  }

  coreModules().forEach((k) => effective.add(k));

  // Expand dependencies, but never past the ceiling — a dependency the agency does not
  // have is a misconfiguration to surface, not something to silently grant.
  const expanded = withDependencies([...effective]).filter(
    (k) => getModule(k)?.core || effective.has(k) || ceiling.has(k),
  );

  return [...new Set(expanded)].sort(
    (a, b) => (getModule(a)?.order ?? 0) - (getModule(b)?.order ?? 0),
  );
}

/**
 * A module set is valid only if every dependency of every enabled module is also enabled.
 * Called before persisting a toggle change so a broken combination never reaches the database.
 */
export function validateModuleSet(keys: readonly ModuleKey[]): {
  valid: boolean;
  missing: { module: ModuleKey; requires: ModuleKey[] }[];
} {
  const set = new Set(keys);
  const missing: { module: ModuleKey; requires: ModuleKey[] }[] = [];

  for (const key of keys) {
    const manifest = getModule(key);
    if (!manifest) continue;
    const unmet = manifest.dependsOn.filter((d) => !set.has(d));
    if (unmet.length > 0) missing.push({ module: key, requires: unmet });
  }

  return { valid: missing.length === 0, missing };
}

export interface NavSection {
  group: NavGroup;
  items: NavItem[];
}

/**
 * Build the sidebar from the effective module set filtered by what this user may see.
 *
 * Entries are grouped by each module's `navGroup`, not by the module itself — so Contacts
 * and Pipelines sit together under "Main" instead of each claiming its own heading. The
 * sidebar should describe the product, not enumerate its assembly.
 *
 * A nav item survives if the user holds any of its permissions; a parent survives if it
 * has any surviving child, so a user with only `contacts:list:read` sees the Contacts
 * group containing just Lists rather than an empty group or nothing at all.
 */
export function buildNavigation(
  enabled: readonly ModuleKey[],
  permissions: readonly Permission[],
): NavSection[] {
  const enabledSet = new Set(enabled);

  const filterItem = (item: NavItem): NavItem | null => {
    const children = item.children?.map(filterItem).filter((c): c is NavItem => c !== null) ?? [];

    if (item.children && item.children.length > 0) {
      if (children.length === 0) return null;
      return { ...item, children };
    }

    if (!hasAnyPermission(permissions, item.permissions ?? [])) return null;
    return { ...item };
  };

  const byGroup = new Map<NavGroup, NavItem[]>();

  // `listModules()` is ordered, so entries accumulate in module order within each group.
  for (const module of listModules()) {
    if (!enabledSet.has(module.key) || module.status === 'planned') continue;

    const items = module.nav.map(filterItem).filter((i): i is NavItem => i !== null);
    if (items.length === 0) continue;

    byGroup.set(module.navGroup, [...(byGroup.get(module.navGroup) ?? []), ...items]);
  }

  return NAV_GROUP_ORDER.filter((g) => byGroup.has(g)).map((group) => ({
    group,
    items: byGroup.get(group)!,
  }));
}
