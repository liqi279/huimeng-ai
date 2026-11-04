# 初音未来 · 胶片音乐播放器

一个**单文件离线可用**的可悬浮网页音乐播放器，以黑胶胶片为播放器形象，内置初音未来（Hatsune Miku）Live2D 虚拟形象：播放时她随音乐**唱跳编排好的成套舞蹈**，口型实时贴合歌声。

双击 `index.html` 即可运行，无需服务器、无需联网、无需安装任何东西。

---

## 功能总览

| 模块 | 说明 |
|---|---|
| 播放器 | 透明黑胶胶片造型，左键播放/暂停，可拖拽悬浮到页面任意位置 |
| 唱针 | 播放时唱针落到旋转的胶片上，暂停时挪开 |
| 音谱 | 胶片中心小圆内蓝色发光音谱，随音调起伏；数量/间隔/起伏阈值可在右键菜单里用滑轮调节 |
| 粒子 | 播放时白色发光粒子从胶片圆周范围上升渐隐，参数可调 |
| 搜索 | 右键菜单搜索框：多数据源并行搜索（优先网易云），输入即时相似提示，点击即播 |
| 曲库 | 自动接入网络流行歌曲（优先最新飙升榜/热歌榜） |
| 虚拟形象 | 初音未来 Live2D 模型，**真实 Cubism 2 引擎**渲染 |
| 口型 | 演唱时嘴型开合实时贴合音量（`PARAM_MOUTH_OPEN_Y`） |
| 唱跳 | 播放时按顺序表演 **6 段成套编排舞蹈**（详见下文），右键菜单可开关 |
| 备选形象 | 右键菜单可切换：胶片 / 初音未来 / Spine 骨骼动画 / AE 序列帧 / 内置歌手 |

## 成套编舞说明

舞蹈由关键帧逐帧编排（`.mtn` 文本格式，30fps，112 BPM，每段 8 拍约 4.3 秒），**严格按 01→06 顺序播放后循环**：

| 段 | 文件 | 舞步 | 编排内容 |
|---|---|---|---|
| 01 | `dance_01.mtn` | 起手亮相 | 鞠躬（闭眼）→ 抬头右臂高举定格，笑眼 + 红晕 |
| 02 | `dance_02.mtn` | 左右律动 | 重心左右移，双臂反相随摆，眼神流动 |
| 03 | `dance_03.mtn` | 双臂大摆 | 左右臂交替高举过头，头与身体反相 |
| 04 | `dance_04.mtn` | 转体扭腰 | 身体三轴连续旋转，头滞后反相成波浪 |
| 05 | `dance_05.mtn` | 应援挥手 | 左臂挥 4 拍、右臂接 4 拍（粉丝应援），全程笑眼 |
| 06 | `dance_06.mtn` | 收势定格 | 幅度逐层收敛，微笑定姿收尾 |

编舞驱动 20+ 条参数曲线：头/身体三轴（`ANGLE_X/Y/Z`、`BODY_ANGLE_X/Y/Z`）、双臂（`ARM_L/R`）、眼球视线、笑眼、眉毛、脸颊红晕（`CHEEK`）、呼吸（`BREATH`）。

修改 / 新增舞步：编辑 `tools/gen-dance.py`（关键帧数据在文件内），运行后把生成的 `mtn/` 文件拷入 `miku/mtn/`，并在 `miku/miku.model.json` 的 `motions.dance` 数组中登记。

## 目录结构

```
miku-vinyl-player/
├── index.html          主程序（约 1.4 MB，单文件即可运行）
├── README.md           本说明
├── lib/                渲染引擎脚本（index.html 启动时优先加载本地，缺失则回退 CDN）
│   ├── pixi.min.js             pixi.js 6.5.10（渲染层，WebGL）
│   ├── pixi-legacy.min.js      pixi.js-legacy 6.5.10（无 WebGL 时的 Canvas2D 渲染器）
│   ├── live2d.min.js           Cubism 2 Core 运行时（挂 window.Live2D）
│   ├── live2dcubismcore.min.js Cubism 4 Core（主库启动时的硬性依赖）
│   ├── cubism2.min.js          pixi-live2d-display 的 Cubism2 适配插件
│   └── index.min.js            pixi-live2d-display 0.4.0 主库（挂 PIXI.live2d）
├── miku/               初音未来 Live2D 模型（Cubism 2）
│   ├── miku.model.json          模型定义（动作组：idle 待机 / null 演唱 / dance 成套舞蹈）
│   ├── miku.physics.json        物理模拟（头发、身体摆动的惯性）
│   ├── moc/miku.moc             模型骨架与网格（192 KB）
│   ├── moc/miku.2048/texture_00.png   贴图（2048×2048）
│   └── mtn/                     动作文件
│       ├── miku_idle_01.mtn      待机呼吸
│       ├── miku_sing_01~06.mtn  演唱小动作
│       ├── miku_shake_01.mtn     摆动
│       └── dance_01~06.mtn      成套编排舞蹈（本项目自制）
└── tools/
    └── gen-dance.py     舞步编排生成器（关键帧 → 余弦缓动插值 → .mtn）
```

## 技术架构

```
音乐搜索（多源并行，netease 优先）
        │
        ▼
  <audio> ── Web Audio AnalyserNode ──► 音量能量
        │                                   │
        ▼                                   ├──► 胶片音谱 / 粒子 / 旋转
  播放状态 ──► setState('sing'|'idle')       │
        │                                   ▼
        ▼                            口型驱动（PARAM_MOUTH_OPEN_Y）
  pixi.js 6.5.10（WebGL，无 GPU 回退 Canvas2D）
        │
        ▼
  pixi-live2d-display 0.4.0
        │  加载顺序（顺序不可调换，实测踩坑）：
        │  pixi → Cubism2 Core → Cubism4 Core → cubism2 插件 → 主库
        ▼
  初音未来 Cubism 2 模型（miku.moc + 贴图 + mtn + physics）
```

