// 桌面布局（/desk）
import { Hono } from 'hono';
import { authOptional, currentUserId } from '../auth.js';
import { assert, readJsonBody } from '../util.js';
import { getDesk, saveDesk } from '../db.js';

const routes = new Hono();

routes.get('/desk', authOptional, async (c) => {
  return c.json({ desk: await getDesk(c.env.DB, currentUserId(c)) });
});

routes.put('/desk', authOptional, async (c) => {
  const body = await readJsonBody(c);
  const desk = body.desk;
  assert(desk && typeof desk === 'object' && !Array.isArray(desk), 400, '缺少桌面数据', '请求体需包含 desk 对象');
  const saved = await saveDesk(c.env.DB, currentUserId(c), desk);
  return c.json({ desk: saved });
});

export default routes;
