---
name: "anidream-new-module"
description: "绘梦AI动漫创作平台新增侧边栏模块标准接入流程（含后端路由、前端 rail/view/IIFE/CSS、构建推送）。Invoke when user asks to add a new sidebar module/功能模块 to this workspace."
---

# 绘梦AI新增侧边栏模块 — 标准化接入流程

> 适用项目：`/workspace/anidream`（单 HTML + Express 后端 + GitHub Pages 部署）
> 适用场景：用户在侧边栏要求新增功能模块（如企划/剧本/美术设定/角色设定/原画/动画/...）

---

## 一、架构速查

```
前端 (deploy/index.html 部署到 GitHub Pages)
  index.html         ← rail 按钮 + view-xxx 页面 DOM
  app.js             ← VIEW_IDS 数组（新增 view 必须加入，否则 switchView 静默 return）
  ui.js              ← 各模块 IIFE（HMPlan / HMScript / HMArt / HMOUA / HMAnimation）
  api.js             ← 前端 API 封装（api.xxx()）
  styles.css         ← 模块专属 CSS

后端 (Render)
  server/src/index.js            ← 注册路由
  server/src/routes/xxx.js       ← 模块路由
  server/src/http.js             ← writeJson / enqueue / uid / dataUrlToBuffer / extFromMime / uploadDir
  server/src/store.js            ← 项目/资产 CRUD（assets 模块用）
  data/xxx.json                  ← 持久化文件（Render 免费层无 DATABASE_URL）
```

构建：`npm run build` → 内联前端 JS 进 `deploy/index.html`（必须推 `deploy/`）

---

## 二、接入 Checklist（必走 7 步）

### Step 1：后端路由 `server/src/routes/<module>.js`

模板（仿 `oua.js` / `animation.js`）：

```js
const { Router } = require('express');
const path = require('path');
const { readJson, writeJson, enqueue, uid, httpError } = require('../http');

const router = Router();
const FILE = () => path.join(__dirname, '..', '..', 'data', '<module>.json');

let cache = null;
async function load() {
  if (cache) return cache;
  try { cache = await readJson(FILE()); }
  catch (e) { cache = []; await writeJson(FILE(), cache); }
  if (!Array.isArray(cache)) cache = [];
  return cache;
}
async function save() {
  await enqueue(() => writeJson(FILE(), cache || []));
}

function deepMergeItem(base, patch) {
  return Object.assign({}, base, patch, {
    // 数组字段：patch 有就用 patch，没有就保留 base（防 PATCH 部分更新丢数组）
    items: Array.isArray(patch.items) ? patch.items : (base.items || []),
    updatedAt: Date.now(),
  });
}

// CRUD
router.get('/', ...);        // 支持 ?keyword= & ?status= 筛选
router.get('/dict', ...);    // 字典（状态/枚举）
router.get('/:id', ...);
router.post('/', ...);       // deepMergeItem(defaultItem(), req.body)
router.patch('/:id', ...);   // deepMergeItem(原, req.body)
router.delete('/:id', ...);
router.post('/:id/duplicate', ...);
router.post('/bulk', ...);   // items[], 单次最多 500, ARTS_CAP=1000
router.post('/upload', ...); // 复用 http.js dataUrlToBuffer, 存 uploads/assets/<module>-*.ext
router.get('/export/:id', ...); // CSV 带 \ufeff BOM (Excel 中文不乱码)

module.exports = router;
```

**持久化关键点**（上次踩坑）：
- 用 `writeJson()` 原子写入（先写 `.tmp` 再 rename，防崩溃半截损坏）
- 用 `enqueue()` 串行队列（防并发覆盖）
- PATCH 用 `deepMergeItem`（浅 merge 会丢数组）

### Step 2：`server/src/index.js` 注册

```js
const xxxRoutes = require('./routes/xxx');
// ...
app.use('/api', xxxRoutes);
```

### Step 3：`frontend/index.html` 侧边栏 rail 按钮

