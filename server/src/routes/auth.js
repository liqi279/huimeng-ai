'use strict';

const express = require('express');
const { wrap, assert } = require('../http');
const store = require('../store');
const { authRequired, authOptional, adminOnly, invalidateUserCache } = require('../auth');

const router = express.Router();
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; /* 30 天 */

/* 统一输出结构：兼容 MySQL 行（created_at）与本地 JSON 对象（createdAt） */
function toPublic(u) {
  if (!u) return null;
  const createdAt = Number(u.createdAt != null ? u.createdAt : u.created_at) || 0;
  const approvedAtRaw = u.approvedAt != null ? u.approvedAt : u.approved_at;
  return {
    id: u.id,
    username: u.username,
    email: u.email || null,
    role: u.role === 'admin' ? 'admin' : 'user',
    status: (u.status === 'pending' || u.status === 'rejected') ? u.status : 'approved',
    note: u.note || '',
    createdAt,
    approvedAt: approvedAtRaw == null ? null : Number(approvedAtRaw) || null,
  };
}

function tokenFor(user) {
  return store.signToken({ uid: user.id, username: user.username, role: user.role });
}

function statusBlockMessage(user) {
  if (user.status === 'rejected') {
    return '你的注册申请已被拒绝' + (user.note ? '（原因：' + user.note + '）' : '') + '，如有疑问请联系超级管理员';
  }
  return '账号正在等待超级管理员审批，审批通过后即可登录';
}

/* ============ 存储状态（健康检查，前端账号管理顶部展示） ============ */
router.get('/auth/store-status', wrap(async (req, res) => {
  const state = store.userStoreState();
  res.json({
    storage: state.mode,
    label: state.label || (state.mode === 'mysql' ? 'MySQL' : '文件存储'),
    warning: state.warning || (state.mode === 'mysql' ? '' : '当前为文件存储，Render 重启可能丢失账号数据'),
  });
}));

/* ============ 注册：仅超管可用，创建即为 approved ============ */
router.post('/auth/register', authOptional, wrap(async (req, res) => {
  /* 未登录 / 非超管一律 403：不区分「没带 token」和「带了普通账号 token」，
     避免把「注册入口已关闭」暴露成 401 登录失效。 */
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      error: { message: '公开注册已关闭，仅超级管理员可在「账号管理 → 新增人员」创建账号', code: 'ADMIN_ONLY' },
    });
  }
  const { username, password, email, role, note } = req.body || {};
  assert(username && typeof username === 'string', 400, '缺少用户名');
  assert(password && typeof password === 'string', 400, '缺少密码');
  assert(username.trim().length >= 3, 400, '用户名至少 3 个字符');
  assert(password.length >= 6, 400, '密码至少 6 个字符');
  if (email) assert(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email)), 400, '邮箱格式不正确');

  const result = await store.createUser({
    username: username.trim(),
    password,
    email: email ? String(email).trim() : null,
    role: role === 'admin' ? 'admin' : 'user',
    status: 'approved',
    note: note ? String(note).slice(0, 255) : ('由超管 ' + req.user.username + ' 创建'),
  });
  if (!result.ok) {
    return res.status(409).json({ error: { message: result.error, code: 'USERNAME_TAKEN' } });
  }

  /* 直接 approved：可立即登录，不再进 pending 队列 */
  res.json({
    ok: true,
    approved: true,
    message: '账号已创建，可直接登录',
    user: toPublic(result.user),
  });
}));

/* ============ 登录：校验审批状态 ============ */
router.post('/auth/login', wrap(async (req, res) => {
  const { username, password } = req.body || {};
  assert(username && password, 400, '缺少用户名或密码');
  const user = await store.authenticateUser(String(username).trim(), password);
  if (!user) return res.status(401).json({ error: { message: '用户名或密码错误' } });
  if (user.status !== 'approved') {
    return res.status(403).json({
      error: { message: statusBlockMessage(user), code: 'ACCOUNT_' + String(user.status).toUpperCase() },
      user: { username: user.username, status: user.status },
    });
  }
  const token = tokenFor(user);
  res.json({ user: toPublic(user), token, expiresAt: Date.now() + TOKEN_TTL_MS });
}));

