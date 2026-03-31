function authMiddleware(pool) {
  return async (req, res, next) => {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const result = await pool.query(`
      select u.id, u.role, u.department_id, u.name, u.email,
             ha.id as hr_account_id
      from users u
      left join hr_accounts ha on ha.user_id = u.id and ha.status = 'active'
      where u.id = $1 and u.status = 'active'
    `, [userId]);

    if (!result.rows[0]) {
      return res.status(401).json({ error: 'user_not_found' });
    }

    req.user = result.rows[0];
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

  if (user.role === 'enterprise_admin') {
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

module.exports = { authMiddleware, requireRole, resolveHrScope };
