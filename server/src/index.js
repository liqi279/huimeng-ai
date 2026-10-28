'use strict';

const path = require('path');
const express = require('express');
const cors = require('cors');
const config = require('./config');
const store = require('./store');

const healthRoutes = require('./routes/health');
const translateRoutes = require('./routes/translate');
const worksRoutes = require('./routes/works');
const deskRoutes = require('./routes/desk');
const assetsRoutes = require('./routes/assets');
const presetsRoutes = require('./routes/presets');
const rayinRoutes = require('./routes/rayin');
const generateRoutes = require('./routes/generate');
const authRoutes = require('./routes/auth');

const app = express();

const corsOrigin = config.CORS_ORIGIN === '*'
  ? '*'
  : config.CORS_ORIGIN.split(',').map((value) => value.trim()).filter(Boolean);

app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: '25mb' }));

app.use('/api', healthRoutes);
app.use('/api', authRoutes);
app.use('/api', translateRoutes);
app.use('/api', worksRoutes);
app.use('/api', deskRoutes);
app.use('/api', assetsRoutes);
app.use('/api', presetsRoutes);
app.use('/api', rayinRoutes);
app.use('/api', generateRoutes);

app.use('/api', (req, res) => {
  res.status(404).json({
    error: { message: '接口不存在', hint: `${req.method} ${req.originalUrl}` },
  });
});

app.use('/uploads/assets', express.static(store.dirs.assets, { index: false, maxAge: '1h' }));
app.use('/uploads/media', express.static(store.dirs.media, { index: false, maxAge: '1h' }));

app.use(express.static(config.FRONTEND_DIR, { index: 'index.html', extensions: ['html'] }));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(config.FRONTEND_DIR, 'index.html'), (err) => {
    if (err) next(err);
  });
});

app.use((req, res) => {
  res.status(404).json({
    error: { message: '资源不存在', hint: `${req.method} ${req.path}` },
  });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    res.status(413).json({ error: { message: '请求体过大', hint: 'JSON 请求体上限 25MB' } });
    return;
  }
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    res.status(400).json({ error: { message: '请求体 JSON 解析失败' } });
    return;
  }

  const status = Number(err && (err.status || err.statusCode)) || 500;
  const message = err && err.expose ? err.message : (status >= 500 ? '服务器内部错误' : (err && err.message) || '请求失败');
  const payload = { error: { message } };
  if (err && err.hint) payload.error.hint = err.hint;
  if (status >= 500) console.error('[server-error]', err && err.message);

  res.status(status).json(payload);
});

store.ensureDirs()
  .then(async () => {
    /* 首次启动若无用户，创建默认超级管理员 */
    const users = await store.listUsers();
    if (!users.length) {
      const adminUser = process.env.ADMIN_USER || 'admin';
      const adminPass = process.env.ADMIN_PASS || 'admin123';
      const result = await store.createUser({ username: adminUser, password: adminPass, role: 'admin' });
      if (result.ok) {
        console.log(`[init] 默认超级管理员已创建：${adminUser} / ${adminPass}（请尽快修改密码）`);
      }
    }
    app.listen(config.PORT, () => {
      console.log(`绘梦 server listening on http://localhost:${config.PORT}`);
    });
  })
  .catch((err) => {
    console.error('初始化数据目录失败：', err && err.message);
    process.exit(1);
  });

module.exports = app;