/* ============ 当前用户（含资料与偏好，后端为准） ============ */
router.get('/auth/me', authRequired, wrap(async (req, res) => {
  const raw = await store.findUserById(req.user.id);
  const user = toPublic(raw) || { id: req.user.id, username: req.user.username, role: req.user.role, status: 'approved' };
  let profile = null;
  let preferences = null;
  try { profile = await store.getProfile(req.user.id); } catch (e) {}
  try { preferences = await store.getPreferences(req.user.id); } catch (e) {}
  res.json({ user, profile, preferences });
}));

/* 登出（前端删 token 即可，后端无需操作，这里仅占位） */
router.post('/auth/logout', authRequired, wrap(async (req, res) => {
  res.json({ ok: true });
}));

/* ============ 管理员：用户列表（含待审批数量） ============ */
router.get('/auth/users', authRequired, adminOnly, wrap(async (req, res) => {
  const users = (await store.listUsers()).map(toPublic);
  const pendingCount = users.filter((u) => u.status === 'pending').length;
  const state = store.userStoreState();
  res.json({
    users,
    pendingCount,
    storage: state.mode,
    storageLabel: state.label,
    storageWarning: state.warning,
  });
}));

/* 文件存储中的账号一键同步进 MySQL（保留盐/哈希/状态） */
router.post('/auth/users/migrate-file', authRequired, adminOnly, wrap(async (req, res) => {
  const state = store.userStoreState();
  if (state.mode !== 'mysql') {
    return res.status(400).json({ error: { message: '当前未连接 MySQL，无法同步。请先配置 MYSQL_URL 或 MYSQL_HOST 并重启服务。' } });
  }
  const result = await store.migrateFromFile();
  res.json(Object.assign({ ok: true }, result));
}));

/* 待审批数量（用于角标轮询，禁止普通用户访问） */
router.get('/auth/users/pending-count', authRequired, adminOnly, wrap(async (req, res) => {
  res.json({ count: await store.countPendingUsers() });
}));

/* 待审批列表 */
router.get('/auth/users/pending', authRequired, adminOnly, wrap(async (req, res) => {
  const users = (await store.listUsers()).map(toPublic).filter((u) => u.status === 'pending');
  res.json({ users, count: users.length });
}));

/* 导出账号快照（备份用） */
router.get('/auth/users/export', authRequired, adminOnly, wrap(async (req, res) => {
  const snapshot = await store.exportUsers();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="huimeng-users-export.json"');
  res.send(JSON.stringify(snapshot, null, 2));
}));

/* 管理员：查看任意用户资料 */
router.get('/auth/users/:id/profile', authRequired, adminOnly, wrap(async (req, res) => {
  const raw = await store.findUserById(req.params.id);
  if (!raw) return res.status(404).json({ error: { message: '用户不存在' } });
  res.json({
    user: toPublic(raw),
    profile: await store.getProfile(req.params.id),
    preferences: await store.getPreferences(req.params.id),
  });
}));

/* 管理员：创建用户（直接 approved） */
router.post('/auth/users', authRequired, adminOnly, wrap(async (req, res) => {
  const { username, password, role, email, note } = req.body || {};
  assert(username && password, 400, '缺少用户名或密码');
  assert(String(username).trim().length >= 3, 400, '用户名至少 3 个字符');
  assert(String(password).length >= 6, 400, '密码至少 6 个字符');
  if (email) assert(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email)), 400, '邮箱格式不正确');
  const result = await store.createUser({
    username: String(username).trim(),
    password,
    email: email ? String(email).trim() : null,
    role: role === 'admin' ? 'admin' : 'user',
    status: 'approved',
    note: note ? String(note).slice(0, 255) : ('由超管 ' + req.user.username + ' 创建'),
  });
  if (!result.ok) {
    return res.status(409).json({ error: { message: result.error, code: 'USERNAME_TAKEN' } });
  }
  res.json({ ok: true, user: toPublic(result.user) });
}));