找到已有 rail 按钮（`data-rail="..."`），在对应位置插入：

```html
<button class="hm-rail-item" data-rail="xxx" title="模块说明">
  <svg viewBox="0 0 24 24" aria-hidden="true">...</svg>
  <span>模块名</span>
</button>
```

### Step 4：`frontend/index.html` 新增 `<main id="view-xxx" hidden>` 页面

插在对应 view 之后（用 `</main>\n\n  <main class="hm-page hm-xxx-page" id="view-xxx" hidden>` 模式）。

页面结构约定：
```
.hm-xxx-top  (标题 + 工具条 ＋新建 / 📥导入 / 📤导出)
筛选条
列表视图 view-list（卡片网格）
编辑器视图 view-editor（hidden）
```

### Step 5：`frontend/app.js` 加 VIEW_IDS

```js
// 第 1833 行附近
var VIEW_IDS = [..., 'oua', 'animation', 'xxx', 'history', 'admin'];
//                                                ↑ 新增
```

### Step 6：`frontend/api.js` 加 API 方法

```js
api.listXxx = function(q){ return request('/xxx'+(q||''), null, 20000); };
api.getXxx = function(id){ return request('/xxx/'+encodeURIComponent(id), null, 20000); };
api.createXxx = function(p){ return request('/xxx',{method:'POST',body:p},20000); };
api.updateXxx = function(id,p){ return request('/xxx/'+encodeURIComponent(id),{method:'PATCH',body:p},20000); };
api.deleteXxx = function(id){ return request('/xxx/'+encodeURIComponent(id),{method:'DELETE',body:null},15000); };
api.bulkXxx = function(items){ return request('/xxx/bulk',{method:'POST',body:{items}},30000); };
api.uploadXxxMedia = function(d){ return request('/xxx/upload',{method:'POST',body:{dataUrl:d}},60000); };
api.exportXxx = function(id,fmt){ return '/api/xxx/export/'+encodeURIComponent(id)+'?format='+(fmt||'csv'); };
api.dictXxx = function(){ return request('/xxx/dict', null, 10000); };
```

### Step 7：`frontend/ui.js` 加 IIFE 模块 + switchView 入口

**入口**（HMOUA / HMArt / HMScript 旁边）：

```js
if (view === 'xxx' && window.HMXxx) {
  try { window.HMXxx.enter(); } catch (e) { console.error('[Xxx] enter failed', e); }
}
```

**IIFE 结构**（仿 HMAnimation / HMOUA，推荐最小模板）：

```js
(function () {
  var state = { list: [], editing: null, saveTimer: null };
  var ST_LABELS = { todo: '未开始', wip: '进行中', review: '审图中', final: '定稿' };
  function $(id) { return document.getElementById(id); }

  function enter() { bindTop(); bindFilters(); loadList(); }

  function bindTop() {
    // 用 !btn.__bound 防重复绑定
    var btn = $('xxxNewBtn');
    if (btn && !btn.__bound) { btn.__bound = true; btn.addEventListener('click', createNew); }
  }

  function loadList() {
    api.listXxx('?...').then(function (res) { state.list = res.items || []; renderGrid(); });
  }

  function renderGrid() { /* 卡片 */ }
  function openEditor(id) {
    $('xxxListView').hidden = true; $('xxxEditorView').hidden = false;
    api.getXxx(id).then(function (res) { state.editing = res.xxx; populate(); });
  }
  function populate() { /* 填值 + bindAutoSave + render 子列表 */ }
  function scheduleSave() { clearTimeout(state.saveTimer); state.saveTimer = setTimeout(save, 1200); }
  function save() { api.updateXxx(state.editing.id, state.editing); }

  window.HMXxx = { enter: enter };
})();
```

**图片上传**（复用 art.js 的 `/api/art/upload` 或模块自己的 `/api/xxx/upload`）：

