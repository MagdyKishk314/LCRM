/**
 * Permission vocabulary.
 *
 * Format: `module:resource:action`, e.g. `contacts:contact:read`.
 * Each segment accepts `*` as a wildcard, so `contacts:*:read` and `*` are both valid.
 *
 * Modules own their own permission strings — they are declared in each module manifest
 * and collected here, so there is never a second list to keep in sync.
 */

export type Permission = string;

export interface PermissionDef {
  key: Permission;
  label: string;
  /** Grouping label for the role editor UI. */
  group: string;
  /**
   * Permissions that are meaningless without another one. Granting `contact:update`
   * without `contact:read` produces a user who can save changes to a record they
   * cannot open, so the role editor auto-selects implied permissions.
   */
  implies?: Permission[];
}

const SEGMENT_WILDCARD = '*';

/**
 * Does `granted` satisfy `required`?
 *
 * A bare `*` grants everything. Otherwise both are split into three segments and
 * compared position by position, with `*` matching any single segment.
 */
export function permissionMatches(granted: Permission, required: Permission): boolean {
  if (granted === SEGMENT_WILDCARD) return true;
  if (granted === required) return true;

  const g = granted.split(':');
  const r = required.split(':');
  if (g.length !== r.length) return false;

  return g.every((seg, i) => seg === SEGMENT_WILDCARD || seg === r[i]);
}

/** Does any permission in the set satisfy `required`? */
export function hasPermission(granted: readonly Permission[], required: Permission): boolean {
  return granted.some((g) => permissionMatches(g, required));
}

/** Does the set satisfy every one of `required`? */
export function hasAllPermissions(
  granted: readonly Permission[],
  required: readonly Permission[],
): boolean {
  return required.every((r) => hasPermission(granted, r));
}

/** Does the set satisfy at least one of `required`? An empty requirement list passes. */
export function hasAnyPermission(
  granted: readonly Permission[],
  required: readonly Permission[],
): boolean {
  if (required.length === 0) return true;
  return required.some((r) => hasPermission(granted, r));
}

/**
 * Resolve a membership's effective permissions against the full permission vocabulary.
 *
 * Grants are expanded to concrete permissions before denies are applied. Filtering the
 * grant list directly does not work: a deny of `contacts:contact:export` does not
 * "match" a role's `contacts:*:*`, so the wildcard would survive and keep granting the
 * very permission that was denied. Expanding first makes a deny able to carve a single
 * capability out of a broad role — which is the only reason the feature exists.
 *
 * Returns concrete permissions only, never wildcards, so downstream checks are exact.
 *
 * `vocabulary` is passed in rather than imported to keep this module free of a
 * dependency on the module catalog; `resolvePermissions` in the registry supplies it.
 */
export function resolvePermissionsAgainst(
  vocabulary: readonly Permission[],
  input: {
    rolePermissions: readonly Permission[];
    grant?: readonly Permission[];
    deny?: readonly Permission[];
  },
): Permission[] {
  const { rolePermissions, grant = [], deny = [] } = input;
  const patterns = [...rolePermissions, ...grant];

  const granted = vocabulary.filter((perm) =>
    patterns.some((pattern) => permissionMatches(pattern, perm)),
  );

  if (deny.length === 0) return granted;

  return granted.filter((perm) => !deny.some((d) => permissionMatches(d, perm)));
}
