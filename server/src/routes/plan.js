'use strict';

/**
 * 企划模块路由
 *
 * 功能：
 *   1. GET  /plan/trending?platform=douyin|weibo|zhihu|bilibili|baidu|toutiao|douban
 *      → 多平台实时热榜（后端代理，带内存缓存 TTL=5min）
 *   2. GET  /plan/ranking?category=anime|movie|game|music|tech
 *      → 各类别热度排行榜（聚合各平台数据 + 本地持久化）
 *   3. GET  /plan/search?q=xxx&category=&platform=
 *      → 热榜 + 企划书 关联搜索
 *   4. POST /plan/proposal          → 新建/保存企划书草稿
 *      GET  /plan/proposal          → 我的企划书列表
 *      GET  /plan/proposal/:id      → 读取企划书
 *      PATCH /plan/proposal/:id     → 更新企划书
 *      DELETE /plan/proposal/:id    → 删除企划书
 *
 * 前端数据源：
 *   - dailyhot 公开接口（聚合 55+ 平台）→ 备选方案
 *   - 知乎热榜 / 微博热搜 / B站热门 / 百度热搜 官方/半官方 JSON
 *   - Render 免费层 outbound fetch 必须用 http / 无代理
 */

const fsp = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { wrap, assert } = require('../http');
const store = require('../store');

const router = express.Router();

/* =============================================================
 * 热榜抓取 —— 多源 fallback + 内存缓存
 * ============================================================= */

/** @type {Map<string, { data: any, ts: number }>} */
const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 分钟

const PLATFORMS = {
  douyin:    { name: '抖音',    emoji: '🎵', url: 'https://www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/' },
  weibo:     { name: '微博',    emoji: '🔴', url: 'https://weibo.com/ajax/side/hotSearch' },
  zhihu:     { name: '知乎',    emoji: '💡', url: 'https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=50' },
  bilibili:  { name: 'B站',     emoji: '📺', url: 'https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all' },
  baidu:     { name: '百度',    emoji: '🔍', url: 'https://top.baidu.com/board?tab=realtime' },
  toutiao:   { name: '头条',    emoji: '📰', url: 'https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc' },
  douban:    { name: '豆瓣',    emoji: '📚', url: 'https://frodo.douban.com/api/v2/subject_collection/movie_showing/items?apiKey=0ac9b91f5886c4e29f5c7f18bc0a1d53&start=0&count=50' },
};

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
];

function randUA() { return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]; }

/**
 * 简易 HTTP GET 代理（不引入额外依赖）
 * 支持 http / https，自动跟随 1 次重定向，timeout 8s
 */
