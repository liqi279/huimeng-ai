// 一次性初始化：创建默认管理员 admin / admin123
import { Hono } from 'hono';
import { createUser, listUsers } from '../db.js';

const routes = new Hono();

routes.post('/admin/seed', async (c) => {
  const users = await listUsers(c.env.DB);
  if (users.length > 0) {
    return c.json({
      error: { message: '已存在用户，初始化接口已关闭', hint: '如需新增管理员请用 /auth/users（需 admin token）' },
    }, 409);
  }

  const username = (c.env.ADMIN_USER || 'admin').trim();
  const password = (c.env.ADMIN_PASS || 'admin123').trim();
  const result = await createUser(c.env.DB, { username, password, role: 'admin' });
  if (!result.ok) return c.json({ error: { message: result.error } }, 409);
  return c.json({ ok: true, user: result.user });
});

export default routes;
