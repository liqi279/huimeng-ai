// 认证中间件（对应 Express 版 auth.js）
import { findUserById, reviveUser } from './db.js';
import { verifyToken } from './security.js';

async function resolveUser(c) {
  const header = c.req.header('Authorization') || c.req.header('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;
  const payload = await verifyToken(c.env, token);
  if (!payload || !payload.uid) return null;

  const user = await findUserById(c.env.DB, payload.uid);
  if (user) return { id: user.id, username: user.username, role: user.role };

  /* 老 token / 数据被清空时按 payload 自动重建（与 Express 行为一致） */
  if (payload.username) {
    const revived = await reviveUser(c.env.DB, payload.uid, payload.username, payload.role || 'user');
    if (revived) return { id: revived.id, username: revived.username, role: revived.role };
  }
  return { id: payload.uid, username: 'guest_' + String(payload.uid).slice(-6), role: 'user' };
}

export async function authOptional(c, next) {
  const user = await resolveUser(c);
  if (user) c.set('user', user);
  await next();
}

export async function authRequired(c, next) {
  const user = await resolveUser(c);
  if (!user) return c.json({ error: { message: '未登录或登录已过期' } }, 401);
  c.set('user', user);
  await next();
}

export async function adminOnly(c, next) {
  const user = c.get('user');
  if (!user || user.role !== 'admin') return c.json({ error: { message: '需要管理员权限' } }, 403);
  await next();
}

export function currentUserId(c) {
  const user = c.get('user');
  return user && user.id ? user.id : null;
}
