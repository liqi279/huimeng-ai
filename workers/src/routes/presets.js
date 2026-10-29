// 风格预设（/presets）：内置预设 + 当前用户自定义项（presets 表）
import { Hono } from 'hono';
import { authOptional, currentUserId } from '../auth.js';
import { PRESETS } from '../presets.js';
import { listPresetRows } from '../db.js';

const routes = new Hono();

routes.get('/presets', authOptional, async (c) => {
  const userId = currentUserId(c);
  const extras = userId ? await listPresetRows(c.env.DB, userId) : [];
  return c.json({ items: [...PRESETS, ...extras] });
});

export default routes;