```js
function uploadItem(idx) {
  var input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
  input.onchange = function () {
    var f = input.files[0]; if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      api.uploadXxxMedia(reader.result).then(function (res) {
        state.editing.items[idx].url = res.url; renderXxx(); save();
      });
    };
    reader.readAsDataURL(f);
  };
  input.click();
}
```

**批量导入向导**（复用 `.hm-import-overlay` CSS，见 HMOUA / HMArt）：

```js
function openImportWizard() {
  // 3 步向导：① 准备数据（JSON/CSV/模板） ② 解析预览 ③ 确认导入
  // 最终 POST /api/xxx/bulk 后 loadList() 刷新
}
```

### Step 8：`frontend/styles.css` 追加模块专属 CSS

用模块前缀类名（`.hm-xxx-`）避免冲突。

---

## 三、三个必改开关（踩坑教训，漏一个就静默失败）

| 开关 | 文件 | 说明 |
|------|------|------|
| `VIEW_IDS` | `frontend/app.js` L1833 | 没加 → `switchView` 直接 return，点击无反应 |
| `DISABLED_RAILS` | `frontend/ui.js` L157 | 没清 → 点击弹「功能开发中」toast |
| `switchView` 入口 | `frontend/ui.js` 中 | 没加 → 页面不调 `HMXxx.enter()` |

---

## 四、构建 + 推送 + 验证

```bash
cd /workspace/anidream

# 1. 语法检查（必须全过）
node --check server/src/routes/xxx.js
node --check frontend/ui.js
node --check frontend/api.js
node --check frontend/app.js

# 2. 构建（生成 deploy/index.html）
npm run build

# 3. commit
git add -A
git commit -m "feat: 侧边栏新增【xxx】模块..."

# 4. push 到 GitHub Pages
git push https://liqi279:ghp_TOKEN@github.com/liqi279/huimeng-ai.git main

# 5. 验证线上（GitHub Pages 约 50-60s 生效）
sleep 55
curl -s --compressed --max-time 15 "https://liqi279.github.io/huimeng-ai/?cb=$(date +%s)" | grep -c "HMXxx\|view-xxx"
```

---

## 五、持久化文件清单（按模块）

```
data/plan-proposals.json     企划书草稿
data/plan-rankings.json      企划热榜聚合
data/scripts.json            剧本（场次/镜头/对白/角色/版本）
data/artboards.json          美术设定条目
data/art-checklist.json      美术会审检查表
data/oua.json                原画镜头（K帧/中割）
data/animations.json         动画序列（K帧/中割帧/节奏曲线）
```

---

## 六、常见坑

1. **`Object.assign` 浅合并丢数组**：PATCH 时必须用 `deepMergeItem`，数组字段显式判断 `Array.isArray(patch.xxx) ? patch.xxx : base.xxx`
2. **Render 免费层无持久磁盘**：重启丢全部 `data/*.json`，已在 `index.js` 打告警 log
3. **assets POST 413**：后端 `MAX_ASSET_BYTES` 已是 50MB，前端 `handleFiles` 同步
4. **HF 直连被墙**：用 `https://hf-mirror.com/...`
5. **CSV 中文乱码**：`res.send('\ufeff' + csv)`（UTF-8 BOM）
6. **图片 URL 跨域**：`api.mediaUrl(url)` 已处理代理前缀
7. **批量导入上限**：单次 500 条，`ARTS_CAP=1000`

---

## 七、模块清单（已实现）

| 模块 | view id | 主要功能 |
|------|---------|---------|
| 企划 | plan | 热榜 / 排行榜 / 搜索 / 日式企划书 |
| 剧本 | script | 场次 / 镜头 / 对白 / 角色 / 版本快照 |
| 美术设定 | art | 6 大分类 20+ 子节 · 角色设定 · 会审检查表 |
| 原画 | oua | 第一原画 K帧 / 第二原画中割 |
| 动画 | animation | 中间帧处理 · Tweening · 节奏曲线 |
