// 免费模型目录（/catalog）
import { Hono } from 'hono';
import { KEYLESS, PROVIDERS, LORAS } from '../catalog.js';

const routes = new Hono();

routes.get('/catalog', (c) => c.json({
  keyless: KEYLESS,
  providers: PROVIDERS,
  loras: LORAS,
}));

export default routes;
