'use strict';

const store = require('./store');

/* 用户信息内存缓存（60 秒）：登录/刷新等高频请求不再每次都查数据库，
   跨地域数据库往返通常要数百毫秒到数秒。角色变更最迟 60 秒后生效。 */
const userCache = new Map();
const USER_CACHE_TTL = 60000;

function cachedFindUser(id) {
  const hit = userCache.get(id);
  if (hit && Date.now() - hit.at < USER_CACHE_TTL) return Promise.resolve(hit.user);
  return store.findUserById(id).then((user) => {
    if (user) userCache.set(id, { user, at: Date.now() });
    else userCache.delete(id);
    return user;
  });
}

/* 仅校验签名并从 token 取用户信息（不查库）：用于 /auth/me 这类只读自身信息的接口 */
function tokenOnly(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const payload = store.verifyToken(token);
  if (!payload || !payload.uid) {
    return res.status(401).json({ error: { message: '未登录或登录已过期' } });
  }
  req.user = {
    id: payload.uid,
    username: payload.username || ('guest_' + payload.uid.slice(-6)),
    role: payload.role || 'user',
  };
  next();
}

/* 从请求头 Authorization: Bearer <token> 里解析用户，挂到 req.user */
function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const payload = store.verifyToken(token);
  if (!payload || !payload.uid) {
    return res.status(401).json({ error: { message: '未登录或登录已过期' } });
  }
  cachedFindUser(payload.uid).then((user) => {
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
    /* 先信任 token payload 设置 req.user（防止 reviveUser 异步未完成时
       req.user 仍为 undefined，导致作品/桌面存进全局而非用户专属文件） */
    req.user = {
      id: payload.uid,
      username: payload.username || ('guest_' + payload.uid.slice(-6)),
      role: payload.role || 'user'
    };
    cachedFindUser(payload.uid).then((user) => {
      if (user) {
        req.user = { id: user.id, username: user.username, role: user.role };
      } else if (payload.username) {
        /* Render 重启清空 users.json → 自动重建用户（不阻塞 next，req.user 已设） */
        store.reviveUser(payload.uid, payload.username, payload.role || 'user').catch(() => {});
      }
      next();
    }).catch(() => next());
  } else {
    next();
  }
}

module.exports = { authRequired, adminOnly, authOptional, tokenOnly };
