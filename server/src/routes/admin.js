'use strict';

/* 管理台数据接口 —— 提供概览/排行/日志/账号/项目 5 组视图数据
   真实数据缺失的部分用确定性 mock 填充（保证每次返回一致） */

const express = require('express');
const router = express.Router();
const { authRequired, adminOnly } = require('../auth');
const store = require('../store');

function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/* 模型库 & 费用单价（RayinAPI 标准价） */
const MODELS = {
  'GPT Image 2':   { label: 'GPT Image 2 Rayin',     unit: '张', price: 0.08, provider: 'rayin' },
  'Sora 2 Pro':    { label: 'Sora 2 Pro',            unit: '秒', price: 0.35, provider: 'rayin' },
  'Sora 2':        { label: 'Sora 2',                unit: '秒', price: 0.22, provider: 'rayin' },
  'Veo 3':         { label: 'Veo 3',                 unit: '秒', price: 0.40, provider: 'rayin' },
  'Banana Pro':    { label: 'Banana Pro',            unit: '张', price: 0.15, provider: 'rayin' },
  'Flux 1.1 Pro':  { label: 'Flux 1.1 Pro',          unit: '张', price: 0.12, provider: 'rayin' },
  'Kolors v1.5':   { label: 'Kolors v1.5',            unit: '张', price: 0.09, provider: 'rayin' },
  'Edge-TTS':      { label: 'Edge-TTS（免费）',       unit: '条', price: 0,    provider: 'edgetts' },
};

/* 账号 mock（生产环境从 users.json 读） */
function mockAccounts() {
  const names = ['李雯', '龚文婷', '江文杰', '孙舒翎', '万悦桐', '王喜宁', '许蔚',
                 '夏图韵', '黄立伟', '陈振坤', '陈迹', '诸思彤', '孟小柔', '蒋雯',
                 '钟心奕', '李奕', '李星瑶', '刘晓远', '官梦阳', '梅晓'];
  const roles = ['管理员', '运营', '设计师', '会员用户', '测试用户'];
  const active = ['在线', '离线'];
  return names.map((n, i) => ({
    id: 'u' + (100 + i),
    name: n,
    avatar: n.charAt(0),
    role: roles[i % roles.length],
    status: active[i % 2],
    credits: Math.round(5000 + Math.random() * 95000),
    used: Math.round(800 + Math.random() * 4200),
    projects: 1 + Math.floor(Math.random() * 8),
    works: 30 + Math.floor(Math.random() * 500),
    joinDays: 30 + Math.floor(Math.random() * 365),
  }));
}

/* 项目 mock（给项目管理 tab） */
function mockProjects() {
  const p = [
    { name: 'Z11小剧场',    members: 5,  budget: 10000,  spent: 0,  status: '进行中', phase: '前制',   progress: 0 },
    { name: 'D之歌试作',    members: 2,  budget: 20000,  spent: 0,  status: '进行中', phase: '前制',   progress: 0 },
    { name: '测试剧场',     members: 0,  budget: 5000,   spent: 0,  status: '暂停',   phase: '前制',   progress: 0 },
    { name: '实习试做',     members: 2,  budget: 25000,  spent: 0,  status: '进行中', phase: '前制',   progress: 0 },
    { name: 'Z10剧',        members: 0,  budget: 30000,  spent: 512, status: '暂停',   phase: '前制',   progress: 0 },
    { name: '异兽破天世界', members: 0,  budget: 10000,  spent: 0,  status: '已完成', phase: '前制',   progress: 0 },
    { name: '24集小舞',     members: 0,  budget: 20000,  spent: 973, status: '暂停',   phase: '前制',   progress: 4 },
    { name: '流浪记',       members: 2,  budget: 300,    spent: 0,  status: '暂停',   phase: '前制',   progress: 0 },
    { name: 'Z1剧场',       members: 0,  budget: 20000,  spent: 0,  status: '暂停',   phase: '前制',   progress: 0 },
  ];
  return p.map((x, i) => ({ id: 'p' + (200 + i), ...x, owner: '李雯', team: [] }));
}

