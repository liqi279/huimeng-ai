'use strict';

/* =============================================================
 * 测试生图 → 个人空间桌面
 * -------------------------------------------------------------
 * 生图产物此前只落在对象存储与 generate_jobs 里，桌面看不到。
 * 这里把「已完成任务」中的图片补成作品（user_works）：
 *   - 只新增作品，不写 desk.assigns / positions / folders / stacks；
 *     未归入文件夹的作品天然显示在桌面根层，前端会自动紧凑排到空位
 *     （desk.js 的 placeCard 只在 positions._userSet 时才用存储坐标，
 *      凭空写 position 既无效又会制造脏数据，所以这里一条 desk 文档都不写）
 *   - 幂等：作品 id = gen-<jobId>[-序号]；并按图片文件名与已有作品去重
 *   - 作品 URL 用绝对地址（/api/uploads/... 补成后端域名），
 *     显示走 /api/uploads、下载走 /api/download，都是上一批修好的通路
 * ============================================================= */

const config = require('./config');
const userData = require('./user-data');
const jobs = require('./jobs');

const API_BASE = String(
  process.env.API_BASE || 'https://1527498271-1pw3yw7nzz.ap-guangzhou.tencentscf.com'
).replace(/\/+$/, '');

function baseName(url) {
  if (!url || typeof url !== 'string') return '';
  const clean = url.split('?')[0].split('#')[0];
  const parts = clean.split('/');
  return parts[parts.length - 1] || clean;
}

function absoluteUrl(url) {
  if (/^https?:\/\//i.test(url)) return url;
  return API_BASE + (url.charAt(0) === '/' ? url : '/' + url);
}

function workIdOf(jobId, index) {
  return 'gen-' + String(jobId) + (index ? '-' + index : '');
}

/* 已有作品的图片文件名集合：按文件名去重（文件名 = 生成时的时间戳 + 随机串） */
async function existingNames(userId) {
  const names = new Set();
  try {
    const page = await userData.listChanges(userId, { limit: 500 });
    ((page && page.items) || []).forEach((row) => {
      const name = baseName(row && row.data && row.data.url);
      if (name) names.add(name);
    });
  } catch (err) {}
  return names;
}

async function currentWorks(userId) {
  try {
    const page = await userData.listChanges(userId, { limit: 500 });
    return (page && page.items) || [];
  } catch (err) {
    return [];
  }
}

async function addImageItem(userId, jobId, item, index, createdAt, seen) {
  if (!item || item.type !== 'image' || !item.url) return false;
  const name = baseName(item.url);
  if (name && seen.has(name)) return false;
  const id = workIdOf(jobId, index);
  const have = await userData.getWork(userId, id);
  if (have) return false;
  await userData.putWork(userId, {
    id,
    type: 'image',
    url: absoluteUrl(item.url),
    thumb: '',
    ok: true,
    prompt: item.prompt || '',
    engine: item.engine || '',
    seed: Number(item.seed) || 0,
    width: Number(item.width) || 0,
    height: Number(item.height) || 0,
    jobId: String(jobId),
    createdAt: new Date(createdAt || Date.now()).toISOString(),
  }, null);
  if (name) seen.add(name);
  return true;
}

/* 单个任务产出后立刻进桌面（今后每次生成都走这里）。
   userId 为空（访客任务）时跳过：无法确定归属，不往任何人的桌面写。 */
async function addJobToDesk(userId, jobId, result, createdAt) {
  if (!userId || !result) return 0;
  const items = Array.isArray(result.items) ? result.items : [];
  if (!items.length) return 0;
  const seen = await existingNames(userId);
  const works = await currentWorks(userId);
  const cap = Math.max(1, Number(config.USER_WORK_CAP) || 500);
  let added = 0;
  for (let i = 0; i < items.length; i += 1) {
    if (works.length + added >= cap - 5) break;
    if (await addImageItem(String(userId), jobId, items[i], i, createdAt, seen)) added += 1;
  }
  return added;
}

/* 批量补录：把该用户最近 N 个已完成任务的图片补进桌面 */
async function backfillUser(userId, opts) {
  const uid = String(userId || '');
  if (!uid) return { added: 0, skipped: 0, error: 'missing user' };
  const limit = Math.max(1, Math.min(Number(opts && opts.limit) || 60, 200));
  const cap = Math.max(1, Number(config.USER_WORK_CAP) || 500);

  const metaBefore = await userData.getDocMeta(uid, 'desk').catch(() => null);
  const revBefore = Number(metaBefore && metaBefore.rev) || 0;
  const worksBefore = (await currentWorks(uid)).length;

  const seen = await existingNames(uid);
  const rows = await jobs.listDone(uid, limit);
  let added = 0;
  let skipped = 0;
  for (const job of rows) {
    const items = (job.result && job.result.items) || [];
    for (let i = 0; i < items.length; i += 1) {
      if (worksBefore + added >= cap - 5) {
        skipped += 1;
        continue;
      }
      if (await addImageItem(uid, job.id, items[i], i, job.createdAt, seen)) added += 1;
      else skipped += 1;
    }
  }

  const metaAfter = await userData.getDocMeta(uid, 'desk').catch(() => null);
  return {
    added,
    skipped,
    jobs: rows.length,
    worksBefore,
    worksAfter: (await currentWorks(uid)).length,
    revBefore,
    revAfter: Number(metaAfter && metaAfter.rev) || 0,
    /* 桌面文档零写入：没有 folders/stacks/assigns/names/positions 变更 */
    deskDocWrites: 0,
    existingChanged: false,
    cap,
  };
}

module.exports = { addJobToDesk, backfillUser };