function httpGet(url, options) {
  const opts = options || {};
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? require('https') : require('http');
    const req = lib.request({
      method: 'GET',
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      headers: Object.assign({
        'User-Agent': opts.ua || randUA(),
        'Accept': opts.accept || 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Referer': opts.referer || url,
      }, opts.headers || {}),
      timeout: opts.timeout || 8000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // follow 1 redirect
        httpGet(new URL(res.headers.location, url).href, opts).then(resolve, reject);
        res.resume();
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const text = buf.toString('utf8');
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 200)}`));
          return;
        }
        resolve({ status: res.statusCode, headers: res.headers, text });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
    req.end();
  });
}

/** 从文本里尝试提取 JSON（有些接口会加 callback 或 JSONP 包装） */
function tryParseJSON(text) {
  if (!text) return null;
  // 直接 parse
  try { return JSON.parse(text); } catch (e) {}
  // 找第一个 { 到最后一个 }
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(text.slice(first, last + 1)); } catch (e) {}
  }
  // 找第一个 [ 到最后一个 ]
  const af = text.indexOf('[');
  const al = text.lastIndexOf(']');
  if (af >= 0 && al > af) {
    try { return JSON.parse(text.slice(af, al + 1)); } catch (e) {}
  }
  return null;
}

/**
 * 把各平台原生 JSON 归一成统一格式:
 * [{ rank, title, heat, url, category, image }]
 */
function normalizeDouyin(data) {
  try {
    const list = data && data.word_list;
    if (!Array.isArray(list)) return [];
    return list.slice(0, 50).map((item, i) => ({
      rank: i + 1,
      title: item.word || item.sentence_tag || '',
      heat: item.hot_value || item.hot || 0,
      url: 'https://www.douyin.com/hot/' + (item.word || ''),
      category: item.label || '',
      image: item.word_cover || '',
    }));
  } catch (e) { return []; }
}

function normalizeWeibo(data) {
  try {
    const list = data && data.data && data.data.cards;
    if (!Array.isArray(list)) return [];
    let rank = 0;
    const out = [];
    for (const card of list) {
      const g = card && card.card_group;
      if (Array.isArray(g)) {
        for (const sub of g) {
          if (sub && sub.desc) {
            rank++;
            out.push({
              rank,
              title: sub.desc,
              heat: sub.desc_extr || sub.num || 0,
              url: sub.scheme || ('https://s.weibo.com/weibo?q=%23' + encodeURIComponent(sub.desc) + '%23'),
              category: sub.label_name || '',
              image: sub.pic || '',
            });
          }
        }
      } else if (card && card.desc) {
        rank++;
        out.push({
          rank,
          title: card.desc,
          heat: card.desc_extr || card.num || 0,
          url: card.scheme || ('https://s.weibo.com/weibo?q=%23' + encodeURIComponent(card.desc) + '%23'),
          category: card.label_name || '',
          image: card.pic || '',
        });
      }
      if (rank >= 50) break;
    }
    return out;
  } catch (e) { return []; }
}

function normalizeZhihu(data) {
  try {
    const list = data && data.data;
    if (!Array.isArray(list)) return [];
    return list.slice(0, 50).map((item, i) => ({
      rank: i + 1,
      title: item.target && item.target.title || '',
      heat: item.detail_text || item.target && item.target.hot || 0,
      url: item.target && item.target.url || '',
      category: '',
      image: item.target && item.target.image || '',
    }));
  } catch (e) { return []; }
}

function normalizeBilibili(data) {
  try {
    const list = data && data.data && data.data.list;
    if (!Array.isArray(list)) return [];
    return list.slice(0, 50).map((item, i) => ({
      rank: i + 1,
      title: item.title || '',
      heat: item.score || item.view || 0,
      url: item.uri || ('https://www.bilibili.com/video/' + item.bvid) || '',
      category: item.typename || '',
      image: item.pic || '',
    }));
  } catch (e) { return []; }
}

function normalizeBaidu(data) {
  try {
    // 百度返回的是 HTML，里面有 <!-- JSON.stringify(data) -->
    const text = typeof data === 'string' ? data : JSON.stringify(data);
    const m = text.match(/<!--\s*(\{[\s\S]*?\})\s*-->/);
    let obj = null;
    if (m) { try { obj = JSON.parse(m[1]); } catch (e) {} }
    if (!obj) { obj = typeof data === 'object' ? data : null; }
    const cards = obj && obj.data && obj.data.cards;
    if (!Array.isArray(cards)) return [];
    const content = cards[0] && cards[0].content;
    if (!Array.isArray(content)) return [];
    return content.slice(0, 50).map((item, i) => ({
      rank: i + 1,
      title: item.word || item.query || '',
      heat: item.hotScore || item.hot_score || 0,
      url: item.url || item.rawUrl || '',
      category: item.tag || '',
      image: item.img || '',
    }));
  } catch (e) { return []; }
}

function normalizeToutiao(data) {
  try {
    const list = Array.isArray(data) ? data : (data && data.data && Array.isArray(data.data) ? data.data : []);
    return list.slice(0, 50).map((item, i) => ({
      rank: i + 1,
      title: item.Title || item.title || '',
      heat: item.HotValue || item.hot_value || 0,
      url: item.Url || item.url || '',
      category: '',
      image: item.Image || item.image || '',
    }));
  } catch (e) { return []; }
}

function normalizeDouban(data) {
  try {
    const list = data && data.subject_collection_items;
    if (!Array.isArray(list)) return [];
    return list.slice(0, 50).map((item, i) => ({
      rank: i + 1,
      title: item.title || item.subject && item.subject.title || '',
      heat: item.rating && item.rating.value || 0,
      url: item.url || item.subject && item.subject.url || '',
      category: item.subject && item.subject.genres && item.subject.genres.join('/') || '',
      image: item.cover_url || item.subject && item.subject.cover_url || '',
    }));
  } catch (e) { return []; }
}

const NORMALIZERS = {
  douyin: normalizeDouyin,
  weibo: normalizeWeibo,
  zhihu: normalizeZhihu,
  bilibili: normalizeBilibili,
  baidu: normalizeBaidu,
  toutiao: normalizeToutiao,
  douban: normalizeDouban,
};

/** 构造本地 fallback 热榜（当远端全挂时的兜底） */
function localFallback(platform) {
  const now = new Date().toISOString();
  const seed = platform || 'general';
  const base = [
    { title: 'AI 动漫 2025 年市场规模破千亿', heat: 987654, category: '科技' },
    { title: '新海诚新作《你的名字2》定档 2026 暑期', heat: 876543, category: '动漫' },
    { title: '国产动画《灵笼 第二季》PV 播放破亿', heat: 765432, category: '动漫' },
    { title: 'ComfyUI 发布 Wan2.1 动漫工作流', heat: 654321, category: '工具' },
    { title: 'GPT-5 视频生成能力实测：动漫画质接近新海诚', heat: 543210, category: '科技' },
    { title: '2025 春季新番导视：这 10 部必追', heat: 432109, category: '动漫' },
    { title: 'AI 辅助分镜工具 Storyboarder 3.0 发布', heat: 321098, category: '工具' },
    { title: '吉卜力工作室首次公开 AI 辅助创作流程', heat: 210987, category: '行业' },
    { title: 'B站 2025 国创动画发布会十大看点', heat: 109876, category: '动漫' },
    { title: '抖音 AI 动漫挑战赛：百万奖金等你拿', heat: 98765, category: '活动' },
  ];
  return base.map((b, i) => ({
    rank: i + 1,
    title: `[${PLATFORMS[seed]?.name || seed}] ${b.title}`,
    heat: b.heat,
    url: '#',
    category: b.category,
    image: '',
    _fallback: true,
    _generatedAt: now,
  }));
}

async function fetchPlatformTrending(platform) {
  const cfg = PLATFORMS[platform];
  if (!cfg) throw new Error('未知平台: ' + platform);

  // check cache
  const hit = cache.get(platform);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
    return hit.data;
  }

  // 依次尝试不同的 fetch 方式
  let result = null;
  let lastErr = null;

  const urls = [cfg.url];

  // 有些平台有多个可用端点
  if (platform === 'zhihu') {
    urls.push('https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=50&desktop=true');
  }
  if (platform === 'weibo') {
    urls.push('https://weibo.com/ajax/side/hotSearch');
  }

  for (const url of urls) {
    try {
      const { text } = await httpGet(url, { timeout: 6000 });
      const parsed = tryParseJSON(text);
      const norm = NORMALIZERS[platform] || (() => []);
      const items = parsed ? norm(parsed) : [];
      if (items.length > 0) {
        result = items;
        break;
      }
      lastErr = new Error('解析后为空');
    } catch (e) {
      lastErr = e;
    }
  }

  if (!result || result.length === 0) {
    // 用 fallback
    result = localFallback(platform);
  }

  cache.set(platform, { data: result, ts: Date.now() });
  return result;
}

/* ========== 路由 ========== */

/** GET /plan/trending?platform=xxx */
router.get('/plan/trending', wrap(async (req, res) => {
  const platform = String(req.query.platform || 'zhihu').toLowerCase();
  assert(PLATFORMS[platform], 400, '未知平台',
    `支持: ${Object.keys(PLATFORMS).join(', ')}`);

  let items = [];
  let source = 'remote';
  let fetchedAt = new Date().toISOString();
  try {
    items = await fetchPlatformTrending(platform);
    if (items.length > 0 && items[0]._fallback) source = 'fallback';
  } catch (e) {
    items = localFallback(platform);
    source = 'fallback';
  }

  res.json({
    platform,
    platformName: PLATFORMS[platform].name,
    platformEmoji: PLATFORMS[platform].emoji,
    source,
    fetchedAt,
    items,
  });
}));

/** GET /plan/trending/all —— 一次返回所有平台前 10 条 */
router.get('/plan/trending/all', wrap(async (req, res) => {
  const results = {};
  await Promise.all(Object.keys(PLATFORMS).map(async (p) => {
    try {
      const items = await fetchPlatformTrending(p);
      results[p] = items.slice(0, 10);
    } catch (e) {
      results[p] = localFallback(p).slice(0, 10);
    }
  }));
  res.json({ fetchedAt: new Date().toISOString(), results });
}));

/* =============================================================
 * 排行榜 —— 按类别聚合 + 本地持久化
 * ============================================================= */

const CATEGORIES = {
  anime:  { name: '动漫', emoji: '🎬', keywords: ['动漫', '动画', '番剧', '国创', '新番'] },
  movie:  { name: '影视', emoji: '🎥', keywords: ['电影', '电视剧', '剧集', '院线'] },
  game:   { name: '游戏', emoji: '🎮', keywords: ['游戏', '手游', '主机', 'Steam'] },
  music:  { name: '音乐', emoji: '🎵', keywords: ['音乐', '歌曲', '专辑', '演唱会'] },
  tech:   { name: '科技', emoji: '💻', keywords: ['AI', '科技', '芯片', '模型', 'GPT', 'Sora'] },
  animeip:{ name: '动漫IP', emoji: '🌟', keywords: ['IP', '漫画', '原作', '轻小说'] },
};

/** 本地排行榜持久化文件 */
function rankingFile() {
  return path.join(store.dirs.root, 'plan-rankings.json');
}

async function loadRankings() {
  try {
    const raw = await fsp.readFile(rankingFile(), 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

async function saveRankings(obj) {
  await fsp.mkdir(path.dirname(rankingFile()), { recursive: true });
  await fsp.writeFile(rankingFile(), JSON.stringify(obj, null, 2), 'utf8');
}

/** 从各平台拉全量热榜，按类别聚合，返回排名（按热度降序） */
async function buildCategoryRanking(category) {
  const cfg = CATEGORIES[category];
  if (!cfg) return [];
  const all = [];
  await Promise.all(Object.keys(PLATFORMS).map(async (p) => {
    try {
      const items = await fetchPlatformTrending(p);
      for (const it of items) {
        const text = (it.title || '') + ' ' + (it.category || '');
        const matched = cfg.keywords.some((k) => text.includes(k));
        if (matched) {
          all.push({
            ...it,
            _platform: p,
            _platformName: PLATFORMS[p].name,
          });
        }
      }
    } catch (e) { /* skip */ }
  }));
  // 按热度数字排序
  all.sort((a, b) => {
    const ha = Number(a.heat) || 0;
    const hb = Number(b.heat) || 0;
    return hb - ha;
  });
  // 去重（标题相似）
  const seen = new Set();
  const out = [];
  for (const it of all) {
    const key = (it.title || '').slice(0, 12);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
    if (out.length >= 50) break;
  }
  return out.map((it, i) => ({ ...it, rank: i + 1 }));
}

/** GET /plan/ranking?category=xxx&refresh=1 */
router.get('/plan/ranking', wrap(async (req, res) => {
  const category = String(req.query.category || 'anime').toLowerCase();
  assert(CATEGORIES[category], 400, '未知类别',
    `支持: ${Object.keys(CATEGORIES).join(', ')}`);

  const refresh = String(req.query.refresh || '0') === '1';
  const all = await loadRankings();
  const cached = all[category];

  let items = [];
  let builtAt = null;

  if (!refresh && cached && cached.items && Array.isArray(cached.items) && cached.items.length > 0) {
    items = cached.items;
    builtAt = cached.builtAt;
    // 如果缓存超过 6 小时，后台静默刷新
    if (Date.now() - new Date(builtAt).getTime() > 6 * 60 * 60 * 1000) {
      buildCategoryRanking(category).then((fresh) => {
        all[category] = { items: fresh, builtAt: new Date().toISOString() };
        saveRankings(all).catch(() => {});
      }).catch(() => {});
    }
  } else {
    items = await buildCategoryRanking(category);
    builtAt = new Date().toISOString();
    all[category] = { items, builtAt };
    await saveRankings(all);
  }

  res.json({
    category,
    categoryName: CATEGORIES[category].name,
    categoryEmoji: CATEGORIES[category].emoji,
    builtAt,
    items,
  });
}));

/** GET /plan/ranking/categories —— 返回所有类别列表 */
router.get('/plan/ranking/categories', wrap(async (req, res) => {
  res.json({
    categories: Object.entries(CATEGORIES).map(([key, v]) => ({
      key, name: v.name, emoji: v.emoji,
    })),
  });
}));

/* =============================================================
 * 搜索 —— 热榜 + 企划书 关联
 * ============================================================= */

/** GET /plan/search?q=xxx&category=&platform= */
router.get('/plan/search', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const category = String(req.query.category || '').toLowerCase();
  const platform = String(req.query.platform || '').toLowerCase();
  assert(q.length >= 1, 400, '搜索词太短', '至少输入 1 个字符');

  // 1. 热榜匹配
  const trendingMatches = [];
  const plats = platform ? [platform] : Object.keys(PLATFORMS);
  await Promise.all(plats.map(async (p) => {
    if (!PLATFORMS[p]) return;
    try {
      const items = await fetchPlatformTrending(p);
      for (const it of items) {
        const hay = (it.title || '') + ' ' + (it.category || '');
        if (hay.includes(q)) {
          trendingMatches.push({
            type: 'trending',
            platform: p,
            platformName: PLATFORMS[p].name,
            ...it,
          });
        }
      }
    } catch (e) { /* skip */ }
  }));

  // 2. 类别过滤（如果指定了 category）
  if (category && CATEGORIES[category]) {
    const kw = CATEGORIES[category].keywords;
    const withCat = trendingMatches.filter((it) => {
      const hay = (it.title || '') + ' ' + (it.category || '');
      return kw.some((k) => hay.includes(k));
    });
    if (withCat.length > 0) {
      // 优先类别命中
      trendingMatches.splice(0, trendingMatches.length, ...withCat);
    }
  }

  trendingMatches.sort((a, b) => (Number(b.heat) || 0) - (Number(a.heat) || 0));

  res.json({
    q,
    category: category || null,
    platform: platform || null,
    trending: trendingMatches.slice(0, 50),
  });
}));

/* =============================================================
 * 企划书 CRUD —— 日式动漫企划书模板
 * ============================================================= */

/** 企划书数据模型
 *  {
 *    id, ownerId, title, category,
 *    concept: { // 企划核心
 *      titleJp, titleEn, logline, tagline, genre, targetAge,
 *      runtime, episodes, broadcastPeriod, budget
 *    },
 *    worldview: { // 世界观
 *      setting, era, location, worldview, powerSystem, themes
 *    },
 *    characters: [ // 角色
 *      { nameJp, nameCn, age, gender, role, personality, appearance, seiyuu, catchphrase }
 *    ],
 *    sellingPoints: [ // 卖点
 *      { point, description, targetAudience }
 *    ],
 *    promotion: { // 运营计划
 *      teaser, pv, socialMedia, events, collaborations, merch
 *    },
 *    schedule: [ // 排期
 *      { phase, startDate, endDate, deliverable, owner }
 *    ],
 *    createdAt, updatedAt, status, tags
 *  }
 */
const PROPOSAL_CAP = 200;

function proposalsFile() {
  return path.join(store.dirs.root, 'plan-proposals.json');
}
async function loadProposals() {
  try {
    const raw = await fsp.readFile(proposalsFile(), 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}
async function saveProposals(list) {
  await fsp.mkdir(path.dirname(proposalsFile()), { recursive: true });
  await fsp.writeFile(proposalsFile(), JSON.stringify(list, null, 2), 'utf8');
}

function emptyProposal() {
  return {
    concept: {
      titleJp: '', titleEn: '', logline: '', tagline: '',
      genre: '奇幻', targetAge: '全年龄',
      runtime: '24分钟/集', episodes: 12, broadcastPeriod: '2026年1月～3月',
      budget: '2000万日元',
    },
    worldview: {
      setting: '', era: '', location: '', worldview: '', powerSystem: '', themes: '',
    },
    characters: [],
    sellingPoints: [],
    promotion: {
      teaser: '', pv: '', socialMedia: '', events: '', collaborations: '', merch: '',
    },
    schedule: [],
  };
}

/** POST /plan/proposal */
router.post('/plan/proposal', wrap(async (req, res) => {
  const body = req.body || {};
  const proposals = await loadProposals();
  const prop = Object.assign(emptyProposal(), body.proposal || {});
  const now = new Date().toISOString();
  const item = {
    id: crypto.randomUUID(),
    ownerId: body.ownerId || null,
    title: String(body.title || prop.concept.titleJp || prop.concept.titleEn || '未命名企划'),
    category: String(body.category || 'anime'),
    tags: Array.isArray(body.tags) ? body.tags : [],
    status: String(body.status || 'draft'),
    ...prop,
    createdAt: now,
    updatedAt: now,
  };
  proposals.unshift(item);
  if (proposals.length > PROPOSAL_CAP) proposals.length = PROPOSAL_CAP;
  await saveProposals(proposals);
  res.json({ proposal: item });
}));

/** GET /plan/proposal */
router.get('/plan/proposal', wrap(async (req, res) => {
  const proposals = await loadProposals();
  // 精简列表，不返回大块字段
  const list = proposals.map((p) => ({
    id: p.id, title: p.title, category: p.category,
    status: p.status, createdAt: p.createdAt, updatedAt: p.updatedAt,
    ownerId: p.ownerId, tags: p.tags,
    episodes: p.concept && p.concept.episodes,
    logline: p.concept && p.concept.logline,
  }));
  res.json({ items: list });
}));

/** GET /plan/proposal/:id */
router.get('/plan/proposal/:id', wrap(async (req, res) => {
  const proposals = await loadProposals();
  const found = proposals.find((p) => p.id === req.params.id);
  assert(found, 404, '企划书不存在', 'ID: ' + req.params.id);
  res.json({ proposal: found });
}));

/** PATCH /plan/proposal/:id */
router.patch('/plan/proposal/:id', wrap(async (req, res) => {
  const proposals = await loadProposals();
  const idx = proposals.findIndex((p) => p.id === req.params.id);
  assert(idx >= 0, 404, '企划书不存在', 'ID: ' + req.params.id);
  const body = req.body || {};
  const merged = Object.assign({}, proposals[idx], body.proposal || {});
  merged.id = proposals[idx].id;
  merged.createdAt = proposals[idx].createdAt;
  merged.updatedAt = new Date().toISOString();
  if (body.title) merged.title = String(body.title);
  if (body.category) merged.category = String(body.category);
  if (body.status) merged.status = String(body.status);
  if (Array.isArray(body.tags)) merged.tags = body.tags;
  // 深合并嵌套结构
  merged.concept = Object.assign({}, proposals[idx].concept, body.proposal && body.proposal.concept || {});
  merged.worldview = Object.assign({}, proposals[idx].worldview, body.proposal && body.proposal.worldview || {});
  merged.promotion = Object.assign({}, proposals[idx].promotion, body.proposal && body.proposal.promotion || {});
  if (Array.isArray(body.proposal && body.proposal.characters)) merged.characters = body.proposal.characters;
  if (Array.isArray(body.proposal && body.proposal.sellingPoints)) merged.sellingPoints = body.proposal.sellingPoints;
  if (Array.isArray(body.proposal && body.proposal.schedule)) merged.schedule = body.proposal.schedule;
  proposals[idx] = merged;
  await saveProposals(proposals);
  res.json({ proposal: merged });
}));

/** DELETE /plan/proposal/:id */
router.delete('/plan/proposal/:id', wrap(async (req, res) => {
  const proposals = await loadProposals();
  const idx = proposals.findIndex((p) => p.id === req.params.id);
  assert(idx >= 0, 404, '企划书不存在', 'ID: ' + req.params.id);
  proposals.splice(idx, 1);
  await saveProposals(proposals);
  res.json({ ok: true });
}));

module.exports = router;
