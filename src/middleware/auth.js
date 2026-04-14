function authMiddleware(pool) {
  return async (req, res, next) => {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const result = await pool.query(`
      select u.id, u.role, u.department_id, u.name, u.email,
             u.expires_at, u.max_hr_accounts,
             ha.id as hr_account_id
      from users u
      left join hr_accounts ha on ha.user_id = u.id and ha.status = 'active'
      where u.id = $1 and u.status = 'active'
    `, [userId]);

    if (!result.rows[0]) {
      return res.status(401).json({ error: 'user_not_found' });
    }

    const user = result.rows[0];
    if (user.expires_at && new Date(user.expires_at) < new Date()) {
      return res.status(403).json({ error: 'account_expired', message: '账号已过期，请联系系统管理员' });
    }

    req.user = user;
    next();
  };
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    next();
  };
}

function resolveHrScope(req) {
  const user = req.user;
  if (!user) return null;

  if (user.role === 'system_admin') {
    return { scope: 'all' };
  }

  if (user.role === 'dept_admin') {
    return { scope: 'department', departmentId: user.department_id };
  }

  if (user.role === 'hr') {
    return { scope: 'self', hrAccountId: user.hr_account_id };
  }

  return null;
}

function isSystemAdmin(user) {
  return user && user.role === 'system_admin';
}

function isAdminRole(user) {
  return user && ['system_admin', 'dept_admin'].includes(user.role);
}

module.exports = { authMiddleware, requireRole, resolveHrScope, isSystemAdmin, isAdminRole };
