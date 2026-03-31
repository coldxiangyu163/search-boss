const bcrypt = require('bcryptjs');

class AuthService {
  constructor({ pool }) {
    this.pool = pool;
  }

  async login({ email, password }) {
    if (!email || !password) {
      return { ok: false, error: 'missing_credentials' };
    }

    const result = await this.pool.query(`
      select u.id, u.name, u.email, u.role, u.department_id,
             u.password_hash, u.status,
             ha.id as hr_account_id
      from users u
      left join hr_accounts ha on ha.user_id = u.id and ha.status = 'active'
      where u.email = $1
      limit 1
    `, [email]);

    const user = result.rows[0];
    if (!user) {
      return { ok: false, error: 'invalid_credentials' };
    }

    if (user.status !== 'active') {
      return { ok: false, error: 'account_disabled' };
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return { ok: false, error: 'invalid_credentials' };
    }

    return {
      ok: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        departmentId: user.department_id,
        hrAccountId: user.hr_account_id
      }
    };
  }

  async getMe(userId) {
    const result = await this.pool.query(`
      select u.id, u.name, u.email, u.role, u.department_id,
             d.name as department_name,
             ha.id as hr_account_id, ha.name as hr_account_name
      from users u
      left join departments d on d.id = u.department_id
      left join hr_accounts ha on ha.user_id = u.id and ha.status = 'active'
      where u.id = $1 and u.status = 'active'
      limit 1
    `, [userId]);

    const user = result.rows[0];
    if (!user) return null;

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      departmentId: user.department_id,
      departmentName: user.department_name,
      hrAccountId: user.hr_account_id,
      hrAccountName: user.hr_account_name
    };
  }

  async createUser({ name, email, phone, password, role, departmentId }) {
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await this.pool.query(`
      insert into users (name, email, phone, password_hash, role, department_id)
      values ($1, $2, $3, $4, $5, $6)
      returning id, name, email, role, department_id
    `, [name, email, phone || null, passwordHash, role, departmentId || null]);

    return result.rows[0];
  }
}

module.exports = { AuthService };
