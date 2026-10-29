// 用户认证与管理（/auth/*）
import { Hono } from 'hono';
import { authRequired, adminOnly, currentUserId } from '../auth.js';
import { assert, readJsonBody } from '../util.js';
import {
  authenticateUser,
  createUser,
  deleteUser,
  listUsers,
  resetUserPassword,
  updateUserRole,
} from '../db.js';
import { signToken } from '../security.js';

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; /* 30 天 */

const routes = new Hono();

routes.post('/auth/register', async (c) => {
  const body = await readJsonBody(c);
  const { username, password } = body;
  assert(username && typeof username === 'string', 400, '缺少用户名');
  assert(password && typeof password === 'string', 400, '缺少密码');
  assert(username.length >= 3, 400, '用户名至少 3 个字符');
  assert(password.length >= 6, 400, '密码至少 6 个字符');

  const result = await createUser(c.env.DB, { username, password, role: 'user' });
  if (!result.ok) return c.json({ error: { message: result.error } }, 409);
  const token = await signToken(c.env, {
    uid: result.user.id,
    username: result.user.username,
    role: result.user.role,
  });
  return c.json({ user: result.user, token, expiresAt: Date.now() + TOKEN_TTL_MS });
});

routes.post('/auth/login', async (c) => {
  const body = await readJsonBody(c);
  const { username, password } = body;
  assert(username && password, 400, '缺少用户名或密码');
  const user = await authenticateUser(c.env.DB, username, password);
  if (!user) return c.json({ error: { message: '用户名或密码错误' } }, 401);
  const token = await signToken(c.env, { uid: user.id, username: user.username, role: user.role });
  return c.json({ user, token, expiresAt: Date.now() + TOKEN_TTL_MS });
});

routes.get('/auth/me', authRequired, (c) => c.json({ user: c.get('user') }));

routes.post('/auth/logout', authRequired, (c) => c.json({ ok: true }));

routes.get('/auth/users', authRequired, adminOnly, async (c) => {
  const users = await listUsers(c.env.DB);
  return c.json({ users });
});

routes.post('/auth/users', authRequired, adminOnly, async (c) => {
  const body = await readJsonBody(c);
  const { username, password, role } = body;
  assert(username && password, 400, '缺少用户名或密码');
  assert(username.length >= 3, 400, '用户名至少 3 个字符');
  assert(password.length >= 6, 400, '密码至少 6 个字符');
  const result = await createUser(c.env.DB, { username, password, role });
  if (!result.ok) return c.json({ error: { message: result.error } }, 409);
  return c.json({ user: result.user });
});

routes.patch('/auth/users/:id/role', authRequired, adminOnly, async (c) => {
  const body = await readJsonBody(c);
  const { role } = body;
  assert(role === 'admin' || role === 'user', 400, '角色必须为 admin 或 user');
  if (c.req.param('id') === currentUserId(c)) {
    return c.json({ error: { message: '不能修改自己的角色' } }, 400);
  }
  const result = await updateUserRole(c.env.DB, c.req.param('id'), role);
  if (!result.ok) return c.json({ error: { message: result.error } }, 404);
  return c.json({ user: result.user });
});

routes.patch('/auth/users/:id/password', authRequired, adminOnly, async (c) => {
  const body = await readJsonBody(c);
  const { password } = body;
  assert(password && typeof password === 'string' && password.length >= 6, 400, '密码至少 6 个字符');
  const result = await resetUserPassword(c.env.DB, c.req.param('id'), password);
  if (!result.ok) return c.json({ error: { message: result.error } }, 404);
  return c.json({ ok: true });
});

routes.delete('/auth/users/:id', authRequired, adminOnly, async (c) => {
  if (c.req.param('id') === currentUserId(c)) {
    return c.json({ error: { message: '不能删除自己' } }, 400);
  }
  const result = await deleteUser(c.env.DB, c.req.param('id'));
  if (!result.ok) return c.json({ error: { message: result.error } }, 404);
  return c.json({ ok: true });
});

export default routes;
