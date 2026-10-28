'use strict';

const store = require('./store');

/* 从请求头 Authorization: Bearer <token> 里解析用户，挂到 req.user */
function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const payload = store.verifyToken(token);
  if (!payload || !payload.uid) {
    return res.status(401).json({ error: { message: '未登录或登录已过期' } });
  }
  store.findUserById(payload.uid).then((user) => {
    if (!user) return res.status(401).json({ error: { message: '账号不存在' } });
    req.user = { id: user.id, username: user.username, role: user.role };
    next();
  }).catch(() => res.status(500).json({ error: { message: '认证失败' } }));
}

/* 仅超级管理员 */
function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: { message: '需要管理员权限' } });
  }
  next();
}

/* 可选：有 token 就解析，没有也放行 */
function authOptional(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const payload = store.verifyToken(token);
  if (payload && payload.uid) {
    store.findUserById(payload.uid).then((user) => {
      if (user) req.user = { id: user.id, username: user.username, role: user.role };
      next();
    }).catch(() => next());
  } else {
    next();
  }
}

module.exports = { authRequired, adminOnly, authOptional };