关键实现决策（均有实测依据）：

1. **模型资源内嵌**：`miku/` 全部 18 个文件以 base64 内嵌进 `index.html`。因为 Chrome 以 `file://` 打开本地页面时禁止 XHR/fetch 读取同目录文件（即"Network error."），内嵌后双击即可离线运行。`miku/` 目录仅作为开发期的源文件保留。
2. **双重资源拦截**：XHR 层把 `miku/` 路径改写为 `data:` URL；贴图另走 `PIXI.Texture.fromURL` → `Image` 元素（不经过 XHR），因此对 `Texture.fromURL/from` 再拦一层。
3. **`autoUpdate: false` + 手动驱动**：每帧先 `model.update(dt)` 再 `app.render()`，顺序不能反——否则 SDK 报 `update() before draw()` 且画面全空。
4. **脚本本地优先**：`lib/` 命中则不请求 CDN；本地缺失自动回退 jsDelivr（应对被墙场景）。
5. **WebGL 探测不缓存失败**：`file://` 页面前期 GPU 进程未就绪时首次探测常为 false，只缓存成功结果，避免被永久判死。
6. **口型写在动作之后**：`setParamFloat('PARAM_MOUTH_OPEN_Y', …)` 在 `model.update()` 后执行，实时覆盖舞步的嘴部关键帧，保证对嘴型。

## 使用方法

1. **最简方式（推荐）**：只拿走 `index.html` 一个文件，双击打开即可——模型和舞步已全部内嵌。
2. **完整工程**：整个 `miku-vinyl-player/` 文件夹一起拷贝（`index.html` 与 `lib/`、`miku/` 同目录）。
3. 嵌入已有网页：把 `index.html` 内容作为一个 `<div>` 挂载到你的页面即可（全部逻辑在单个自执行闭包内）。

交互：

- **左键胶片/形象**：播放 / 暂停
- **右键**：弹出菜单（点击菜单和形象以外的区域才关闭）——搜索、音谱样式调节、整体形象切换、唱跳模式开关、大小调节
- **拖拽**：悬浮窗可移动到任意位置，菜单跟随
- **滚轮/滑轮**：菜单内调节音谱数量、间隔、起伏阈值、粒子参数、胶片大小

## 常见问题

| 现象 | 原因与解决 |
|---|---|
| 提示「需要 WebGL」 | 浏览器未开硬件加速：`chrome://settings` → 搜索「硬件加速」→ 开启 → 重启浏览器；提示框内可点「重试」 |
| 形象加载失败 | 先点提示框里的「点此重试加载形象」；仍失败会自动降级为内置歌手，不影响播放 |
| 搜索无结果 | 5 秒超时提示属正常（各数据源都无该曲目）；网络环境差时可重试 |
| 歌曲无法播放 | 部分音源对某些地区限制，换一首即可 |

## 环境与兼容

- 现代桌面浏览器（Chrome / Edge / Firefox / Safari 最新版）；推荐 Chrome
- 有 WebGL：完整 Live2D 渲染；无 WebGL：自动降级 Canvas2D，仍可显示
- 无网络：初音形象、舞蹈、胶片动效全部可用；仅搜索与网络曲库不可用
- 无任何构建步骤、零 npm 依赖

## 嵌入接口（用于任意网页/应用）

本项目提供 `dist/miku-player.js`，可嵌入到任何网页中，所有功能（播放、搜索、音谱、形象、唱跳）完整可用。

### 最简用法

```html
<!-- 线上地址（GitHub Pages，任意页面可直接引用） -->
<script src="https://liqi279.github.io/huimeng-ai/miku-player.js"></script>
<!-- 或本地路径 -->
<!-- <script src="dist/miku-player.js"></script> -->
<script>
  MikuPlayer.init();   // 默认挂到 body，右下角悬浮
</script>
```

### 挂到指定容器

```html
<div id="player-host"></div>
<script src="dist/miku-player.js"></script>
<script>
  var player = MikuPlayer.init('#player-host', {
    autoPlay: false,         // 是否自动播放（受浏览器自动播放策略限制）
    avatar: 'live2d',        // 默认形象：disc | live2d | spine | ae | builtin
    position: 'right:20px;bottom:100px'  // 自定义位置（覆盖默认）
  });
</script>
```

### 自动挂载

给容器加 `data-miku-player` 属性，脚本加载后会自动初始化：

```html
<div data-miku-player></div>
<script src="dist/miku-player.js"></script>
```

### 控制 API

`MikuPlayer.init()` 返回一个控制对象：

| 方法 | 说明 |
|---|---|
| `player.play()` | 播放 |
| `player.pause()` | 暂停 |
| `player.toggle()` | 播放/暂停切换 |
| `player.destroy()` | 从页面移除播放器 |
| `player.el` | 播放器容器 DOM 元素 |
| `player.audio` | 底层 `<audio>` 元素 |

### 从源码重新构建

修改 `index.html` 或 `miku/` 模型后，运行：

```bash
node tools/build-embed.js
```

产物更新到 `dist/miku-player.js`（含 CSS、HTML、模型资源、主程序，自包含约 1.4 MB）。

## 版权说明

- Live2D 引擎脚本与初音模型（`live2d-widget-model-miku`）仅供学习研究，请勿商用
- 音乐来自第三方公开接口，版权归原作者及平台所有