/* ============ 管理员：审批（通过 / 拒绝） ============ */
router.patch('/auth/users/:id/status', authRequired, adminOnly, wrap(async (req, res) => {
  const { status, note } = req.body || {};
  assert(status === 'approved' || status === 'rejected', 400, '状态必须为 approved 或 rejected');
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: { message: '不能修改自己的审批状态' } });
  }
  const target = toPublic(await store.findUserById(req.params.id));
  if (!target) return res.status(404).json({ error: { message: '用户不存在' } });
  if (target.role === 'admin' && status === 'rejected') {
    return res.status(400).json({ error: { message: '不能拒绝一个超级管理员账号' } });
  }
  const result = await store.setUserStatus(req.params.id, status, req.user.id, note ? String(note).slice(0, 255) : '');
  if (!result.ok) return res.status(404).json({ error: { message: result.error } });
  invalidateUserCache(req.params.id);
  res.json({ user: toPublic(result.user) });
}));

/* ============ 管理员：修改角色（保护最后一个超管） ============ */
router.patch('/auth/users/:id/role', authRequired, adminOnly, wrap(async (req, res) => {
  const { role } = req.body || {};
  assert(role === 'admin' || role === 'user', 400, '角色必须为 admin 或 user');
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: { message: '不能修改自己的角色' } });
  }
  const target = toPublic(await store.findUserById(req.params.id));
  if (!target) return res.status(404).json({ error: { message: '用户不存在' } });
  if (role === 'admin' && target.status !== 'approved') {
    return res.status(400).json({ error: { message: '请先通过该账号的注册申请，再设为超级管理员' } });
  }
  if (role === 'user' && target.role === 'admin') {
    const admins = await store.countAdmins();
    if (admins <= 1) {
      return res.status(400).json({ error: { message: '至少需要保留一个超级管理员，操作已阻止' } });
    }
  }
  const result = await store.updateUserRole(req.params.id, role);
  if (!result.ok) return res.status(404).json({ error: { message: result.error } });
  invalidateUserCache(req.params.id);
  res.json({ user: toPublic(result.user) });
}));

/* 管理员：重置密码 */
router.patch('/auth/users/:id/password', authRequired, adminOnly, wrap(async (req, res) => {
  const { password } = req.body || {};
  assert(password && typeof password === 'string' && password.length >= 6, 400, '密码至少 6 个字符');
  const result = await store.resetUserPassword(req.params.id, password);
  if (!result.ok) return res.status(404).json({ error: { message: result.error } });
  res.json({ ok: true });
}));

/* 管理员：删除用户（保护最后一个超管） */
router.delete('/auth/users/:id', authRequired, adminOnly, wrap(async (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: { message: '不能删除自己' } });
  }
  const target = toPublic(await store.findUserById(req.params.id));
  if (!target) return res.status(404).json({ error: { message: '用户不存在' } });
  if (target.role === 'admin') {
    const admins = await store.countAdmins();
    if (admins <= 1) {
      return res.status(400).json({ error: { message: '至少需要保留一个超级管理员，操作已阻止' } });
    }
  }
  const result = await store.deleteUser(req.params.id);
  if (!result.ok) return res.status(404).json({ error: { message: result.error } });
  invalidateUserCache(req.params.id);
  res.json({ ok: true });
}));

/* ============ 当前用户资料 / 偏好（只能操作自己） ============ */
router.get('/auth/profile', authRequired, wrap(async (req, res) => {
  res.json({ profile: await store.getProfile(req.user.id) });
}));

router.patch('/auth/profile', authRequired, wrap(async (req, res) => {
  const body = req.body || {};
  assert(body && typeof body === 'object', 400, '请求体格式不正确');
  if (body.email) assert(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(body.email)), 400, '邮箱格式不正确');
  const profile = await store.updateProfile(req.user.id, {
    displayName: body.displayName,
    email: body.email,
    bio: body.bio,
    avatarUrl: body.avatarUrl,
  });
  res.json({ profile });
}));

router.get('/auth/preferences', authRequired, wrap(async (req, res) => {
  res.json({ preferences: await store.getPreferences(req.user.id) });
}));

router.patch('/auth/preferences', authRequired, wrap(async (req, res) => {
  const body = req.body || {};
  assert(body && typeof body === 'object', 400, '请求体格式不正确');
  const preferences = await store.updatePreferences(req.user.id, {
    theme: body.theme,
    language: body.language,
    prefs: body.prefs,
  });
  res.json({ preferences });
}));

module.exports = router;
