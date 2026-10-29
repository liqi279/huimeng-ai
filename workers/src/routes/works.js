// 作品列表（/works）
import { Hono } from 'hono';
import { authOptional, currentUserId } from '../auth.js';
import { assert, readJsonBody } from '../util.js';
import { clearWorks, listWorks, removeWork, upsertWork } from '../db.js';

const routes = new Hono();

routes.get('/works', authOptional, async (c) => {
  return c.json({ items: await listWorks(c.env.DB, currentUserId(c)) });
});

routes.post('/works', authOptional, async (c) => {
  const body = await readJsonBody(c);
  const work = body.work;
  assert(work && typeof work === 'object' && !Array.isArray(work), 400, '缺少作品数据', '请求体需包含 work 对象');
  assert(typeof work.id === 'string' && work.id.trim(), 400, '作品缺少 id', 'work.id 必须为非空字符串');

  const saved = {
    ...work,
    id: work.id.trim(),
    createdAt: work.createdAt || new Date().toISOString(),
  };
  await upsertWork(c.env.DB, currentUserId(c), saved);
  return c.json({ work: saved });
});

routes.delete('/works/:id', authOptional, async (c) => {
  await removeWork(c.env.DB, currentUserId(c), c.req.param('id'));
  return c.json({ ok: true });
});

routes.delete('/works', authOptional, async (c) => {
  await clearWorks(c.env.DB, currentUserId(c));
  return c.json({ ok: true });
});

export default routes;
