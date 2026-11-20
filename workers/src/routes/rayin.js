// RayinAPI 模型列表（/rayin/models）
import { Hono } from 'hono';
import { getConfig } from '../config.js';
import { assert, fetchJson, normalizeBase, readJsonBody } from '../util.js';

const routes = new Hono();

routes.post('/rayin/models', async (c) => {
  const cfg = getConfig(c.env);
  const body = await readJsonBody(c);
  const base = normalizeBase(body.base, cfg.RAYIN_BASE);
  const key = typeof body.key === 'string' && body.key.trim() ? body.key.trim() : cfg.RAYIN_KEY;
  assert(key, 400, '未配置 RayinAPI Key', '在设置中填写 Key 或配置服务端 RAYIN_KEY');

  const data = await fetchJson(
    `${base}/models`,
    { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } },
    30000,
    '请检查 API 地址与 Key 是否正确',
  );

  const list = data && Array.isArray(data.data) ? data.data : [];
  const ids = [...new Set(list.map((item) => item && item.id).filter((id) => typeof id === 'string' && id))];
  return c.json({ ids });
});

export default routes;
