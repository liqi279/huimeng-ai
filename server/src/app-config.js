'use strict';

/* =============================================================
 * 服务端供应商配置（app_config 表）
 * -------------------------------------------------------------
 * 读取顺序：环境变量 > app_config 表 > 内置默认值。
 * 表结构见 server/data/app_config.sql；真实密钥只进表，仓库仅保留模板。
 * 读取结果在实例内缓存 60 秒，避免每次生图都查库。
 * 本模块只返回值，不打印/不返回密钥明文。
 * ============================================================= */

const userStore = require('./user-store-mysql');
const config = require('./config');

const TTL_MS = 60 * 1000;
const TABLE_SQL = `CREATE TABLE IF NOT EXISTS app_config (
  \`key\` VARCHAR(64) NOT NULL,
  \`value\` MEDIUMTEXT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (\`key\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

let cache = { at: 0, map: {} };
let tableReady = false;

async function ensureTable() {
  if (tableReady) return;
  try {
    await userStore.q(TABLE_SQL);
    tableReady = true;
  } catch (err) {
    console.error('[app-config] 建表失败：' + (err && err.message));
  }
}

async function loadMap() {
  await ensureTable();
  try {
    const [rows] = await userStore.q('SELECT `key`, `value` FROM app_config');
    const map = {};
    for (const row of rows) {
      const key = String((row && row.key) || '').trim();
      if (!key) continue;
      map[key] = String((row && row.value) || '').trim();
    }
    return map;
  } catch (err) {
    console.error('[app-config] 读取失败，沿用上次缓存：' + (err && err.message));
    return cache.map || {};
  }
}

async function rows() {
  const now = Date.now();
  if (!cache.at || now - cache.at > TTL_MS) {
    const map = await loadMap();
    cache = { at: now, map };
  }
  return cache.map || {};
}

function pick(map, keys) {
  for (const key of keys) {
    const value = map[key];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function normalizeBase(raw) {
  const value = String(raw || '').trim().replace(/\/+$/, '');
  if (!value) return '';
  return /\/v\d+(beta)?$/i.test(value) ? value : value + '/v1';
}

function envBase() {
  const raw = process.env.GOOGLE_GEMINI_BASE_URL || process.env.RAYIN_BASE || '';
  return raw ? normalizeBase(raw) : '';
}

function envImageModel() {
  const explicit = String(process.env.BANANA_MODEL || '').trim();
  if (explicit) return explicit;
  const generic = String(process.env.GEMINI_MODEL || '').trim();
  /* GEMINI_MODEL 可能是纯文本模型（如 gemini-2.0-flash），不能拿来生图 */
  return /image/i.test(generic) ? generic : '';
}

/* Gemini 图像通道的最终生效配置（不含 source 之外的敏感信息） */
async function getGemini() {
  const map = await rows();
  const dbKey = pick(map, ['gemini.apiKey', 'GEMINI_API_KEY', 'GEMINI_KEY']);
  const dbBase = normalizeBase(pick(map, ['gemini.baseUrl', 'GOOGLE_GEMINI_BASE_URL', 'RAYIN_BASE']));
  const dbModel = pick(map, ['gemini.defaultModel', 'GEMINI_MODEL']);

  const envKey = config.GEMINI_KEY || '';
  const key = envKey || dbKey;
  const base = envBase() || dbBase || config.RAYIN_BASE;
  const model = envImageModel() || dbModel || config.BANANA_MODEL;

  return {
    base,
    key,
    model,
    source: {
      key: envKey ? 'env' : (dbKey ? 'db' : 'none'),
      base: envBase() ? 'env' : (dbBase ? 'db' : 'default'),
      model: envImageModel() ? 'env' : (dbModel ? 'db' : 'default'),
    },
  };
}

/* GPT 图像通道（engine=gpt-image）的最终生效配置
 * 与 Gemini 通道一致：环境变量 > app_config 表 > 内置默认。
 * 之前这条通道只读环境变量 OPENAI_KEY，表里配了 Key 也不生效，
 * 于是 SCF 上没配 OPENAI_KEY 时 gpt-image 直接报「未配置 RayinAPI Key」。 */
async function getOpenAI() {
  const map = await rows();
  const dbKey = pick(map, ['openai.apiKey', 'OPENAI_API_KEY', 'OPENAI_KEY', 'rayin.openaiKey']);
  const dbBase = normalizeBase(pick(map, ['openai.baseUrl', 'OPENAI_BASE_URL']));
  const dbModel = pick(map, ['openai.defaultModel', 'OPENAI_IMAGE_MODEL']);

  const envKey = config.OPENAI_KEY || '';
  const key = envKey || dbKey;
  const base = envBase() || dbBase || config.RAYIN_BASE;
  const model = dbModel || config.GPT_MODEL;

  return {
    key,
    base,
    model,
    source: {
      key: envKey ? 'env' : (dbKey ? 'db' : 'none'),
      base: envBase() ? 'env' : (dbBase ? 'db' : 'default'),
      model: dbModel ? 'db' : 'default',
    },
  };
}

/* 平台所有者的 gpt-image Key（未登录访客兜底用）。
 * 来源：user_documents 里带 providers['__rayin__:gpt-image'].key 的 api 文档。
 * 等价于过去 OPENAI_KEY 环境变量的用途，但不再把密钥复制到第二个位置。
 * 只在服务端内存里流转：不返回前端、不写日志、不回显、不落盘。 */
let platformKey = { key: '', at: 0 };
const PLATFORM_TTL_MS = 10 * 60 * 1000;

async function platformOpenAIKey() {
  const now = Date.now();
  if (platformKey.key && now - platformKey.at < PLATFORM_TTL_MS) return platformKey;
  try {
    const [list] = await userStore.q(
      `SELECT data FROM user_documents WHERE data LIKE '%__rayin__:gpt-image%' ORDER BY updated_at DESC LIMIT 50`,
    );
    for (const row of list || []) {
      let doc = row && row.data;
      if (typeof doc === 'string') {
        try { doc = JSON.parse(doc); } catch (err) { continue; }
      }
      const prov = doc && doc.providers && doc.providers['__rayin__:gpt-image'];
      const key = prov && typeof prov.key === 'string' ? prov.key.trim() : '';
      if (key) {
        const base = prov && typeof prov.base === 'string' ? normalizeBase(prov.base.trim()) : '';
        const model = prov && typeof prov.model === 'string' ? prov.model.trim() : '';
        platformKey = { key, base, model, at: now };
        return platformKey;
      }
    }
  } catch (err) {
    console.error('[app-config] 平台 Key 读取失败：' + (err && err.code || 'query-error'));
  }
  return { key: '', base: '', model: '', at: now };
}

/* 通用 KV：生图通道熔断状态等运行时开关存在这里，不新增表 */
async function getKV(key) {
  const map = await rows();
  return pick(map, [key]);
}

async function setKV(key, value) {
  try {
    await ensureTable();
    await userStore.q(
      'INSERT INTO app_config (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
      [String(key), String(value)],
    );
    cache.at = 0;
  } catch (err) {
    console.error('[app-config] 写入失败：' + (err && err.message));
  }
}

module.exports = {
  getGemini,
  getOpenAI,
  normalizeBase,
  platformOpenAIKey,
  getKV,
  setKV,
};
