const VALID_APP_ROLES = new Set(['fleet', 'parent']);

export function normalizeAppRoles(accountRole, assignedRoles) {
  if (!Array.isArray(assignedRoles)) return [String(accountRole || '').toLowerCase() === 'parent' ? 'parent' : 'fleet'];
  const roles = [...new Set((Array.isArray(assignedRoles) ? assignedRoles : [])
    .map(role => String(role || '').trim().toLowerCase())
    .filter(role => VALID_APP_ROLES.has(role)))];
  return roles.sort();
}

export function defaultAppRole(accountRole, assignedRoles) {
  const roles = normalizeAppRoles(accountRole, assignedRoles);
  if (roles.includes('fleet')) return 'fleet';
  return roles[0] || null;
}

export function scopeUserToSession(row) {
  if (!row) return null;
  const accountRole = String(row.account_role || row.role || '').trim().toLowerCase();
  const availableRoles = normalizeAppRoles(accountRole, row.available_roles);
  const defaultRole = defaultAppRole(accountRole, availableRoles);
  const activeRole = String(row.active_app_role || defaultRole).trim().toLowerCase();
  if (!VALID_APP_ROLES.has(activeRole) || !availableRoles.includes(activeRole)) return null;
  if (activeRole === 'fleet' && accountRole === 'parent') return null;
  return {
    ...row,
    account_role: accountRole,
    role: activeRole === 'parent' ? 'parent' : accountRole,
    app_role: activeRole,
    active_role: activeRole,
    available_roles: availableRoles,
    default_role: defaultRole
  };
}

export function authRolePayload(user) {
  const availableRoles = Array.isArray(user?.available_roles)
    ? user.available_roles
    : normalizeAppRoles(user?.account_role || user?.role);
  const activeRole = user?.app_role || user?.active_role || defaultAppRole(user?.account_role || user?.role, availableRoles);
  const defaultRole = user?.default_role || defaultAppRole(user?.account_role || user?.role, availableRoles);
  return {
    user: {
      id: user.id,
      companyId: user.company_id ?? user.companyId ?? null,
      name: user.name,
      email: user.email,
      role: user.role,
      accountRole: user.account_role || user.role,
      activeRole,
      defaultRole,
      availableRoles,
      status: user.status,
      metadata: user.metadata || {}
    },
    activeRole,
    defaultRole,
    availableRoles
  };
}
