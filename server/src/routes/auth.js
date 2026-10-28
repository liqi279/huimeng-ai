'use strict';

const express = require('express');
const { wrap, assert } = require('../http');
const store = require('../store');
const { authRequired, adminOnly } = require('../auth');

const router = express.Router();
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; /* 30 天 */

/* 注册 */
router.post('/auth/register', wrap(async (req, res) => {
  const { username, password } = req.body || {};
  assert(username && typeof username === 'string', 400, '缺少用户名');
  assert(password && typeof password === 'string', 400, '缺少密码');
  assert(username.length >= 3, 400, '用户名至少 3 个字符');
  assert(password.length >= 6, 400, '密码至少 6 个字符');

  const result = await store.createUser({ username, password, role: 'user' });
  if (!result.ok) return res.status(409).json({ error: { message: result.error } });
  const token = store.signToken({ uid: result.user.id });
  res.json({ user: result.user, token, expiresAt: Date.now() + TOKEN_TTL_MS });
}));

/* 登录 */
router.post('/auth/login', wrap(async (req, res) => {
  const { username, password } = req.body || {};
  assert(username && password, 400, '缺少用户名或密码');
  const user = await store.authenticateUser(username, password);
  if (!user) return res.status(401).json({ error: { message: '用户名或密码错误' } });
  const token = store.signToken({ uid: user.id });
  res.json({ user, token, expiresAt: Date.now() + TOKEN_TTL_MS });
}));

/* 当前用户信息 */
router.get('/auth/me', authRequired, wrap(async (req, res) => {
  res.json({ user: req.user });
}));

/* 登出（前端删 token 即可，后端无需操作，这里仅占位） */
router.post('/auth/logout', authRequired, wrap(async (req, res) => {
  res.json({ ok: true });
}));

/* 管理员：用户列表 */
router.get('/auth/users', authRequired, adminOnly, wrap(async (req, res) => {
  const users = await store.listUsers();
  res.json({
    users: users.map((u) => ({
      id: u.id,
      username: u.username,
      role: u.role,
      createdAt: u.createdAt,
    })),
  });
}));

/* 管理员：创建用户（可指定角色） */
router.post('/auth/users', authRequired, adminOnly, wrap(async (req, res) => {
  const { username, password, role } = req.body || {};
  assert(username && password, 400, '缺少用户名或密码');
  assert(username.length >= 3, 400, '用户名至少 3 个字符');
  assert(password.length >= 6, 400, '密码至少 6 个字符');
  const result = await store.createUser({ username, password, role });
  if (!result.ok) return res.status(409).json({ error: { message: result.error } });
  res.json({ user: result.user });
}));

/* 管理员：修改角色 */
router.patch('/auth/users/:id/role', authRequired, adminOnly, wrap(async (req, res) => {
  const { role } = req.body || {};
  assert(role === 'admin' || role === 'user', 400, '角色必须为 admin 或 user');
  /* 不允许修改自己 */
  if (req.params.id === req.user.id) return res.status(400).json({ error: { message: '不能修改自己的角色' } });
  const result = await store.updateUserRole(req.params.id, role);
  if (!result.ok) return res.status(404).json({ error: { message: result.error } });
  res.json({ user: result.user });
}));

/* 管理员：重置密码 */
router.patch('/auth/users/:id/password', authRequired, adminOnly, wrap(async (req, res) => {
  const { password } = req.body || {};
  assert(password && typeof password === 'string' && password.length >= 6, 400, '密码至少 6 个字符');
  const result = await store.resetUserPassword(req.params.id, password);
  if (!result.ok) return res.status(404).json({ error: { message: result.error } });
  res.json({ ok: true });
}));

/* 管理员：删除用户 */
router.delete('/auth/users/:id', authRequired, adminOnly, wrap(async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: { message: '不能删除自己' } });
  const result = await store.deleteUser(req.params.id);
  if (!result.ok) return res.status(404).json({ error: { message: result.error } });
  res.json({ ok: true });
}));

module.exports = router;
