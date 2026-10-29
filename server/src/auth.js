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
    if (!user) {
      /* ========== Render 免费层重启 → data/users.json 被清空 ==========
         Token 签名仍有效（secret 固定），但 DB 用户记录丢了。
         尝试用 token payload 里的 username 自动重建用户，
         或退而求其次，trust token payload 直接放行，不让前端误以为 token 过期。 */
      if (payload.username) {
        /* 有足够信息 → 自动重建用户（无密码，走内部重建） */
        return store.reviveUser(payload.uid, payload.username, payload.role || 'user')
          .then((revived) => {
            req.user = { id: revived.id, username: revived.username, role: revived.role };
            next();
          });
      }
      /* 旧 token 只有 uid → trust token payload 直接放行，避免前端强制登出 */
      req.user = { id: payload.uid, username: 'guest_' + payload.uid.slice(-6), role: 'user' };
      next();
      return;
    }
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
      else if (payload.username) {
        /* 自动重建 */
        store.reviveUser(payload.uid, payload.username, payload.role || 'user')
          .then((revived) => { req.user = { id: revived.id, username: revived.username, role: revived.role }; })
          .catch(() => {});
      } else {
        /* 旧 token：trust payload */
        req.user = { id: payload.uid, username: 'guest_' + payload.uid.slice(-6), role: 'user' };
      }
      next();
    }).catch(() => next());
  } else {
    next();
  }
}

module.exports = { authRequired, adminOnly, authOptional };