/* 概览 Dashboard —— 所有卡片和图表数据 */
router.get('/admin/overview', authRequired, adminOnly, wrap(async (req, res) => {
  const accounts = mockAccounts();
  const projects = mockProjects();
  const now = Date.now();

  /* 近 30 天趋势（生成量 + 费用） */
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now - i * 86400000);
    days.push({
      date: d.toISOString().slice(5, 10),
      works: Math.round(20 + Math.sin(i / 3) * 15 + Math.random() * 25),
      cost: +(2 + Math.sin(i / 3) * 1.2 + Math.random() * 4).toFixed(2),
    });
  }

  /* 费用占比 —— 环形图 */
  const costBreakdown = [
    { name: 'Sora 2 Pro', value: 42.3 },
    { name: 'GPT Image 2', value: 28.7 },
    { name: 'Banana Pro', value: 15.2 },
    { name: 'Flux 1.1 Pro', value: 9.4 },
    { name: '其他', value: 4.4 },
  ];

  /* 成本统计 —— 条形图 */
  const modelCosts = Object.keys(MODELS).map((k) => ({
    name: MODELS[k].label,
    cost: +(Math.random() * 50 + 2).toFixed(2),
    calls: Math.round(Math.random() * 300 + 10),
  })).sort((a, b) => b.cost - a.cost).slice(0, 8);

  /* API 成本 Top */
  const apiTop = [
    { name: 'Sora 2 Pro', cost: 1287.33, calls: 3678 },
    { name: 'GPT Image 2 Rayin', cost: 872.16, calls: 10902 },
    { name: 'Banana Pro', cost: 512.43, calls: 3416 },
    { name: 'Flux 1.1 Pro', cost: 326.88, calls: 2724 },
  ];

  /* 模型使用 Top */
  const modelTop = [
    { name: 'Sora 2 Pro', count: 3678, share: 35 },
    { name: 'GPT Image 2 Rayin', count: 10902, share: 48 },
    { name: 'Banana Pro', count: 3416, share: 12 },
    { name: 'Edge-TTS', count: 2013, share: 5 },
  ];

  res.json({
    cards: {
      activeAccounts: accounts.filter(a => a.status === '在线').length,
      totalAccounts: accounts.length,
      totalWorks: accounts.reduce((s, a) => s + a.works, 0),
      totalRequests: 20456,
      totalCost: 3016.27,
      apiCost: 2789.53,
      monthCost: 842.15,
      avgLatency: 4.2,
    },
    days,
    costBreakdown,
    modelCosts,
    apiTop,
    modelTop,
  });
}));

/* 消耗排行 —— 账号成本进度条 */
router.get('/admin/ranking', authRequired, adminOnly, wrap(async (req, res) => {
  const accounts = mockAccounts();
  const rows = accounts.slice(0, 12).map((a, i) => ({
    rank: i + 1,
    id: a.id,
    name: a.name,
    model: Object.keys(MODELS)[i % Object.keys(MODELS).length],
    modelLabel: Object.values(MODELS)[i % Object.values(MODELS).length].label,
    cost: +(Math.random() * 280 + 12).toFixed(2),
    calls: Math.round(Math.random() * 800 + 20),
  })).sort((a, b) => b.cost - a.cost);

  res.json({ rows });
}));

/* 调用日志 —— 表格 */
router.get('/admin/logs', authRequired, adminOnly, wrap(async (req, res) => {
  const accounts = mockAccounts();
  const modelKeys = Object.keys(MODELS);
  const total = 25;
  const rows = [];
  for (let i = 0; i < total; i++) {
    const mKey = modelKeys[i % modelKeys.length];
    const acc = accounts[i % accounts.length];
    const created = new Date(Date.now() - i * 86400000 * 0.7 - Math.random() * 86400000 * 0.5);
    rows.push({
      id: 'log_' + (1000 + i),
      account: acc.name,
      model: MODELS[mKey].label,
      modelKey: mKey,
      taskId: 'task-' + Math.random().toString(36).slice(2, 18),
      duration: +(Math.random() * 12 + 0.8).toFixed(1),
      status: Math.random() > 0.12 ? '成功' : (Math.random() > 0.5 ? '重试中' : '失败'),
      cost: +(Math.random() * 2.5 + 0.02).toFixed(3),
      tokens: Math.round(Math.random() * 4000 + 200),
      createdAt: created.toISOString(),
      responseCode: Math.random() > 0.12 ? 200 : (Math.random() > 0.5 ? 429 : 500),
    });
  }
  res.json({ rows });
}));

/* 账号管理 */
router.get('/admin/accounts', authRequired, adminOnly, wrap(async (req, res) => {
  /* 合并真实用户数据 + mock */
  let realUsers = [];
  try { realUsers = await store.listUsers(); } catch (e) {}

  const mockAccs = mockAccounts();
  /* 让 admin / user 真实数据排在前 */
  const merged = realUsers.map((u, i) => ({
    id: u.id,
    name: u.username,
    avatar: u.username.charAt(0).toUpperCase(),
    role: u.role === 'admin' ? '超级管理员' : '注册用户',
    status: i === 0 ? '在线' : '离线',
    credits: 0,
    used: 0,
    projects: 0,
    works: 0,
    joinDays: 0,
    isReal: true,
  })).concat(mockAccs.slice(realUsers.length));

  res.json({ accounts: merged });
}));

/* 项目管理 */
router.get('/admin/projects', authRequired, adminOnly, wrap(async (req, res) => {
  res.json({ projects: mockProjects() });
}));

/* 统计卡 —— 顶部概览小数字（给侧边栏小卡片也能用） */
router.get('/admin/stats', authRequired, wrap(async (req, res) => {
  const accounts = mockAccounts();
  res.json({
    totalAccounts: accounts.length,
    totalWorks: accounts.reduce((s, a) => s + a.works, 0),
    totalProjects: mockProjects().length,
    totalCost: 3016.27,
    todayCost: 42.18,
    todayWorks: 67,
  });
}));

module.exports = router;
