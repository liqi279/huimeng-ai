'use strict';

const express = require('express');
const { wrap, assert } = require('../http');
const { authOptional } = require('../auth');
const library = require('../library-store');

const router = express.Router();

/* 图书馆用户标识：已登录用账号 ID，未登录用 guest 或前端传来的本地标识 */
function keyOf(req) {
  if (req.user && req.user.id) return 'u_' + req.user.id;
  return library.userKey(req.get('x-library-user'));
}

/* ---------- 书籍 ---------- */
router.get('/library/books', authOptional, wrap(async (req, res) => {
  const q = String(req.query.q || '');
  const category = String(req.query.category || '');
  const items = await library.list(q, category);
  res.json({ items, total: items.length, store: await library.stats() });
}));

router.get('/library/suggest', authOptional, wrap(async (req, res) => {
  res.json(await library.suggest(String(req.query.q || '')));
}));

router.get('/library/stats', wrap(async (req, res) => {
  res.json(await library.stats());
}));

router.get('/library/books/:id', authOptional, wrap(async (req, res) => {
  const book = await library.get(req.params.id);
  assert(book, 404, '书籍不存在', '请检查书籍 ID');
  const key = keyOf(req);
  res.json({
    book,
    favorite: await library.isFavorite(key, book.id),
    progress: await library.progress(key, book.id),
  });
}));

/* 新增书籍（body 可直接给 book 字段，也兼容 { book: {...} }） */
router.post('/library/books', authOptional, wrap(async (req, res) => {
  const body = req.body && req.body.book ? req.body.book : (req.body || {});
  const book = await library.create(body);
  res.status(201).json({ book });
}));

router.put('/library/books/:id', authOptional, wrap(async (req, res) => {
  const body = req.body && req.body.book ? req.body.book : (req.body || {});
  const book = await library.update(req.params.id, body);
  assert(book, 404, '书籍不存在', '请检查书籍 ID');
  res.json({ book });
}));

router.delete('/library/books/:id', authOptional, wrap(async (req, res) => {
  const ok = await library.remove(req.params.id);
  assert(ok, 404, '书籍不存在', '请检查书籍 ID');
  res.json({ ok: true });
}));

/* ---------- 收藏 ---------- */
router.get('/library/favorites', authOptional, wrap(async (req, res) => {
  res.json({ items: await library.favorites(keyOf(req)) });
}));

router.post('/library/favorites', authOptional, wrap(async (req, res) => {
  const bookId = String((req.body && req.body.bookId) || '');
  assert(bookId, 400, '缺少 bookId', '请求体需包含 bookId');
  res.json(await library.setFavorite(keyOf(req), bookId, true));
}));

router.delete('/library/favorites/:bookId', authOptional, wrap(async (req, res) => {
  res.json(await library.setFavorite(keyOf(req), req.params.bookId, false));
}));

/* ---------- 阅读历史 / 续读 ---------- */
router.get('/library/history', authOptional, wrap(async (req, res) => {
  res.json({ items: await library.history(keyOf(req)) });
}));

router.get('/library/progress/:bookId', authOptional, wrap(async (req, res) => {
  res.json({ progress: await library.progress(keyOf(req), req.params.bookId) });
}));

router.post('/library/progress', authOptional, wrap(async (req, res) => {
  const body = req.body || {};
  const bookId = String(body.bookId || '');
  assert(bookId, 400, '缺少 bookId', '请求体需包含 bookId');
  const saved = await library.saveProgress(keyOf(req), bookId, body.lastPage);
  res.json({ progress: saved });
}));

module.exports = router;
