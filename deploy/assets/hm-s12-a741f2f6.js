
/*!
 * Miku Vinyl Player — 可嵌入版
 * 用法：MikuPlayer.init(container, { autoPlay, avatar, position });
 * container 可以是 CSS 选择器字符串或 DOM 元素；不传则挂到 body。
 */
(function (global) {
  'use strict';

  var CSS = ".miku-player-host, .miku-player-host *, #vinyl-widget, #vinyl-widget * { margin:0; padding:0; box-sizing:border-box; }\n\n  /* ============ 悬浮胶片（透明、小巧） ============ */\n  #vinyl-widget {\n    position: fixed; right: 36px; bottom: 130px;\n    width: 132px; height: 132px;\n    z-index: 99999;\n    cursor: grab;\n    user-select: none; -webkit-user-select: none;\n    background: transparent;\n    touch-action: none;\n    overflow: visible;\n  }\n  #vinyl-widget.dragging { cursor: grabbing; }\n\n  /* 音频频谱画布：粒子 + 波浪（位于胶片后方，向外延伸） */\n  #fx-canvas {\n    position:absolute;\n    left:50%; top:50%;\n    width:260px; height:260px;\n    transform: translate(-50%,-50%);\n    pointer-events:none;\n    z-index:0;\n  }\n\n  /* 胶片本体 */\n  .vinyl {\n    position:absolute; inset:0; border-radius:50%;\n    z-index:2;\n    background:\n      radial-gradient(circle at 34% 30%, rgba(255,255,255,.14) 0%, transparent 42%),\n      repeating-radial-gradient(circle at 50% 50%, #1b1b22 0px, #1b1b22 1.5px, #2a2a33 2.5px, #141419 4px);\n    box-shadow:\n      0 10px 24px rgba(0,0,0,.55),\n      inset 0 0 0 1px rgba(255,255,255,.06),\n      inset 0 0 14px rgba(0,0,0,.7);\n    transition: transform .18s;\n  }\n  #vinyl-widget:hover .vinyl { transform: scale(1.04); }\n  /* 音频震动：播放时胶片随音量轻微缩放抖动 */\n  .vinyl.vibrate { animation: vib .28s ease-in-out infinite alternate; }\n  @keyframes vib {\n    from { transform: scale(calc(1 + var(--vb, 0) * 1)) translateY(calc(var(--vb, 0) * -1.5px)); }\n    to   { transform: scale(calc(1 + var(--vb, 0) * .4)) translateY(calc(var(--vb, 0) * 1px)); }\n  }\n\n  .vinyl .gloss {\n    position:absolute; inset:0; border-radius:50%;\n    background: conic-gradient(from 210deg, transparent 0deg, rgba(255,255,255,.10) 26deg, transparent 56deg, transparent 180deg, rgba(255,255,255,.06) 216deg, transparent 252deg);\n  }\n\n  /* 旋转层：中心标签 + 可见的旋转标记 */\n  .disc-spin { position:absolute; inset:0; border-radius:50%; transform-origin:50% 50%; }\n  .vinyl.playing .disc-spin { animation: spin 3.2s linear infinite; }\n  @keyframes spin { to { transform: rotate(360deg); } }\n  /* 旋转标记：让转动肉眼可见（仅高光条，无斑点） */\n  .spin-mark {\n    position:absolute; inset:0; border-radius:50%; pointer-events:none;\n    background: conic-gradient(from 0deg, transparent 0deg, rgba(255,255,255,.16) 22deg, transparent 50deg, transparent 180deg, rgba(255,255,255,.08) 205deg, transparent 235deg);\n  }\n\n  .label {\n    position:absolute; left:50%; top:50%; margin:0; transform:translate(-50%,-50%);\n    width:60px; height:60px; border-radius:50%;\n    background: radial-gradient(circle at 40% 35%, #1c2230 0%, #12151d 70%);\n    display:flex; align-items:center; justify-content:center;\n    box-shadow: 0 0 0 2.5px #101014, inset 0 0 10px rgba(0,0,0,.6);\n    overflow:hidden;\n  }\n  /* 中心音谱画布：大于胶片一圈，包裹粒子环绕区域 */\n  .vinyl canvas.spectrum {\n    position:absolute;\n    left:50%; top:50%;\n    width:220px; height:220px;             /* 大于胶片 132px，四周各多出 44px */\n    transform: translate(-50%,-50%);\n    z-index:3; pointer-events:none;\n  }\n  .label .hole {\n    position:absolute; width:8px; height:8px; border-radius:50%;\n    background: radial-gradient(circle at 40% 35%, #3a3a44, #0c0c10);\n    box-shadow: 0 0 0 1.5px rgba(255,255,255,.15);\n    z-index:2;\n  }\n\n  /* 唱针 */\n  .tonearm {\n    position:absolute; top:-10px; right:-9px;\n    width:52px; height:100px; z-index:3; pointer-events:none;\n    transform-origin: 42px 12px;\n    transform: rotate(-42deg);\n    transition: transform .9s cubic-bezier(.45,0,.2,1);\n    filter: drop-shadow(0 3px 4px rgba(0,0,0,.55));\n  }\n  .tonearm.on { transform: rotate(0deg); }\n  .tonearm .pivot {\n    position:absolute; top:3px; right:0;\n    width:19px; height:19px; border-radius:50%;\n    background: radial-gradient(circle at 35% 30%, #cfcfcf, #555 65%, #333);\n    box-shadow: inset 0 -1px 3px rgba(0,0,0,.5);\n  }\n  .tonearm .pivot::after {\n    content:''; position:absolute; left:50%; top:50%; margin:0; transform:translate(-50%,-50%);\n    width:6px; height:6px; border-radius:50%; background:#222;\n  }\n  .tonearm .arm {\n    position:absolute; top:11px; right:8px;\n    width:3.5px; height:74px; border-radius:2px;\n    background: linear-gradient(to right, #8a8a8a, #e8e8e8, #8a8a8a);\n    transform: rotate(26deg); transform-origin: top center;\n  }\n  .tonearm .head {\n    position:absolute; bottom:3px; left:9px;\n    width:11px; height:17px; border-radius:3px 3px 4px 4px;\n    background: linear-gradient(135deg, #ff5f8f, #b23a72);\n    transform: rotate(26deg);\n    box-shadow: 0 2px 4px rgba(0,0,0,.5);\n  }\n\n  #vinyl-widget.loading .label { animation: pulse 1s ease-in-out infinite; }\n  @keyframes pulse { 50% { opacity:.45; } }\n\n  /* ============ 右键弹窗菜单（含搜索框） ============ */\n  #ctx-menu {\n    position: fixed; z-index: 100000;\n    width: 220px;\n    background: rgba(22,22,30,.94);\n    backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);\n    border:1px solid rgba(255,255,255,.14);\n    border-radius:14px; padding:8px;\n    box-shadow: 0 14px 36px rgba(0,0,0,.6);\n    display:none;\n    font-size:13px;\n  }\n  #ctx-menu .now { padding:6px 8px 8px; border-bottom:1px solid rgba(255,255,255,.1); margin-bottom:6px; }\n  #ctx-menu .now .n-title { color:#fff; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }\n  #ctx-menu .now .n-artist { color:#8b95a9; font-size:11px; margin-top:2px; }\n  #ctx-menu .search-box {\n    display:flex; align-items:center; gap:6px;\n    background:rgba(255,255,255,.07);\n    border:1px solid rgba(255,255,255,.16);\n    border-radius:9px; padding:2px 8px; margin-bottom:6px;\n  }\n  #ctx-menu .search-box svg { width:14px; height:14px; fill:#8b95a9; flex:none; }\n  #ctx-menu .search-box input {\n    flex:1; min-width:0; background:none; border:none; outline:none;\n    color:#fff; font-size:13px; padding:7px 0;\n  }\n  #ctx-menu .search-box input::placeholder { color:#68738a; }\n  #ctx-menu .results { max-height:150px; overflow-y:auto; margin-bottom:4px; display:none; }\n  #ctx-menu .results.show { display:block; }\n  /* 输入时的相似提示下拉 */\n  #ctx-menu .results.suggest { border-top:1px dashed rgba(255,255,255,.12); padding-top:4px; }\n  #ctx-menu .results .hint {\n    font-size:10px; color:#68738a; padding:2px 8px 4px; letter-spacing:.5px;\n  }\n  #ctx-menu .r-item.active { background:rgba(90,156,255,.25); }\n  #ctx-menu .results::-webkit-scrollbar { width:4px; }\n  #ctx-menu .results::-webkit-scrollbar-thumb { background:rgba(255,255,255,.2); border-radius:2px; }\n  #ctx-menu .r-item { padding:6px 8px; border-radius:7px; cursor:pointer; }\n  #ctx-menu .r-item:hover { background:rgba(233,69,96,.22); }\n  #ctx-menu .r-item.loading { opacity:.5; pointer-events:none; }\n  #ctx-menu .r-item.loading .r-artist { color:#5a9cff; }\n  #ctx-menu .r-item .r-name { color:#eef1f7; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }\n  #ctx-menu .r-item .r-artist { color:#78839a; font-size:11px; }\n  #ctx-menu .item {\n    display:flex; align-items:center; gap:8px;\n    padding:7px 8px; border-radius:8px; cursor:pointer; color:#d5dbe8;\n  }\n  #ctx-menu .item:hover { background:rgba(233,69,96,.2); color:#fff; }\n  #ctx-menu .item svg { width:15px; height:15px; fill:currentColor; flex:none; }\n  #ctx-menu .sep { height:1px; background:rgba(255,255,255,.1); margin:4px 6px; }\n  /* 「整体形象」标题：单行不换行（超长省略） */\n  #ctx-menu #aLabel { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }\n  /* 音谱滑轮调节 */\n  #ctx-menu .sliders { padding:2px 8px 4px; }\n  #ctx-menu .s-title { font-size:11px; color:#78839a; margin-bottom:4px; }\n  #ctx-menu .s-row { display:flex; align-items:center; gap:8px; padding:3px 0; }\n  #ctx-menu .s-name { font-size:12px; color:#c4cbdb; width:30px; flex:none; }\n  #ctx-menu .s-val { font-size:11px; color:#78839a; width:26px; text-align:right; flex:none; }\n  #ctx-menu input[type=\"range\"] {\n    flex:1; -webkit-appearance:none; appearance:none;\n    height:4px; border-radius:2px; outline:none;\n    background:rgba(255,255,255,.15);\n  }\n  #ctx-menu input[type=\"range\"]::-webkit-slider-thumb {\n    -webkit-appearance:none; appearance:none;\n    width:13px; height:13px; border-radius:50%;\n    background:#5a9cff; cursor:pointer;\n    box-shadow:0 0 6px rgba(90,156,255,.8);\n  }\n  #ctx-menu input[type=\"range\"]::-moz-range-thumb {\n    width:13px; height:13px; border:none; border-radius:50%;\n    background:#5a9cff; cursor:pointer;\n  }\n  #ctx-menu .tip { padding:2px 8px 5px; font-size:11px; color:#78839a; }\n\n  /* ============ 整体形象：多引擎容器（Live2D / Spine / AE 序列帧） ============ */\n  .avatar-engine {\n    position:absolute; left:50%; top:50%; z-index:6;\n    width:300px; height:300px;\n    /* 以胶片为锚点放大并上移左移：形象主体悬在唱片上方，且不越出窗口右边界 */\n    transform: translate(-50%, -50%) scale(1.42) translate(-88px, -58px);\n    transform-origin: center center;\n    display:none;\n    pointer-events:none;\n    will-change: transform;\n  }\n  #vinyl-widget.mode-avatar .avatar-engine { display:block; }\n  .avatar-engine canvas { display:block; width:100%; height:100%; }\n  /* AE 序列帧：逐帧重绘（canvas 保证跨浏览器一致） */\n  .ae-frames { width:100%; height:100%; }\n\n  /* 语谱 / 节拍驱动用的隐藏画布（音频可视化数据） */\n  #beat-canvas { display:none; }\n\n  /* 底部光晕：随节拍脉动，把形象与底座唱片连成一体 */\n  .avatar-glow {\n    position:absolute; left:50%; bottom:2px; transform:translateX(-50%);\n    width:230px; height:52px; border-radius:50%;\n    background: radial-gradient(ellipse at center, rgba(90,156,255,.55), rgba(90,156,255,0) 68%);\n    opacity:.55; transition: opacity .4s;\n  }\n  #vinyl-widget.avatar-playing .avatar-glow { opacity:.95; animation: glowPulse 1.1s ease-in-out infinite; }\n  @keyframes glowPulse { 50% { transform:translateX(-50%) scale(1.14); } }\n\n  /* 引擎加载中 / 错误提示 */\n  .engine-tip {\n    position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);\n    font-size:12px; color:#9aa6bd; text-align:center; line-height:1.7;\n    background:rgba(20,22,30,.86); padding:10px 14px; border-radius:10px;\n    border:1px solid rgba(255,255,255,.12); pointer-events:none;\n    max-width:200px;\n  }\n  .engine-tip b { color:#7fb2ff; font-weight:600; }\n  /* 降级提示里的重试入口：单独开 pointer-events，否则父级的 none 会让它点不动 */\n  .engine-tip .retry-btn {\n    display:inline-block; margin-top:7px; padding:3px 10px;\n    font-size:11px; color:#8fc0ff; cursor:pointer; pointer-events:auto;\n    border:1px solid rgba(127,178,255,.45); border-radius:6px;\n    background:rgba(127,178,255,.10); transition:background .2s, border-color .2s;\n  }\n  .engine-tip .retry-btn:hover { background:rgba(127,178,255,.22); border-color:rgba(127,178,255,.8); }\n\n  /* 形象模式下把底座唱片压到脚下，略向左移使唱针能落在右上方 */\n  #vinyl-widget.mode-avatar .vinyl {\n    transform: scale(.8) translate(-22px, 70px);\n    opacity:.96;\n    transition: transform .5s cubic-bezier(.4,0,.2,1), opacity .5s;\n  }\n  #vinyl-widget.mode-avatar:hover .vinyl { transform: scale(.84) translate(-22px, 70px); }\n  /* 唱针：形象模式下用绝对定位把针头送到唱片右上方纹沟。\n     几何解算：针头距转轴 81px（sc=.5 → 40.6px），落针绕转轴 −30°、\n     抬针 −70°，对应 left/top 见下（坐标为实测标定结果） */\n  #vinyl-widget.mode-avatar .tonearm {\n    top: auto; right: auto; bottom: auto;\n    left: 27.6px; top: 5.3px;\n    transform-origin: 42px 12px;\n    transform: rotate(-70deg) scale(.5);\n    transition: transform .9s cubic-bezier(.45,0,.2,1), left .9s cubic-bezier(.45,0,.2,1), top .9s cubic-bezier(.45,0,.2,1);\n  }\n  #vinyl-widget.mode-avatar .tonearm.on {\n    left: 49.2px; top: 59.6px;\n    transform: rotate(-30deg) scale(.5);\n  }\n\n  /* 形象选择面板 */\n  #ctx-menu .avatar-panel { padding:4px 8px 6px; }\n  #ctx-menu .a-row {\n    display:flex; align-items:center; gap:6px; padding:5px 6px;\n    border-radius:7px; cursor:pointer; font-size:12px; color:#c4cbdb;\n  }\n  #ctx-menu .a-row:hover { background:rgba(90,156,255,.16); }\n  #ctx-menu .a-row.on { background:rgba(90,156,255,.26); color:#fff; }\n  #ctx-menu .a-row .a-dot {\n    width:7px; height:7px; border-radius:50%; flex:none;\n    background:rgba(255,255,255,.22);\n  }\n  #ctx-menu .a-row.on .a-dot { background:#5a9cff; box-shadow:0 0 8px #5a9cff; }\n  #ctx-menu .a-row .a-badge {\n    margin-left:auto; font-size:9px; padding:1px 5px; border-radius:6px;\n    background:rgba(255,255,255,.1); color:#8b95a9; letter-spacing:.4px;\n  }\n  #ctx-menu .a-row.on .a-badge { background:rgba(90,156,255,.35); color:#cfe2ff; }\n  #mini-ball {\n    position:fixed; right:36px; bottom:36px; z-index:99998;\n    width:40px; height:40px; border-radius:50%; border:none; cursor:pointer;\n    display:none;\n    background: repeating-radial-gradient(circle, #1b1b22 0px, #1b1b22 2px, #2a2a33 3px, #141419 5px);\n    box-shadow: 0 6px 16px rgba(0,0,0,.5);\n  }\n  #mini-ball::after {\n    content:''; position:absolute; left:50%; top:50%; margin:0; transform:translate(-50%,-50%);\n    width:13px; height:13px; border-radius:50%;\n    background: conic-gradient(from 0deg, #ff5f8f, #e94560, #b23a72, #ff5f8f);\n    box-shadow: 0 0 0 2px #101014;\n  }\n  /* 唱跳模式开关 */\n  #danceToggle { user-select: none; }\n  #danceToggle svg { width:16px; height:16px; fill:currentColor; flex:0 0 16px; }\n  #danceToggle.off { opacity: .45; }";
  var WIDGET_HTML = "<div id=\"vinyl-widget\" title=\"左键播放/暂停 · 右键搜索/菜单 · 拖拽移动\">\n  <!-- 整体形象层：Live2D / Spine / AE 序列帧 三引擎共用容器 -->\n  <div class=\"avatar-engine\" id=\"avatarEngine\">\n    <div class=\"avatar-glow\"></div>\n    <div class=\"engine-tip\" id=\"engineTip\">形象引擎未加载</div>\n  </div>\n  <div class=\"vinyl\" id=\"vinyl\">\n    <div class=\"disc-spin\">\n      <div class=\"label\"></div>\n      <div class=\"spin-mark\"></div>\n    </div>\n    <canvas class=\"spectrum\" id=\"spectrum\" width=\"440\" height=\"440\"></canvas>\n    <div class=\"hole\" id=\"centerHole\" style=\"position:absolute; left:50%; top:50%; margin:0; transform:translate(-50%,-50%); width:8px; height:8px; border-radius:50%; background: radial-gradient(circle at 40% 35%, #3a3a44, #0c0c10); box-shadow: 0 0 0 1.5px rgba(255,255,255,.15); z-index:4;\"></div>\n    <div class=\"gloss\"></div>\n  </div>\n  <div class=\"tonearm\" id=\"tonearm\">\n    <div class=\"arm\"></div><div class=\"pivot\"></div><div class=\"head\"></div>\n  </div>\n</div>\n<button id=\"mini-ball\" title=\"展开胶片\"></button>\n\n<div id=\"ctx-menu\">\n  <div class=\"now\">\n    <div class=\"n-title\" id=\"mTitle\">正在加载曲库…</div>\n    <div class=\"n-artist\" id=\"mArtist\">网络流行歌曲 · 优先最新</div>\n  </div>\n  <div class=\"search-box\">\n    <svg viewBox=\"0 0 24 24\"><path d=\"M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z\"/></svg>\n    <input id=\"mSearch\" placeholder=\"输入歌名 / 歌手，回车或点🔍搜索\" />\n    <svg id=\"searchGo\" viewBox=\"0 0 24 24\" style=\"cursor:pointer; transform:rotate(-90deg);\"><path d=\"M8 5v14l11-7z\"/></svg>\n  </div>\n  <div class=\"results\" id=\"results\"></div>\n  <div class=\"results suggest\" id=\"suggestBox\"></div>\n  <div class=\"item\" data-act=\"toggle\"><svg viewBox=\"0 0 24 24\"><path d=\"M8 5v14l11-7z\"/></svg><span id=\"mToggle\">播放</span></div>\n  <div class=\"item\" data-act=\"random\"><svg viewBox=\"0 0 24 24\"><path d=\"M4 6h3.4l2.6 2.7 1.4-2L7.4 4H4v2zm0 12h3.4l8.4-9.4H19v3.4l2-2.6-2-2.6V10h-4.6L6 20H4v-2zm12.4-3.4-1.4 2 1.4 1.5V19h-2v-2.4h-1z\" transform=\"translate(0,-1)\"/><path d=\"M15 4h2v3.4l2-2.6-2-2.6V5h-4.6l1.6 1.8L15.4 5H15V4z\" opacity=\"0\"/></svg>随机换一首</div>\n  <div class=\"item\" data-act=\"prev\"><svg viewBox=\"0 0 24 24\"><path d=\"M6 6h2v12H6zm3.5 6l8.5 6V6z\"/></svg>上一首</div>\n  <div class=\"item\" data-act=\"next\"><svg viewBox=\"0 0 24 24\"><path d=\"M16 6h2v12h-2zM6 18l8.5-6L6 6z\"/></svg>下一首</div>\n  <div class=\"item s-toggle\" id=\"sToggle\">\n    <svg viewBox=\"0 0 24 24\" id=\"sToggleArrow\" style=\"transition:transform .25s\"><path d=\"M8.6 5.4L7.2 6.8 12.4 12l-5.2 5.2 1.4 1.4L15.2 12z\" transform=\"rotate(-90 12 12)\"/></svg>\n    <span>音谱样式调节</span>\n  </div>\n  <div class=\"item\" data-act=\"fx\"><svg viewBox=\"0 0 24 24\"><path d=\"M12 2a7 7 0 0 0-7 7c0 2.4 1.2 4.1 2.4 5.5.9 1 1.6 2 1.6 3.5h6c0-1.5.7-2.5 1.6-3.5C17.8 13.1 19 11.4 19 9a7 7 0 0 0-7-7zM9 19.5h6V21a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 21v-1.5z\"/></svg><span id=\"fxLabel\">音谱样式：开</span></div>\n  <div class=\"sliders\" id=\"sPanel\" style=\"display:none;\">\n    <div class=\"s-row\">\n      <span class=\"s-name\">数量</span>\n      <input type=\"range\" id=\"sBars\" min=\"4\" max=\"20\" step=\"1\" value=\"10\" />\n      <span class=\"s-val\" id=\"vBars\">10</span>\n    </div>\n    <div class=\"s-row\">\n      <span class=\"s-name\">间隔</span>\n      <input type=\"range\" id=\"sGap\" min=\"0.5\" max=\"8\" step=\"0.5\" value=\"2.5\" />\n      <span class=\"s-val\" id=\"vGap\">2.5</span>\n    </div>\n    <div class=\"s-row\">\n      <span class=\"s-name\">起伏</span>\n      <input type=\"range\" id=\"sAmp\" min=\"0.4\" max=\"3\" step=\"0.1\" value=\"1.6\" />\n      <span class=\"s-val\" id=\"vAmp\">1.6</span>\n    </div>\n    <div class=\"s-row\">\n      <span class=\"s-name\">粒子量</span>\n      <input type=\"range\" id=\"sDensity\" min=\"0\" max=\"1\" step=\"0.1\" value=\"0.5\" />\n      <span class=\"s-val\" id=\"vDensity\">0.5</span>\n    </div>\n    <div class=\"s-row\">\n      <span class=\"s-name\">粒子速</span>\n      <input type=\"range\" id=\"sSpeed\" min=\"0\" max=\"1\" step=\"0.1\" value=\"0.5\" />\n      <span class=\"s-val\" id=\"vSpeed\">0.5</span>\n    </div>\n    <div class=\"s-row\">\n      <span class=\"s-name\">大小</span>\n      <input type=\"range\" id=\"sSize\" min=\"60\" max=\"180\" step=\"5\" value=\"100\" />\n      <span class=\"s-val\" id=\"vSize\" style=\"width:38px;\">100%</span>\n    </div>\n  </div>\n  <div class=\"sep\"></div>\n  <div class=\"item s-toggle\" id=\"aToggle\">\n    <svg viewBox=\"0 0 24 24\" id=\"aToggleArrow\" style=\"transition:transform .25s\"><path d=\"M8.6 5.4L7.2 6.8 12.4 12l-5.2 5.2 1.4 1.4L15.2 12z\" transform=\"rotate(-90 12 12)\"/></svg>\n    <span id=\"aLabel\">整体形象：胶片</span>\n  </div>\n  <div class=\"avatar-panel\" id=\"aPanel\" style=\"display:none;\">\n    <div class=\"a-row\" data-avatar=\"disc\"><span class=\"a-dot\"></span>胶片（默认尺寸）<span class=\"a-badge\">DISC</span></div>\n    <div class=\"a-row on\" data-avatar=\"live2d\"><span class=\"a-dot\"></span>初音未来（Live2D）<span class=\"a-badge\">MIKU</span></div>\n    <div class=\"a-row\" data-avatar=\"blueberry\"><span class=\"a-dot\"></span>蓝莓酱（AI 桌宠）<span class=\"a-badge\">PET</span></div>\n    <div class=\"a-row\" data-avatar=\"spine\"><span class=\"a-dot\"></span>Spine 骨骼动画<span class=\"a-badge\">SKEL</span></div>\n    <div class=\"a-row\" data-avatar=\"ae\"><span class=\"a-dot\"></span>AE 序列帧<span class=\"a-badge\">SEQ</span></div>\n    <div class=\"a-row\" data-avatar=\"builtin\"><span class=\"a-dot\"></span>内置歌手（零依赖）<span class=\"a-badge\">DEMO</span></div>\n  </div>\n  <div class=\"item s-toggle\" id=\"danceToggle\" title=\"播放时初音随节拍全身舞动\">\n    <svg viewBox=\"0 0 24 24\"><path d=\"M8 12a4 4 0 1 1 8 0v1h-2v-1a2 2 0 1 0-4 0v5a2 2 0 1 0 4 0h2a4 4 0 1 1-8 0v-5zm6-7a2 2 0 1 1-4 0 2 2 0 0 1 4 0z\"/></svg>\n    <span id=\"danceLabel\">唱跳模式：开</span>\n  </div>\n  <div class=\"tip\" id=\"aTip\">形象加载中…</div>\n  <div class=\"tip\" id=\"mTip\">曲库加载中…</div>\n  <div class=\"item\" data-act=\"hide\"><svg viewBox=\"0 0 24 24\"><path d=\"M19 6.4L17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z\"/></svg>收起为小球</div>\n</div>\n\n<audio id=\"audio\" preload=\"auto\" crossorigin=\"anonymous\"></audio>";

  var injectedStyle = false;
  var instances = [];

  function injectStyle() {
    if (injectedStyle) return;
    var style = document.createElement('style');
    style.setAttribute('data-miku-player-style', '');
    style.textContent = CSS;
    document.head.appendChild(style);
    injectedStyle = true;
  }

  function resolveContainer(arg) {
    if (!arg) return document.body;
    if (typeof arg === 'string') {
      var el = document.querySelector(arg);
      if (!el) throw new Error('MikuPlayer: 未找到容器 "' + arg + '"');
      return el;
    }
    if (arg && arg.nodeType === 1) return arg;
    throw new Error('MikuPlayer: container 必须是选择器字符串或 DOM 元素');
  }

  function runApp(opts) {
(function () {
  var widget = document.getElementById('vinyl-widget');
  var vinyl = document.getElementById('vinyl');
  var tonearm = document.getElementById('tonearm');
  var spectrumCv = document.getElementById('spectrum');
  var sctx = spectrumCv.getContext('2d');
  var menu = document.getElementById('ctx-menu');
  var mTitle = document.getElementById('mTitle');
  var mArtist = document.getElementById('mArtist');
  var mToggle = document.getElementById('mToggle');
  var mTip = document.getElementById('mTip');
  var mSearch = document.getElementById('mSearch');
  var results = document.getElementById('results');
  var miniBall = document.getElementById('mini-ball');
  var audio = document.getElementById('audio');

  /* ================= 曲库：网络流行歌曲，优先最新 ================= */
  var GD_API = 'https://music-api.gdstudio.xyz/api.php';
  var METING_API = 'https://api.i-meto.com/meting/api';
  var METING = [
    'https://api.injahow.cn/meting/?type=playlist&id=',
    'https://api.i-meto.com/meting/api?server=netease&type=playlist&id='
  ];
  // 优先最新：飙升榜(19723756) → 新歌榜(3779629) → 热歌榜(3778678)
  var PLAYLISTS = ['19723756', '3779629', '3778678'];
  var FALLBACK_IDS = [
    [186016, '晴天', '周杰伦'], [185811, '青花瓷', '周杰伦'], [185809, '七里香', '周杰伦'],
    [186001, '稻香', '周杰伦'], [185924, '夜曲', '周杰伦'],
    [347230, '海阔天空', 'Beyond'], [108416, '光辉岁月', 'Beyond'],
    [347849, '红豆', '王菲'], [4138298, '平凡之路', '朴树'],
    [298213, '遇见', '孙燕姿'], [27955653, '小幸运', '田馥甄'],
    [569213220, '起风了', '买辣椒也用券'], [436514312, '成都', '赵雷']
  ];
  function neteaseUrl(id) { return 'https://music.163.com/song/media/outer/url?id=' + id + '.mp3'; }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function fallbackLibrary() {
    return shuffle(FALLBACK_IDS.map(function (x) {
      return makeSong(x[1], x[2], String(x[0]), '');
    }));
  }
  // 按榜单顺序取「最新优先」：先飙升榜，失败再降级
  /* 打包歌曲对象：url 统一在播放前用 resolveUrl 换取真实可播直链 */
  function makeSong(name, artist, id, url) {
    return { name: name, artist: artist, id: id, url: url || '', src: 'netease', srcName: '网易云' };
  }

  /* 并行拉取 + 超时保护：任一源成功即用，全部失败才用内置兜底 */
  function fetchLibrary() {
    var attempts = [];
    // 用 meting 歌单拿「歌名 + id 列表」
    METING.forEach(function (base) {
      PLAYLISTS.forEach(function (pid) {
        attempts.push(function () {
          return Promise.race([
            fetch(base + pid).then(function (r) {
              if (!r.ok) throw new Error('http');
              return r.json();
            }),
            new Promise(function (_, rej) { setTimeout(function () { rej(new Error('to')); }, 6000); })
          ]).then(function (list) {
            if (!Array.isArray(list) || list.length < 5) throw new Error('bad');
            return list.map(function (s) {
              var id = (String(s.url || '').match(/[?&]id=(\d+)/) || [])[1] || s.id || s.url_id;
              return makeSong(
                s.name || s.title || '未知',
                s.artist || s.author || '未知',
                id,
                id ? '' : (s.url || '')          // 有 id 就走取链，不用镜像 url
              );
            }).filter(function (s) { return s.id || s.url; });
          });
        });
      });
    });

    return new Promise(function (resolve) {
      var done = false, failed = 0;
      attempts.forEach(function (run) {
        run().then(function (list) {
          if (done || !list.length) return;
          done = true;
          resolve(list);
        }).catch(function () {
          if (done) return;
          if (++failed === attempts.length) { done = true; resolve(fallbackLibrary()); }
        });
      });
      setTimeout(function () {
        if (!done) { done = true; resolve(fallbackLibrary()); }
      }, 8000);
    });
  }

  /* ================= 音频分析：频谱 → 粒子 ================= */
  var actx = null, analyser = null, freqData = null, audioLinked = false;
  var fakePhase = 0;        // 跨域失败时的伪节拍
  function linkAudio() {
    if (audioLinked) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      actx = new AC();
      // 注意：一旦 createMediaElementSource，音频输出就完全交给 AudioContext，
      // 必须确保 analyser -> destination 链路可用，否则会「无声」。失败则整体放弃。
      var src = actx.createMediaElementSource(audio);
      analyser = actx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.78;
      src.connect(analyser);
      analyser.connect(actx.destination);
      freqData = new Uint8Array(analyser.frequencyBinCount);
      audioLinked = true;
    } catch (e) {
      // 走伪律动，且不影响正常播放（audio 元素直出）
      analyser = null; freqData = null; audioLinked = false;
      try { if (actx) actx.close(); } catch (e2) {}
      actx = null;
    }
  }

  /* ---- 可调音谱参数（右键菜单滑轮） ---- */
  var cfg = { bars: 10, gap: 2.5, amp: 1.6 };    // 数量 / 间隔(显示px) / 起伏阈值
  var smoothBars = [];
  var bandPeak = [];      // 每根线条的滚动峰值（自适应归一化用）
  function ensureBars() {
    while (smoothBars.length < cfg.bars) smoothBars.push(0);
    smoothBars.length = cfg.bars;
    while (bandPeak.length < cfg.bars) bandPeak.push(0.25);
    bandPeak.length = cfg.bars;
  }
  ensureBars();

  /* ---- 整体胶片大小调节 ---- */

  /* ---- 上升发光颗粒：白色微光，从包裹胶片的圆周环带中缓缓升起并渐隐 ---- */
  var motes = [];      // { x, y, r, vy, a }
  var moteCfg = { density: 0.5, speed: 0.5 };          // 粒子密度 / 上升速度
  function spawnMote() {
    // 在胶片外圈的圆周环带内取随机点（包裹住整个胶片）
    // 画布物理 440px（显示 220px，×2），胶片半径 264（显示 132/2×2）
    var ang = Math.random() * Math.PI * 2;
    var rad = 140 + Math.random() * 74;                  // 环带：紧贴胶片边缘向外 136~214
    motes.push({
      x: 220 + Math.cos(ang) * rad,
      y: 220 + Math.sin(ang) * rad,
      r: 3 + Math.random() * 4,
      vy: (0.24 + Math.random() * 0.4) * (0.3 + moteCfg.speed * 1.4),   // 缓慢上升
      a: 0.5 + Math.random() * 0.3,
      drift: (Math.random() - 0.5) * 0.4
    });
  }
  function drawMotes() {
    var cap = Math.round(6 + moteCfg.density * 40);
    if (motes.length < cap && Math.random() < 0.12 + moteCfg.density * 0.5) spawnMote();
    sctx.save();
    sctx.shadowColor = 'rgba(255,255,255,.95)';           // 白色发光
    sctx.shadowBlur = 16;
    for (var i = motes.length - 1; i >= 0; i--) {
      var p = motes[i];
      p.y -= p.vy;
      p.x += p.drift;
      p.a -= 0.0035 + p.vy * 0.003;                      // 缓慢降低透明度
      p.r *= 0.997;
      if (p.a <= 0 || p.y < 4) { motes.splice(i, 1); continue; }
      sctx.beginPath();
      sctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      sctx.fillStyle = 'rgba(255,255,255,' + p.a + ')';
      sctx.fill();
    }
    sctx.restore();
  }

  function levelBoost() {
    if (analyser && freqData) {
      var s = 0;
      for (var k = 2; k < 30; k++) s += freqData[k];
      return Math.min(s / (28 * 255) * 1.6, 1);
    }
    return 0.5;
  }

  var fxOn = true;      // 音谱样式总开关
  function drawFX() {
    requestAnimationFrame(drawFX);
    sctx.setTransform(1, 0, 0, 1, 0, 0);     // 物理坐标 440×440（显示 220px，×2）
    sctx.clearRect(0, 0, 440, 440);
    if (audio.paused || !fxOn) return;       // 暂停或关闭音谱样式：全部清空

    var i, e;
    if (analyser && freqData) analyser.getByteFrequencyData(freqData);
    else fakePhase += 0.12;

    ensureBars();
    var cx = 220, cy = 220;                              // 画布中心（即胶片中心）
    var usable = 176;                                    // 中心小圆内可用宽度（物理 px）
    var n = cfg.bars, gap = cfg.gap * 4;                  // 间隔按显示 px ×4
    // 左右镜像排布：每侧 n/2 根，以中心为焦点向两侧延展
    var half = Math.ceil(n / 2);
    var barW = Math.max(3, (usable / 2 - (half - 1) * gap) / half);
    var maxH = 112 * cfg.amp;                            // 起伏阈值

    /* ---- 音谱线条：以胶片中心为焦点，向左右两侧对称延展 ---- */
    sctx.save();
    sctx.beginPath();
    sctx.arc(cx, cy, 108, 0, Math.PI * 2);               // 中心小圆裁剪
    sctx.clip();
    sctx.shadowColor = 'rgba(90,160,255,.9)';           // 蓝色微光
    sctx.shadowBlur = 14;
    for (i = 0; i < n; i++) {
      // 以左右两侧为焦点：越靠外越接近低频，越靠中间越接近高频
      var fromEdge = i < half ? (half - 1 - i) : (i - half);   // 0 = 最外侧，递增到中心
      if (analyser && freqData) {
        // 频段映射：外侧 = 低频，向内 = 高频（对数频率更贴合音阶）
        var idx2 = 2 + Math.floor(Math.pow(fromEdge / half, 1.35) * 80);
        // 窗口均值：相邻 4 个频段取平均，线条过渡平滑
        var w = 4, sum2 = 0;
        for (var q = 0; q < w; q++) sum2 += freqData[Math.min(idx2 + q, freqData.length - 1)];
        var raw = sum2 / w / 255;
        // 感知加权：外侧低频能量天然偏大需压低，中频略提升
        var weight = 1.18 - 0.5 * Math.sin(Math.min(fromEdge / half, 1) * Math.PI * 0.5);
        raw *= weight;
        // 自适应归一化：跟踪每根线条的滚动峰值（慢衰减），
        // 小声的歌也能满幅起伏，大声的歌不会爆表 —— 智能贴合实际音调
        if (!bandPeak[i]) bandPeak[i] = 0.25;
        bandPeak[i] = Math.max(raw, bandPeak[i] * 0.994);       // 峰值缓慢回落
        if (bandPeak[i] < 0.06) bandPeak[i] = 0.06;
        e = raw / bandPeak[i];                                    // 0~1 相对能量
        // 噪声门 + 轻压缩：安静段贴平、有音就跳
        e = Math.max(0, (e - 0.18) * 1.35);
        e = Math.pow(Math.min(e, 1), 0.7);
      } else {
        e = Math.abs(Math.sin(fakePhase + fromEdge * 0.6)) * 0.75 + 0.05;
      }
      // 快起慢落的包络：起音跟手（0.5），回落从容（0.12），贴合音乐律动
      var rel = e > smoothBars[i] ? 0.5 : 0.12;
      smoothBars[i] += (e - smoothBars[i]) * rel;
      var h = Math.min(2 + smoothBars[i] * maxH, 208);  // 不超出小圆直径
      // 位置：i < half → 中心向右第 i 根；i >= half → 中心向左第 (n-1-i) 根
      // 最内侧一对与中心点保留半个间隔，不贴合；中心两侧线条同样随音调起伏
      var off = (i < half ? i : (n - 1 - i)) * (barW + gap) + gap / 2 + barW / 2;
      var x = i < half ? cx + off : cx - off - barW;
      var g = sctx.createLinearGradient(0, cy - h / 2, 0, cy + h / 2);
      g.addColorStop(0, 'rgba(140,205,255,.95)');
      g.addColorStop(0.5, 'rgba(80,150,255,1)');
      g.addColorStop(1, 'rgba(140,205,255,.95)');
      sctx.fillStyle = g;
      var r = Math.min(barW / 2, h / 4);
      sctx.beginPath();
      sctx.moveTo(x + r, cy - h / 2);
      sctx.arcTo(x + barW, cy - h / 2, x + barW, cy + h / 2, r);
      sctx.arcTo(x + barW, cy + h / 2, x, cy + h / 2, r);
      sctx.arcTo(x, cy + h / 2, x, cy - h / 2, r);
      sctx.arcTo(x, cy - h / 2, x + barW, cy - h / 2, r);
      sctx.fill();
    }
    sctx.restore();

    drawMotes();   // 上升发光颗粒（仅播放时）
  }
  drawFX();

  /* ---- 滑轮调节：数量 / 间隔 / 起伏阈值 ---- */
  function bindSlider(id, valId, key, target) {
    var obj = target || cfg;
    var el = document.getElementById(id), lab = document.getElementById(valId);
    if (!el) return;
    el.addEventListener('input', function () {
      obj[key] = parseFloat(el.value);
      lab.textContent = el.value;
    });
  }
  bindSlider('sBars', 'vBars', 'bars');
  bindSlider('sGap', 'vGap', 'gap');
  bindSlider('sAmp', 'vAmp', 'amp');
  bindSlider('sDensity', 'vDensity', 'density', moteCfg);
  bindSlider('sSpeed', 'vSpeed', 'speed', moteCfg);

  /* ---- 整体胶片大小：滑轮调节（60% ~ 180%） ---- */
  var sizeK = 1;
  function applySize() {
    widget.style.transform = 'scale(' + sizeK + ')';
    widget.style.transformOrigin = 'center';
    document.getElementById('vSize').textContent = Math.round(sizeK * 100) + '%';
  }
  (function () {
    var el = document.getElementById('sSize');
    if (!el) return;
    el.addEventListener('input', function () {
      sizeK = parseFloat(el.value) / 100;
      applySize();
    });
    // 拖动滑轮时阻止事件冒泡，避免触发菜单外点击关闭等行为
    el.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    el.addEventListener('click', function (e) { e.stopPropagation(); });
  })();
  applySize();

  /* ---- 「音谱样式调节」展开 / 收起 ---- */
  var sToggle = document.getElementById('sToggle');
  var sPanel = document.getElementById('sPanel');
  var sArrow = document.getElementById('sToggleArrow');
  sToggle.addEventListener('click', function (e) {
    e.stopPropagation();
    var open = sPanel.style.display !== 'none';
    sPanel.style.display = open ? 'none' : 'block';
    sArrow.style.transform = open ? 'rotate(-90 12 12)' : '';
  });

  /* ================= 播放核心 ================= */
  var tracks = [], idx = -1, failCount = 0, skipOnError = false;

  /* 加载并播放第 i 首：先取真实可播直链，取不到自动跳下一首 */
  function load(i, autoPlay) {
    if (!tracks.length) return;
    idx = ((i % tracks.length) + tracks.length) % tracks.length;
    var t = tracks[idx];
    failCount = 0;
    skipOnError = false;
    mTitle.textContent = t.name;
    mArtist.textContent = t.artist;

    if (t.url) {                       // 已有可播地址
      audio.src = t.url;
      if (autoPlay) audio.play().catch(function () {});
      return;
    }
    // 无地址：向接口换取
    widget.classList.add('loading');
    mTip.textContent = '正在获取「' + t.name + '」的播放地址…';
    resolveUrl(t).then(function (u) {
      widget.classList.remove('loading');
      if (!u) {                        // 取不到 → 换下一首
        if (++failCount < Math.min(tracks.length, 12)) { load(idx + 1, autoPlay); }
        else { mTip.textContent = '暂时没有可播放的歌曲，稍后再试'; }
        return;
      }
      t.url = u;
      audio.src = u;
      if (autoPlay) audio.play().catch(function () {
        mTip.textContent = '播放失败，点「随机换一首」再试';
      });
    }).catch(function () {
      widget.classList.remove('loading');
      if (++failCount < Math.min(tracks.length, 12)) load(idx + 1, autoPlay);
    });
  }
  /* 播放指定歌曲（搜索结果 / 用户点选的），插入队首并立即播放 */
  function playSong(song) {
    if (!song) return;
    var exist = -1;
    for (var k = 0; k < tracks.length; k++) {
      if ((song.id && tracks[k].id === song.id) || (song.url && tracks[k].url === song.url)) { exist = k; break; }
    }
    if (exist >= 0) { tracks[exist].url = song.url || tracks[exist].url; load(exist, true); }
    else { tracks.unshift(song); load(0, true); }
    skipOnError = true;        // 用户点选的歌失败时不自动跳走，而是提示
    play();
  }
  function randomLoad() {
    if (!tracks.length) return;
    var r;
    do { r = Math.floor(Math.random() * tracks.length); } while (tracks.length > 1 && r === idx);
    load(r, true);
  }
  /* 播放：确保有 src 才开始 */
  function play() {
    if (!tracks.length) return;
    linkAudio();
    if (actx && actx.state === 'suspended') actx.resume();
    // 还没选歌 → 随机选一首并加载（load 内部会取链后自动播放）
    if (idx < 0 || !audio.src) { randomLoad(); return; }
    widget.classList.add('loading');
    audio.play().catch(function () {
      widget.classList.remove('loading');
      mTip.textContent = '播放失败，点「随机换一首」再试';
    });
  }
  function setUI(on) {
    vinyl.classList.toggle('playing', on);
    tonearm.classList.toggle('on', on);
    mToggle.textContent = on ? '暂停' : '播放';
    if (typeof syncAvatarState === 'function') syncAvatarState();
  }
  audio.addEventListener('play', function () { widget.classList.remove('loading'); setUI(true); });
  audio.addEventListener('playing', function () { widget.classList.remove('loading'); });
  audio.addEventListener('pause', function () { setUI(false); });
  audio.addEventListener('ended', function () { setUI(false); randomLoad(); play(); });
  audio.addEventListener('error', function () {
    widget.classList.remove('loading');
    if (!audio.src || !tracks.length) return;
    if (skipOnError) {                 // 用户点选的歌失败：提示而不自动跳歌
      mTip.textContent = '这首暂时无法播放（可能为VIP/版权限制），换一首试试';
      return;
    }
    if (++failCount >= tracks.length) { mTip.textContent = '曲库暂时不可用'; return; }
    randomLoad(); play();
  });

  /* ================= 左键 / 右键 ================= */
  var moved = false;
  widget.addEventListener('click', function () {
    if (moved) return;
    if (!tracks.length) return;
    audio.paused ? play() : audio.pause();
  });

  /* 菜单以胶片为焦点定位：优先出现在胶片左侧，靠边时自动换到右侧/上下 */
  function positionMenu() {
    var r = widget.getBoundingClientRect();
    // 形象模式下以「形象 + 胶片」的整体包围盒为焦点，避免菜单压住形象
    if (widget.classList.contains('mode-avatar')) {
      var er = engineEl.getBoundingClientRect ? engineEl.getBoundingClientRect() : null;
      if (er && er.width) {
        var left = Math.min(r.left, er.left);
        var right = Math.max(r.right, er.right);
        var top = Math.min(r.top, er.top);
        var bottom = Math.max(r.bottom, er.bottom);
        r = { left: left, right: right, top: top, bottom: bottom,
              width: right - left, height: bottom - top };
      }
    }
    var mw = menu.offsetWidth, mh = menu.offsetHeight, pad = 10;
    var x, y;
    if (r.left - mw - pad >= 8) x = r.left - mw - pad;              // 左侧
    else if (r.right + mw + pad <= window.innerWidth - 8) x = r.right + pad;  // 右侧
    else x = Math.max(8, Math.min((window.innerWidth - mw) / 2, r.left));
    y = Math.max(8, Math.min(r.top + (r.height - mh) / 2, window.innerHeight - mh - 8));
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
  }
  function openMenu() {
    menu.style.display = 'block';
    positionMenu();
    setTimeout(function () { mSearch.focus(); }, 60);
  }
  function closeMenu() { menu.style.display = 'none'; }
  widget.addEventListener('contextmenu', function (e) { e.preventDefault(); openMenu(); });
  document.addEventListener('click', function (e) {
    if (!menu.contains(e.target) && !widget.contains(e.target)) closeMenu();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });

  /* 菜单内点击不关闭菜单；只有点击菜单与胶片以外的区域才退出 */
  menu.addEventListener('click', function (e) {
    var item = e.target.closest('.item');
    if (!item) return;
    var act = item.dataset.act;
    if (act === 'toggle') { audio.paused ? play() : audio.pause(); }
    else if (act === 'fx') {
      fxOn = !fxOn;
      document.getElementById('fxLabel').textContent = '音谱样式：' + (fxOn ? '开' : '关');
    }
    else if (act === 'random') { randomLoad(); }
    else if (act === 'prev') { load(idx < 0 ? 0 : idx - 1, true); }
    else if (act === 'next') { load(idx < 0 ? 0 : idx + 1, true); }
    else if (act === 'hide') { widget.style.display = 'none'; miniBall.style.display = 'block'; closeMenu(); }
  });
  miniBall.onclick = function () {
    widget.style.display = 'block';
    miniBall.style.display = 'none';
  };

  /* ================= 搜索：多数据源并行 + 5 秒超时 =================
   * 数据源（均已实测可在浏览器跨域直连）：
   *   A. music-api.gdstudio.xyz   source=netease  搜索 + 取链（最优）
   *   B. api.i-meto.com/meting    server=netease / tencent / kugou  仅搜索
   * 策略：所有源同时发起；netease 有结果优先展示；
   *       netease 无结果则回退展示其他源的答案；
   *       超过 5 秒仍无任何结果 → 提示「数据库暂时无该曲目」
   * =============================================================== */
  var SEARCH_TIMEOUT = 5000;          // 搜索总时长上限

  function fetchJSON(url, timeout) {
    return Promise.race([
      fetch(url).then(function (r) {
        if (!r.ok) throw new Error('http ' + r.status);
        return r.json();
      }),
      new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timeout')); }, timeout || SEARCH_TIMEOUT); })
    ]);
  }
  function probeAudio(url, timeout) {
    return Promise.race([
      fetch(url, { method: 'GET', headers: { Range: 'bytes=0-1' } }).then(function (r) {
        var ct = (r.headers.get('content-type') || '').toLowerCase();
        return ct.indexOf('audio') === 0 || ct.indexOf('video') === 0 || ct.indexOf('octet-stream') === 0;
      }),
      new Promise(function (res) { setTimeout(function () { res(false); }, timeout || 3500); })
    ]).catch(function () { return false; });
  }

  /* ---- 源 A：gdstudio（netease，可搜索 + 可取链） ---- */
  function srcGd(kw) {
    return fetchJSON(GD_API + '?types=search&source=netease&name=' +
      encodeURIComponent(kw) + '&count=20').then(function (list) {
      if (!Array.isArray(list) || !list.length) throw new Error('empty');
      return list.map(function (s) {
        return {
          name: s.name || '未知',
          artist: Array.isArray(s.artist) ? s.artist.join(' / ') : (s.artist || '未知'),
          id: s.id || s.url_id,
          src: 'netease', srcName: '网易云', url: ''
        };
      }).filter(function (s) { return !!s.id; }).slice(0, 10);
    });
  }
  /* ---- 源 B：i-meto 多服务（仅搜索，点击时再转可播地址） ---- */
  function metingSearch(server, kw) {
    return fetchJSON(METING_API + '?server=' + server + '&type=search&id=' +
      encodeURIComponent(kw)).then(function (list) {
      if (!Array.isArray(list) || !list.length) throw new Error('empty');
      return list.map(function (s) {
        var id = (String(s.url || '').match(/[?&]id=([^&]+)/) || [])[1] || '';
        return {
          name: s.title || s.name || '未知',
          artist: s.author || s.artist || '未知',
          id: id,
          src: server,
          srcName: server === 'tencent' ? 'QQ音乐' : (server === 'kugou' ? '酷狗' : '网易云'),
          url: ''
        };
      }).filter(function (s) { return !!s.id; }).slice(0, 10);
    });
  }

  /* ---- 取播放地址：netease 走官方直链；其他源尽量回退网易云同名曲 ---- */
  /* ---- 取播放地址：优先 gdstudio 真实直链，失败才回退网易云外链 ---- */
  function gdUrl(id) {
    return fetchJSON(GD_API + '?types=url&source=netease&id=' + id + '&br=320', 7000)
      .then(function (j) {
        var u = j && j.url;
        if (!u || !/^https?:/.test(u)) throw new Error('nourl');
        return u;
      });
  }
  function resolveUrl(song) {
    var idOk = song && /^\d+$/.test(String(song.id || ''));
    if (idOk) {
      return gdUrl(song.id)
        .catch(function () { return neteaseUrl(song.id); });   // 回退外链
    }
    // 非 netease 或无 id：用「歌名 + 歌手」重新查一次网易云
    return srcGd((song.name || '') + ' ' + (song.artist || '')).then(function (list) {
      var pick = list[0];
      if (!pick || !pick.id) return '';
      song.id = pick.id;
      song.src = 'netease';
      return gdUrl(pick.id).catch(function () { return neteaseUrl(pick.id); });
    }).catch(function () { return ''; });
  }

  /* ---- 并行聚合搜索：netease 优先，5 秒截止 ---- */
  /* 结果相关性校验：标题或歌手需包含查询词（忽略大小写/空格），否则视为无效结果 */
  function isRelevant(song, kw) {
    var n = (song.name || '').toLowerCase().replace(/\s+/g, '');
    var a = (song.artist || '').toLowerCase().replace(/\s+/g, '');
    var k = kw.toLowerCase().replace(/\s+/g, '');
    if (!k) return true;
    // 查询词被完整包含
    if (n.indexOf(k) >= 0 || a.indexOf(k) >= 0) return true;
    // 中文长词：允许部分匹配（>=2 字连续命中）
    if (k.length >= 2) {
      for (var i = 0; i + 2 <= k.length; i++) {
        var piece = k.substr(i, 2);
        if (n.indexOf(piece) >= 0 || a.indexOf(piece) >= 0) return true;
      }
    }
    return false;
  }
  function searchAll(kw) {
    return new Promise(function (resolve) {
      var settled = false, neteaseHits = [], otherHits = [];
      function finish(list, from) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ list: list, from: from });
      }
      var timer = setTimeout(function () {
        // 到点：netease 有结果优先，其次其他源；都空则认为无该曲目
        if (neteaseHits.length) finish(neteaseHits, 'netease');
        else if (otherHits.length) finish(otherHits, 'other');
        else finish([], 'none');
      }, SEARCH_TIMEOUT);

      // 源 A（netease，主）：有结果立即返回，不再等其它源
      srcGd(kw).then(function (list) {
        var rel = list.filter(function (s) { return isRelevant(s, kw); });
        neteaseHits = rel.length ? rel : list;
        if (neteaseHits.length) finish(neteaseHits, 'netease');
      }).catch(function () {});

      // 源 B（其他源，并行；作为 netease 迟到/无结果时的兜底）
      ['netease', 'tencent', 'kugou'].forEach(function (srv) {
        metingSearch(srv, kw).then(function (list) {
          if (settled) return;
          var rel = list.filter(function (s) { return isRelevant(s, kw); });
          if (!rel.length) return;                       // 不相关的结果一律丢弃
          if (srv === 'netease') {
            if (!neteaseHits.length) { neteaseHits = rel; finish(rel, 'netease'); }
          } else if (!otherHits.length) {
            otherHits = rel;
          }
        }).catch(function () {});
      });
    });
  }

  var searchSeq = 0;
  var lastFullResults = [];      // 最近一次完整搜索的结果，供输入提示本地过滤
  function doSearch() {
    var kw = mSearch.value.trim();
    if (!kw) { results.classList.remove('show'); mTip.textContent = '请输入歌名 / 歌手 / 歌曲ID'; return; }
    var seq = ++searchSeq;
    mTip.textContent = '正在搜索「' + kw + '」（多数据源并行）…';
    results.classList.remove('show');
    results.innerHTML = '';

    // 纯数字：直接按歌曲 ID 解析
    if (/^\d{4,}$/.test(kw)) {
      resolveUrl({ src: 'netease', id: kw, name: '网易云歌曲 #' + kw }).then(function (u) {
        if (seq !== searchSeq) return;
        renderResults([{ name: '网易云歌曲 #' + kw, artist: 'NetEase', url: u, srcName: '网易云' }], 'ID');
      }).catch(function () {
        if (seq === searchSeq) mTip.textContent = '数据库暂时无该曲目';
      });
      return;
    }

    searchAll(kw).then(function (res) {
      if (seq !== searchSeq) return;
      if (!res.list.length) { mTip.textContent = '数据库暂时无该曲目'; return; }
      var tip = res.from === 'netease'
        ? '网易云找到 ' + res.list.length + ' 首，点击播放'
        : '网易云无结果，已从其他数据源找到 ' + res.list.length + ' 首';
      renderResults(res.list, tip);
    });
  }
  function renderResults(list, tip) {
    lastFullResults = list.slice();
    mTip.textContent = tip;
    results.innerHTML = '';
    results.classList.add('show');
    list.forEach(function (s) {
      var el = document.createElement('div');
      el.className = 'r-item';
      el.innerHTML = '<div class="r-name"></div><div class="r-artist"></div>';
      el.querySelector('.r-name').textContent = s.name;
      el.querySelector('.r-artist').textContent = (s.artist || '未知') + ' · ' + (s.srcName || '');
      el.onclick = function () { pickResult(s, el); };
      results.appendChild(el);
    });
  }
  /* 点击结果：取链 → 播放 */
  function pickResult(s, el) {
    if (s.url) { playSong(s); mTip.textContent = '正在播放：' + s.name; return; }
    if (el) el.classList.add('loading');
    mTip.textContent = '正在获取「' + s.name + '」的播放地址…';
    resolveUrl(s).then(function (u) {
      if (el) el.classList.remove('loading');
      if (!u) { mTip.textContent = '这首取不到播放地址，换一首试试'; return; }
      s.url = u;
      playSong(s);
      mTip.textContent = '正在播放：' + s.name;
    });
  }
  /* ---- 输入即时相似提示（下拉） ---- */
  var suggestBox = document.getElementById('suggestBox');
  var suggestSeq = 0, suggestTimer = null, suggestList = [];
  var SUGGEST_DELAY = 280;      // 输入防抖
  var SUGGEST_MIN = 1;          // 最少字数

  function hideSuggest() {
    suggestBox.classList.remove('show');
    suggestBox.innerHTML = '';
    suggestList = [];
  }
  function renderSuggest(list, kw) {
    suggestList = list;
    suggestBox.innerHTML = '';
    suggestBox.classList.add('show');
    if (!list.length) {
      var none = document.createElement('div');
      none.className = 'hint';
      none.textContent = '暂无相似结果，按回车完整搜索';
      suggestBox.appendChild(none);
      return;
    }
    var hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = '相似提示 · 点击直接播放 · ↑↓ 选择';
    suggestBox.appendChild(hint);
    list.forEach(function (s) {
      var el = document.createElement('div');
      el.className = 'r-item';
      el.innerHTML = '<div class="r-name"></div><div class="r-artist"></div>';
      // 高亮命中的关键词（标题或歌手）
      var nm = s.name || '';
      var ar = s.artist || '';
      var kwl = kw.toLowerCase();
      var idx = nm.toLowerCase().indexOf(kwl);
      var nameEl = el.querySelector('.r-name');
      if (idx >= 0) {
        var span = document.createElement('span');
        span.style.color = '#5a9cff';
        span.textContent = nm.substr(idx, kw.length);
        nameEl.appendChild(document.createTextNode(nm.slice(0, idx)));
        nameEl.appendChild(span);
        nameEl.appendChild(document.createTextNode(nm.slice(idx + kw.length)));
      } else {
        nameEl.textContent = nm;
      }
      var artEl = el.querySelector('.r-artist');
      var ai = ar.toLowerCase().indexOf(kwl);
      if (ai >= 0) {
        var sp2 = document.createElement('span');
        sp2.style.color = '#5a9cff';
        sp2.textContent = ar.substr(ai, kw.length);
        artEl.appendChild(document.createTextNode(ar.slice(0, ai)));
        artEl.appendChild(sp2);
        artEl.appendChild(document.createTextNode(ar.slice(ai + kw.length) + ' · ' + (s.srcName || '')));
      } else {
        artEl.textContent = ar + ' · ' + (s.srcName || '');
      }
      el.onclick = function () { hideSuggest(); pickResult(s, el); };
      suggestBox.appendChild(el);
    });
  }
  function doSuggest() {
    var kw = mSearch.value.trim();
    if (kw.length < SUGGEST_MIN) { hideSuggest(); return; }
    var seq = ++suggestSeq;
    // 立即本地过滤已有结果（零延迟反馈）
    var local = lastFullResults.filter(function (s) {
      return (s.name || '').toLowerCase().indexOf(kw.toLowerCase()) >= 0 ||
             (s.artist || '').toLowerCase().indexOf(kw.toLowerCase()) >= 0;
    }).slice(0, 6);
    if (local.length) renderSuggest(local, kw);

    // 再异步向主源取更全的相似项（4 秒超时，失败静默）
    fetchJSON(GD_API + '?types=search&source=netease&name=' +
      encodeURIComponent(kw) + '&count=8', 4000).then(function (list) {
      if (seq !== suggestSeq) return;
      if (!Array.isArray(list) || !list.length) { if (!local.length) renderSuggest([], kw); return; }
      var mapped = list.map(function (s) {
        return {
          name: s.name || '未知',
          artist: Array.isArray(s.artist) ? s.artist.join(' / ') : (s.artist || '未知'),
          id: s.id || s.url_id,
          src: 'netease', srcName: '网易云', url: ''
        };
      }).filter(function (s) { return !!s.id; }).slice(0, 8);
      // 合并本地与远程，去重
      var seen = {}, merged = [];
      local.concat(mapped).forEach(function (s) {
        var k = (s.name + '|' + s.artist);
        if (seen[k]) return;
        seen[k] = 1; merged.push(s);
      });
      renderSuggest(merged.slice(0, 8), kw);
    }).catch(function () {
      if (seq === suggestSeq && !local.length) renderSuggest([], kw);
    });
  }

  mSearch.addEventListener('input', function () {
    if (suggestTimer) clearTimeout(suggestTimer);
    var v = mSearch.value.trim();
    if (!v) { hideSuggest(); return; }
    suggestTimer = setTimeout(doSuggest, SUGGEST_DELAY);
  });
  mSearch.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      // 若有高亮的提示项，回车直接播放它；否则执行完整搜索
      var act = suggestBox.querySelector('.r-item.active');
      if (act) {
        var i = Array.prototype.indexOf.call(suggestBox.querySelectorAll('.r-item'), act);
        var s = suggestList[i];
        hideSuggest();
        if (s) pickResult(s, act);
        return;
      }
      hideSuggest();
      doSearch();
    } else if (e.key === 'Escape') {
      hideSuggest();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      // 用方向键在提示项中移动、回车选中
      var items = suggestBox.querySelectorAll('.r-item');
      if (!items.length) return;
      e.preventDefault();
      var cur = suggestBox.querySelector('.r-item.active');
      var i = cur ? Array.prototype.indexOf.call(items, cur) : -1;
      if (cur) cur.classList.remove('active');
      i = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[i].classList.add('active');
    }
  });
  mSearch.addEventListener('blur', function () {
    // 稍作延迟，保证点击提示项能触发
    setTimeout(hideSuggest, 180);
  });
  document.getElementById('searchGo').addEventListener('click', function (e) {
    e.stopPropagation();
    doSearch();
  });

  /* ==========================================================
   * 【整体形象】多引擎驱动层
   *   支持 4 种形象来源，统一接口：load(cfg) / setState('idle'|'sing') / tick(level)
   *
   *   ① live2d  ：Cubism 2 / 3 / 4/5 模型（.model.json / .model3.json）
   *                依赖 pixi + pixi-live2d-display（自动按需注入 CDN）
   *                把 AVATARS.live2d.model 换成你的模型 json 地址即可
   *   ② spine   ：骨骼动画（.json/.skel + .atlas + 图集）
   *                依赖 pixi + pixi-spine；用 singAnim/idleAnim 指定「唱歌」「待机」动画名
   *   ③ ae      ：After Effects 导出的 PNG 序列帧（sing / idle 两组）
   *                结构：{ fps: 24, groups: { sing: {frames:[...]}, idle: {frames:[...]} } }
   *                用 AE 的「渲染队列 → PNG 序列」导出，再把路径填进 groups
   *   ④ builtin ：内置 Canvas 矢量歌手（零依赖，任何环境都可用，作为失败兜底）
   *
   *   联动逻辑：
   *     audio play  → setState('sing')  → 拿起话筒 / 播放唱歌动作
   *     audio pause → setState('idle')  → 放下话筒 / 回到待机动作
   *     实时音量    → tick(level 0~1)   → 口型开合、身体律动、麦头脉冲
   * ========================================================== */
  /* 蓝莓酱（Blueberry-AI-Pet 桌宠）透明立绘。
   * 这里以 data URI 内嵌，保证 miku-player.js 单独引入到任何页面都能显示，
   * 不依赖相对路径或额外图片文件。后续要做真动画时，把 groups 换成
   * 多帧 PNG / WebP 序列即可，引擎接口不变。 */
  var BLUEBERRY_AVATAR = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAVAAAAKUCAMAAABlp5DUAAADAFBMVEVMaXF6jZBKXF86S017kJJleXtmeXxyh4qEmp1XZGxcbnFHWl1RY2VhdXgtPkI/UVUnNTorOT4dKy6Hl5f////75tz9//8XoOz55NoSoO5BRlcXo/H8/v0DAwP85dn//v75/v+qtsn+//sDBgsfqO4TnegXp+2ltcz5+/uquM+hscgOo+pFSlseoufz/P4Oo/Qfse4sw+ysvtSntMURoeKzwdMuNEIdJzAnrPImuu754NWwvMwHDhD9/PcoLzc9QlGYqsMTGyAWquYwz++j6uX19/gNFBgkquYcIiYCCxj508Y1PUn52c28x9O7y94hfrC1xdox3e0Qlt7n7PEcnt3s9Po22/MIIC7EztncoY+Vp7oDFCQWrPUMj9Eth7Shrbvf5+63wcw5yPBKVFrv8vP27+sWmtMQdqf97ON20t8MerUHJjz949MaiLr05tnT2+PH1OM70+gvgaX+494oNktHW2YLhscun90gc5o1ODonmNHzzr4mt+SF2t8JMEqS5+Q1ncYgj8Wv7uhHS040m7d0j5Efn/OapK2NnKnf4uJrdX4jqdkhp8ZF3u/V4OvQ1tmY4d1YW12u5N5YcHustL0RTm8YNDo/XqccnLmMn7Y4epUUYodvfo1Iw+iCkqZpam0JPWQsP1cei6grbocRP1GIjpS/w8QkYHQ7u/V6h5oquNALZJ08qNTIycslP0O/6+g6suQ+jrIcSlwHT4Py6eMwUme2ur2rrKs8wN399e7Wp5k5TFnM9vyiutN/gYMxS0wzKiiXmZp6mZsuy909aXtCip1DQUBQz/HwvavY8PVQv9Th+/1T1N8cDwtdgoqZiYFktstsx9XSz84/nejMmIlLsMJgvec3jsbIsqjesqOFdG1s0uvu3dFg4/RTqtTj1s1KXZjbvrCsmJGCuL++oZhcSkXjzLvz2KJzXVS4iHd5p7NSmr2h0tBXjaVONCqFx9RWpa249PuF4vXsqpOe0unMw7oxGxOYwr6e7vs3bLekeWfXkXOSZlBxSC/2szX3ynpHAxPkAAAAFHRSTlMAa2iLNk2NBxz+rrfbzuPcpcbktgc6yNUAAAAJcEhZcwAACxIAAAsSAdLdfvwAACAASURBVHja7L0NVNv3mSbqJP4Ap0nqlJGOIlEk9IFAlnBAMvgKsGErBMsIOPq4aPmSCEScwLCwPgVhjcvAOgEBGVhqkRMCARob2xSckNDipLFJPbeN12U6bZNOPB2vO3fmzuzpzJ3dvfbJdN09Z8+5z/v+/gLh2mnapm3SyR/wBxYGPXo/n/f5vf8dOz451+f+5W8uJOH3pB2fXh/JtfOv/uVzSXv2fArER3Xt+dzn9iTt+dQ+P7or6VMwP70+vT69Pr0+vT69PlHF0I49d9aW4hPxj0+vX6ki2imupKSkOIhJOz7F9ZeyzD2AD7Dtuu/+++9/4JEThysqKg4/vG/fvs8+cD995v77d39uNz8iiR/9KWIfCCYBdN8zex94YN/horLSAq22tOzYsbdPNE8kz83NJU80nwC8x45VHP7sZx/Yu3f3fUk7fj4wfHptu3YDy4Nlxamp2rK3J9YXLpx5Z9jTYpSlqVQqo7FluPN8bGhhZOLtouLi0uJjJ/Y9sHfnp2Z67zR0397PHswr1aaWHptbuHB+uMWhSuFLBjhlMlmKdKlbht9Zu5xcVJqqLT6278HP7fk0mCbCiHiIhAN2Y9eJR4sLUlPLJi4DyzSGLg1mCTDT4peK/8L/pHIMx9ZPFAPTvEf2fopoAqCC2dj7yKOlBakF35y7MN6SkkYmqRLopaXceUnQ4k/G4bX1E2XagqJH7vsU0gRP37HzocNl2lRtHqEpS0kzOmCYaTBPhi7lrhcZK/2TgzAtLm3e/Smim3ju3P0wPL30xOVho6rFAR+ncEkmmPbBgHIwMKpSZJ2Xi7TNu3b8fBuw519fCYDgufOBIspCFzwpwstl5O8EloTo3QHlfwX4KUaHUSYbKi5+cOeddn+XP/6rMM83CwqOLbwDDwc8nIJUsi007wA0bZuNplE8xZ9aPLEibfd9CeUTAvPO+6gzuO++nTv+1dSqSOx77nukTJu3Pm6EoRUWqhKvu5rmXc01zTM0Uppa9NBWlb/nvoce2FdRlJeXV3Tw4Qd279zxr6OnStqz+8GKguK5NYcKkTM97R6AJtrp3f2/cyFZqy04jM5J/Lc79iQfLCvIO9w8ceJYUVlZ0cOf3bv7X4Pv79nxYF7piSGPDGEwPT1dslAZX4mAqhIq0bsCGowtlKGCLT741oN79+7C//zZ4oLSuXc8nhbP8Pja5ZETRXlF+z7ze19Z7dmxuyh1JEiZXZVuNBaq0j8AUNUHACpzeDoXRtbnjhVrS4vzHn1438OlqQUTw1xVpciM6ADOLzTnFeft+8yu39/Kk2Pa3qLUCymOQpUMHk8JKT19E1C1Wha/VHcHVJYi/koPtsiCFy7EYoGF5KLiAjAqqalF76QYVelpKvov8ShZyzvrx4qLiyZ2/v6ZadLOHbt20m9JSQ8Wp16ApxdSbler1arCwnSCUg0qRM2XTCXbfiXgKZMxwvR4tcViGb9wIRDLtWuG1icq8kpLF4DnZuDlPxiHL8wVlZY170UFsOf3q9Xk3n3PnqSd+0pTLzOgXHduAiqTpadLgMo+FKA+j0Xdcv5CAFdMY48FhtYXOlUOVVpiiWVMS3N4zq+/XVrcvfv3Lj+huEHBdN8DeampCxKgMEkV/FM4OzvqVjz9IEDxeF9wvNOiVrf4yURzcwHq2plhGYKILAHPFLxkDmOKanzhWEHRg7uSfh+qKNEH4iMJ7v65vY9UFCPYjTjSKX7i6RoBKdkkPjjl4xcCVH1vQGXMkVjGXE2dcHpZiz9GiGo0sdhap9qoSrBQ5lLwAjkcKUZAWlyBlP8JN9IEyjJp1469Dx4j2hMs8kRnmlFqNI2quJMToAwpm6j6nhbKmPv8TU1koUa1Y2wtABPN1dhdQbXRcQegaPv5Sne8s3Cs9K0HPslV1E4KmcQef3bvvs8+eN/9+8qAprb0YPJiNDCuMop+k91eSkVGhFMJUAZ7E9CtPC8BapQFXTb7GABVG40Wjz83ADzX/D620M3KgD9SBOtXWJhmfGekuPjN+6nx3fNJNc+HHnkUneD+9Yq8vEcfLdeW5z02Es2t7OrqCgrINgFVUZaxqI1ULskYUOMWoIkNKcomAlQ9ZrM1BekLVTBl35iLPd4iu2szQIDC9NNSWi6cKH4UZWnSnk9my/4ZUPFlh9cvjJ8vosFb8f6RqMbeZM+srq7uRPSUsY2mc2IiWC2esWCLWsCrKlTdFVD8gQBVW7okQMH6IQxbfJ2upvMeih1p9wCUAoXR2LleVPbWrk8knZS0t6JUWzx3xuOABZ3Qlhc/tphrsyHUNdk09mpXUAZAxfMEYqDk1JZgl8vlH/MxoumFCR7/c4DiwV05mU0exhMwcVHa0qKWbU1N7gQU34m6CJljrbm07DNJnzi2c9fu5lJt2dx4CvIMnvBC8jNDmuosVOD2LouPrGvcIaIjAE3DL6jpfV2VXZUuV6fPQoCmJxRPPw8oQmh1DgMKMydIjRSDU9LS7g2omvnWFpVxeKGs9MTOT9KEDz/p/cl5BcfWzxtTkGMKjRZfrMlmy8nKseVqOtHeeFyapjNBGZfydHHehoFW8tUVtHAJdW9AC9MdsdzqHDtbKKYmML1Ch4MS/L0B5VBCD0xPaYmdKH3roU9O45S0Y9cDxwrK1t8xUmWdBjZJbXHlZmTm5Ng1LiRmpB/PGTssVa2S8ISJqoyWqxKglV1XkZ2IhBI1vEqtSiguCVxVSnAIgNpQJaEmICsvLJRRTgNcabK7cqdi/sdEAOx0PLkg7zOfkP4ehdL9J4oLJtaMgltPYUD9mpzM6pzcpjEHUjispTOW6fJIgIqyRk2AEqRd+M1jUVEjlbYJaELZRIDK/EM5uMYSAEWH4GvBX1WyewyjtqzWaEwZHikte2TnJ0FTjrrzgUcLjl0eTnMIuQIsFB16sMlus2XCPoEHhTNHU6a9UzJRfqbI9Zs+X+nv9Fi4TCWofx5Q0FRrgeqc6swuwQMQoMhTPv/wBwAq24oC6SqHzLNQlrdvd9InAM9dzWWlc+dVCGgqAWg61UWWzia73e8xqgENeDuZukujQRnOQZTLb0pCFk+wc9zvJyMd81m2Abrl8mSysmAAHl+d4SJDTqPMBuYKVs+A3mO6l3AR/DLHUFFZxUNJH3tKaffL2rzLX0txGKmBlhKCEenH13ne75ER/5FOVmQcs9thopzmJUAR/Yji9AU7uyr9SEwWSvaqOwGVMdE0HtDA4zM0FjWCZhoBCu6pKRb8AAvd5v2U7FUXioorHvqYh9GdSO5vr6WnO7hPT5N8lAtOowcGmZbOvaVRANo0buQOXpRChVw/wU4tnbl2GxKTRRCj24UkaelGynEBe05OZlbAZyTmT0YBQz0Wa2ohfH+xidIUC3UvbLTgrb0f72I+ubg0eZwYjq2oJ7EeQAZWSyGvkDKxbEyDIn/Gj+qe/oktlLp4WJjaV5mF1rwSxROCrJgwJ1qXA+auyaWclBH1OVAF4TshSvv8miafupBC9L0Hp4lVldHIiO7+eDJ6ewSepaXrHi49EwHlojI9xTGGKkdFNkoQwkJt9pMLPoeMbCyFanuqR2G9lk5NRlZWIBClut1BnVCiF8O6YIy59swMALqIdosBRagYs2lcll8OUKNqqEx7bGfSzo9lrZS0Z2eztnihJQ3qJPb3OKCC6FSleOyEkCyN6SR1p81ur1xMdhGtTPQc106csHw2TWZGZkbW0MxCk48pFGOihSIJjTVpMnHlZMz4UQKJygoGqvFT2fDhAUWUdywUax/etWPPxzS9F5RdfhJZN427vDsBRWbWEJuhYq7I4YeBVteejAKydGnmJuOpkqOL8MR7lys6sjBOc7xEQPFo39CQPSszB28jMViojFS56qA90+6ycBb7hYCKuGwkUUDLemnBw7s/hiX+zqRdj2i/eeENgSc67M28LAFqpFIHNioT/FKLy2az26pnRlwpxnRpisljurSghswvK6PLM9YVG5kYcgBD1RYmsNDOkYAmCzYMQIdkQsADujkBUKHVuZuaR1JEMqAOqkSMLevaggohPvl4ufyuhwu+uUbVEuwlkW1PkybCqLtzc225qBxVFAU9LhuySuXsyYVgmjFd6jHhuTJjUy45PFp+ta+zy7XYjDiJcQkwEn0TFfUjtkBGVgbMeGTR4hBZy+OCxTdxXaCS0qC48J0leO8YU6mMovr42py2IG8fSc72fOzwlDE/tu2nVjFpRFyPxWcP2DJy/bI00i0GbdWcp2dmhlrwIKPki2pZMKbJuJSZ67eA5fSNdVVG94+MOwqNcSI+RWXxXI5qcrMI0JyZk0ELiU9Ujk7KccjyEqAqLs/EgEoluyugshR6UxlTxptTUwvyHv7Mx6qA2vlWwTcvOFi4sA1PaeIm6GMbah1NYBj0hkw9ZicLzamenZmB0xNaRjZRh0ujyUDFHkSsxZeMVVcGmkfwF5UsDijUIrFcjQB0tntcZqTK1OPKQZJjQNM5SRGZjL9wGay6O6DiQnw+f0xbqi0oPvixEe/uITzLLhQ6mOu9A09m4QSgYJxstljMowad12XPYUA1M7MLQaNDiJapp9TA43MybD6ZkSgA35itMrZ/RGbBKFjKzZ4AWP8sAjQjZ+rNWAoEfEb1OL08drtHpqbGi8KoAxy0zzPcgkKXvjL9noAaHSlnylK1BdrSgryJ+z8esxGqly4T32ZkujdRSrMFqMXiz83MtNkDZxDpfC47IWqzVUdn4fR4ALeQanVXLhVEmZUMKGzM16Vx1T4202IUQSHF2DL+TMxuy0KlmpWVk9W9CMDov8vMuZSZYx+DgUpDPsxTujRDC2syESu28dWJl9qBgvQyTba1OFxSNrHrY1CU7uwuKFhvoamiSgzYZLItdaJRlQAoWVFsaJxyEjpPGwGaMzs7ErAQ78ukfXVWDkpQm83DYRCwBO326tmKyw64NswY+rChGXxlZgYhmpF5MhkkCjEvl3JyLuVoOml0wmUubLsyJyM3uoDSX8WA3h1PGTXJaU9OaN/+JqbbmHvlTfzO01PSZ0pTJzxpxsJEp1IbpYE75uZUpWDWa+kiQsPeNBQNgs0jBh9+aqvOmp1J9quN3HQitGZUZ85GK+2dxDCnk/FRdbVYcQEDd+q/HOMjURsqUBQCR44cuTSbPCbzkb0Dz0s5dv5/Cpm36uKklzviio+Z7o4nc86qtDPFE2fW3/4uIIWs+oGdv8saas+evcWpJ4app0zbFusJSkRLSaq0Bai9KRr1eIgeBZwANHNq9iSlHe7i/eh/Mk8uVtr9QYuKBTcWP8xYM/LYGRnadgAaOKnhdJZxpPbIkYxasAEWdJ1kn2BLXD40Yuk8ArXxozJnF/H/MP0iu9fFXX1z6YWU4QsTOKqjLSjbd//vrtKH2DNPe2wthR1+m4Wqty6aoYGNE4nIrrFFo2N+O1uoLae6unZ2tnvWSHBRuwMQupMr7U1dPq5lkcrwOVtsYm6YxpaqloURENXV1Vm1uGCjszHAV5nJGQ7WH4TCkYhqGwUTgFx9ZKQTjUF62j3hZCrL+M4J7TE/wu7aHKIpzj/tuz/pd4Xn/Qe1pZfZHbfHegvC3XAwCH0cO7zKsZnZczT2mZkuVw57vI18fnbmcAyOJ/N1IWvZNG8+l1Vtc3VZJEDxEJt98cRlBwXV4MgivQpTs1MC0GiMDPSSBCiCKCUjm60Sk3/xucUhYrLSPghPVcraMahLmy0bPp9nbQJHfXB095HfSb5HA/9macGIZ1OPtAUoMsWZpqYmV9eYx0jab0scUCRjTW73iL3axmkevwCd5IrzKUa1x5ZDCWek5mS1LdM2Bml3iyfoh8yksjK2vuABLS9rGZqqzrk0OzM7NTVVe2TqyFCTD11njkDUbneB83fhBcgReGZcqq5d8HwgoBRCHXPAMDVvbGMDHOzw5ROlyPmlj37md4Jnd5l2YjiNOhLjNhWiWuZxNYnL3wlm08G1p4hrOZm22jdP2qi3gePbbPD52cPNw3gJNJl2oD20P1mDr+rEceSWFofPwleLBy1RoTEdALuiySOz0ehULax0yO8LigjK9p7rcnH1QAaaaW/C53IX/Cnpd8/xoqyDEwyfSC2oO/3C9790cwNGahm+/DLSfUFZxe/gKOkDZaXHzggSeHPaJjpoWbCJwLIhnVdX0oTI4YAr5oDCgMvbbdGKmSaqnOw5dtsRADpTMeMLuuyQeQ4F1po6ASXNMxMUYqI9R6B1eDwuktgO4YoO2cc2kOuQ4WGTZJm51VQVwDyrbbbOFl9nU9MsOuL07cNlGqOAckijlyhdfbXLNZFaM90/Gnp++QeAdOPqxpfX81JxZP/Ygzt+q3IIrGB4C4wyFG8snNumMkhnQPEk8Utlta3T53CQXoT8MoeozOqRg7VQ5NAgI4cAXUw+DOPKzMh1AXwLib1ZloDLwQSeURQLXPyzB2D05HdpXEFLsCnXRumHUcxYRE1lj85kVFfThBV9gT06RLPmbcyTTDB4RNumq4KQma0X1/y3/oGGnrbWp7908+JFgNo0V4yqtLT5t6onxeHC4uL9cM7xYeQeSaekSpfKPsgN8SSRXaqBqB/p19flqiYTzcxEu27T7O/mnggJOossdHHWprFVjl31ITF4PEFPMDiGq1NcY2NBj8cnyR6YcmaJrgX+aRluitk1mTYB6OLXM4lxScb3JWmjBXAHFoIpVHBtA1SK85gIDDdBTH5+vfz0q9caGiRIN65e3bgaaC5FUfrW7p2/xe16SRUFBwOViISxpk6fkNBJF1KUx8+A8lXpApnu8yP32gjQTJiibeorizkZhGfGFFLMkQyy5bExykBdXX6Xf+vq6gKiQY/PwS2PaKmMQtCE6szREhz3N0nfKmum+1LOJZSolTYbJCrcutoXz4BylanuUEGLxImYoLFrmlqGu+smG0MNDGnv99+/ePHi1Y3OhTz092XN9//2jHSvNm8B/pyj0eTG/B5id1VS0wkXhYfH4YT/QSbi85Pz57CFaoh7685BA1lL2RqVJinyUO24pMvvciVgCUNkt6ewUigFafyRtUpUPwTB86EwyDoyNXUJ8TQDxZcfHEyhCibqWoDPG39OVs72GXQ1Qb4WGy5MG/9K3WoIiLobGtp6e79/cwOIbsROUJ3/1v2/LRVU0lvlzahYLl3KQGqGysbHbZHDR6p5B3K28PlqF5voGAB10bOejYLZyMjNyKmdOXKEiskMqkbRQAkEx+Hh4+Ps50GUsZ4Wn49134ildAI8LU3MRoXYm2SfRhorO0Cd2nJrj2Thp7mEvtRW3Ql6BdN6UPlDCx76wkSX56YY4+qhAKoKjR9dblogr6Z3YKDB7W7oqeqd/otLFEgt4yNlcPui39ZhvD01NTP2DH4GGUjPua7OIJ59y9D65SaSKUhBVNioa9wCl6+srM5ZnJnKyqUJBtgNZCUNzedd48NBJHafAxEUwDm4UFJLJ5Es9BmjmiuJOGuM+Shm8SyjZWm5mswUkBJhkkUxBa0rEU/o6js1iyBNjYmAco7DFwSG6Ps3eUh+4lusaz/VOEBOX9U7X/PyTCUCqcUz9DZsVMjIfwuA5tUs2mATFBUx4MkI5CJBjfmHZmea989oPEFqV6hy4tzk9xGgcHnkn1rgnwkXx9MJxJrGgy2Entg/QJQwsFNLLkqf4fKbcj5KKZU4G2pMT9sURUkxRk05aqwSryuiss3lZyUa8VXBysUYJiuJgKpYTuHLhX0C+3Hq8xzq4Eh5+wvXehp6Oqb76upKC16uRQF11dc5AUQLin4rROmeN8uTeZ6bQfMd1OuIjfbq6typKEjO5OTFgN3mclVWCr93eQhQ1J2B2cVoFp2C0WBmB6N2UDajbQL0TFEloTkaHh9/50xs6DJdQxfWzo9LgZQyOz1Mls55T5XAuwo2idr4ptyMLAhPfFS4EqCermiAapCEGErzTovPNWRDtLU3tahIGeVI+dpEed8LjQNVk33Jl8+cGampOfllGOkGVGVAlMSPv/lrd15eFBJaxjMj45KogjIhrK2dCtRGF0dOzswGmvzC65vGLH6Iju2ZmqxahFAG0+OTqk1GyUE7hBbW55pPHMsro6ObqXzB48qKKg43J8+NrF++cGZ8uEWdIrA3bp4QEe0EJxoyU7SgY5TAyJhRreUGPNvFEhh4yhA/kcXQTnVCvgMDRRx9pxmITs+fHXrnb55MaRl6ua77n5GaHE9eeBuIFifv+i0ow/bVjVTHAUVukhCl9yOBLCA3e7J7JGpn17d3UR3K+T0DcdM/BqkTwqORlWJPDp+/sD5xDKduyqWrrqwYHLoWf6+raW/vO326r6+9vaampv25ion1oTPDLSoWmHElxagWqqTzn/hfPV1N4z5VigDUMmYP4MhJGgcRCrxE18nOzy3YSCqhYQGfSu0gt/c345t9Kzp04Z03Ch0WV3fdm//z4kXfk453yO1Lu+/7TQO6675ded2VBGOG8PuMTIEpriOUHJDNa0/uPxm1V1eiHxyrzLTnQnebaavs9GD2Y3SQDxd+7Z21hYmiglQtQdc3Pz+5ujp99uy3uvOAZl37/GRvY/8yXf39z7/UOz15uq+9rq7m5e6F2PngG5yjKPiqMa5PU4uDuMhExuEzWAEF2RRR1EFbgJh8tmV+PMShQ4dnbBz3XR4+bkq9grEwpbOi/PDMyOXzLRSV04LNdV//f25e3GhxBE9iPFKwfzftJP9NxtL7uotGqiVAM6RLan+mFslOs1AYTc0kjwzZKTvl0nk3ja0riOMKlhZHIWie8dgz3S/DBE9Pnj31wtFXX22squroqKo6+sJrdeX45PTRa8srK06n06zT4VfnKHC91ngUuMJgv9i9PjTuMZLck8gucR5PnLJDw484POxgVR5EOmCrJUDfSMe5naa5/TM5/PPlBFF3SSemwGUNr8/NjSx0srYVFvtOc93Z79+86PM8iXMO2tLyg3t3/EYPi+58oDQveg9Aj5ycqs60ZR6pJVJoZiaL+flMhM5OnxFAOvAMHeNDI1/p65s/e/Rp2OAKrnMrzoaenp6OtqXJvsn/++jz/csEpg5XPV9Knc5sNpc4neHItVePAlWA+kxT0AicSAai2txCRrWB0QNIaSpl6YoFaRgqEwoxmeeZiuRori2LcmiXj0gyI/X0NKXBq9BEHQFNUonbcr1V863v34bXP/kkhHpITff/RmcjSftTDyKyZ26huQloZtbJGfDo1Zm1oNmmaqMYW4Cpy8oFD88FZZpj/MLcwZr2+VON/T9eOXToQPyyNvQ0NIQGljqWf7ziLCkpOSCgzBe/DQ4OAluDQecMh999991rvcD0uTefOTOMCSlXqBxGReKHmQ5TBkP9HhtTC4ohBdKU8eSiGdTBiD2aXJL5p/FAlY+hoJJAmgSWhSpxSlIWy2v/9g9ub7R87UnfUB7YkqK9v8nhyIOl5XNN3JtnMKRZAtAMfps5WY1oCUCniAqmeYem1j5GM1scfxkfmjtYWt5+9mg/7DI//8ChA4ckUPP1br3ZrHMeco7GsRzMzyd/1+XrdPlKJdmroaTE6fWGcS1fO3p2vu+57uj5FpjpG5yELOJ0I3X7LcPDHofaszZOgKbTXEm91tw9lXEExX8O+uVOUqhLE2pMtK4GxzzIk9LBc3qBHM8Uz7/6gy9cBDXjCbyNEV5e8m8E0T1U5u4+qC0aaqJQRCBm3eHzi8moSUAkRacAaRbqpdqonZyzMP1rF+aOlSLfAM7R0RJgyIAeP378wHEgCryAnK6EwN26nM4DB5z5Zt0BGKcZQcDAIdUMQ11e/n+PTs/3fTE55uE+Cq29TEyzqU41one1WM6fQcvPB9Bk9jdnjmRRu5uTmTsUaxElbCFpG2WWq8GucR/PTQuJ1OIT/cPJdWef/s7ti1c9wZa1E1SQ/gZk+VCCnrz/vmcOFpTPUKtBc7UMiA4kz88UAM+ePII8P7UYhc9rbPbc6JAftLuqcPh7xwpSAedk47UI8CTggCdhefyAk3A7wDaI3+thmTpnvjMfUObn45FW4FxSYs7Pl8PpcZkppCKeRpaXr033tX9ldtghMDVKcgCq+qlrHT7TQo19oVHtT45moOPPIho2d+GMdHaZAFQTw9K0eTBFArTQeKaopverrxOiPk8TmP3S4uSdH/nYA1tRi4vAbSXbeEpJIOZwkZRgodGZIxkZtYsAdAr5vTYq2vvYXBGqoZrT0y8968VlJjzZ2fP5ja4SRlRHaLIZwnKF8+NTwBuIGqRwOsgPpDzlNC/398739Z28MPwG+WuCIIiyv6NzmGRBGFpFo2grjhyhn9pWO9KJyQycniSYmO11VmpIESwApc0dVD0Upvxd8fyzz/45EEUf6pooLSgt6/4ovZ5OdRUUra83l6YWz9ltLHsF/wgmPisjc9PnM6huOpJxZBG8MeJnIBoDZa8OXmjOKyDj7G0ceD4UCrnpKiFAD9VLAbOeET1AeOYzvmyz/I8HnJGqKtSkTmfJZoLSSYaqM3udK8tVcP03L3fyIefNGRzrFltaVGhX1bLALNFbtRk80VucQT4H3IQblBFj1bm5YxaLEA+xyFXFI5cn52qmv/pV8vqNq77xueLSUmqaPjpEdz6cWnbBiAOoEyPwd+TxzEwSf9SiL068kI2ysoBnNMDejrbIcWEC1THgrBoIMZUrLjcFUH6Lm6hITgJQcvj8fMryB1aq5tEs9Z2tCq84YaRKgSXeBmGiiLsEKcy0/SsLWACHQ2dxQHmRCZmsUR38s1ma7GUxZ5PbvWAh1knABp1fVgBBySg4Ai5g1WCzMXlaO9je+NVn3yMbDfrGRkqL2es/KkR3PlJQcLmwsMWYEjxDBnqJOh8bHHw2qzpzMy1lUE2fRcPerJzaaKAT1ch5DGkA59ePCtskKK3WkhKDDjAej2ckxlHHiNYn5iSk+dHW3sm6ujLUBpONy2EvlVQlDKjTzNcgp66V5aPz7W8tjFuM5+eJOgAAIABJREFU8V0wqjRmqCgMqGMzszTPz7Fh1o8xYYA8njybJP8QSNqDzJGr4ud01HwI0tiyUDe57Ay/d/vmxatBT+cIdm4Xf+YjslHSiRTMUTrFjzcWw4wNXDs179WBxZnZXGJrM9jzUePl1sLd0c7X2sZ8vvPriJ11fdMvDUQiqDMBpeTfFEIpiIo46oy7um5bjs9HfmpY7Z2uKT729ttF5TWT18JmncFgePddVFAGhpRirlwud+OPVZOnX/uzTjq+g9ydZpTOmgFSdXSExvmZ1U1NMNGZg36ZEPCD+/NHczNyz7cIDlEmkVcsgsCE4J3Hao6uOEevxBGtKy8om/soEMW0alcRdEzp1JWAxvHnsiYREyKQm7boyEwtYoAmgzHN1GRAhpA1NZuLM3HDl0HTAs6jETh7KOS1lkhxsX4zyx8iPA/oCE3GlD+2ooBBZx5oQ2tUV1zUfPLlmvneZaeOwijBiqxE3i+X6/lSePsbJxFLh9E7kolt7nJWqQIji9GpIxgfNFXnaLr3B9McvNgMvehMrsumadkSCyaccMALM1QzuXzcOQqvv0hen1xe8N2yj6J6QoKfKCiLpVAlQqxOp8bONROxtHbo52dOztTiU3TogImSS1AwaMY8wbWJUjj72Zee5Txkpe7nQL2h5ECJFC/ZRoWJSkCKd/FnHf/tQEl+ODyAirO95rVvfb29fbo/DER1OpGaDGaCkiClD9RRcPzugCeNhLwSbQqyQ+bRLC5OVVeSx+dk7R8heT6eiswXmwlAH9EFgUtcjbkN0LRgd/tLaILD790kRDf8kG9qy/Z+FBa6q0g752E8cc51zJVJDFiOmAzTLCM6M7JYmwuANZk0alo8GbV1elzr30ShNN97zWs1WeVSMq/nklJcBw7lHzrgLLFaDxzYRFK8c0bSlaCeF4/0eiMDrZPt7W91v4VIGjbjvxl8F82owbQJJ116vTdyrfd0+8kzDloshgmyEEoYMWCKBmhsAEBr9wf4lJhFHRwaGXLZNV08B5TOPCQAis4pJdA+v7xyQIqjY1f9E0C06P6PRKlctEZ+AbkgRkEaKo/ZQukv8HobIikldpjppZysk921tq6uyxXw9vnegbBZblIIME0lJSarFWVoiC8qSBEJ3FbdgbiFEpb0TpVnPlwa1kx2Df82eK8dBaRvfr0Pbo+0NMhur5D8nfFUZCv01lCkcbr9izPjKWl8hJT16Ubq65swUiWJyWzyOEIoCnr/THItJSkwUhL7H18UJfQFOJ2XNpzc3rvirHcuX795kwpSstGCt37dMLpn5+6y1HVIiVs6cWrAxjUTQ0pDMQ3N22CxOIQwMzNba8/JevOLuS6/PZlIzemXQiUmk0KZT35dUmJF1RSSLgEq5SmpXOIQ6hRR1CncXmemoMuvhSFbZw73w6Ff+1Zf36kw0pHOoFQo5INb9inXK7KzTSZAenS+riLmSGHShHyXik7LOCRXJHxanPFh+ifz2ffvz+2CQfh9lvhJ3e2AqomBDuTNLyPEOFeA6CtXxzaqXy4oLjhx36+5QTepOfXYec9wZ1OMgiepaDJtGVwkUxDNFDkfzRGsdGixojvmWlt8mer41v5RJHUDYiXKo9HIQEfHQGjb1dBgdXJmP5AIp9TFo4yC2xvikcKglAPSVrRFNe29kTACAT5Dlznu72SjuEzucKS3veak35H2hjQrFaLAJhKwZM4MqX04VoqfM6sSyn8cO1Fv3w0naYpgobLCwq8ltx914tt7V24Rolcv/s+i0uLi5l2/FqB7dmObpL9pLQb7lKZHaIiixHNq2EIheyM7nV1cHDmcNxdrGuquqWvvm+6IeKnIOXDo8eMr/VVLq/Pzq1UDcfsUfm+m5kjkJKeoOzcBRebHp/H1unoq5Z1mZbZSaQZWSE99UHgBULi9PNFC9XoTIarXm2GkNV+ZDaa8IfgOPhTq6CQVW9aiHfMs/9zBkUzS8GigfZbdHVA19VLpa89NhvGi6kZfRBi9+MrFi9Ey9N+f+bV2bOxpTj0Rs/Pavvg4LtM2u4gRkY1mRcCU4imSUyC5WDvSFFv8Yl1NH2Fn1qORcR5//PWvot+ep2u1IyLcnfB0e0tE4akzGxIJpq2qPp8be+7t8dIQWLBS1Ebt7av9x71x05QgpVhqYhvN1ruRnPpqkiFodBSKlUbEgmC5RE7tbCfqvuaKRVslp4FOi2qbwjXxnK0aY7yWk32NRMrqwtcJUWT7k9SE/lqCx73FxQsYCmm2hkdQd2PUAXV2gDKSXbi+RpNcXjriD5xsx0RoqaPBbTLUAyvnyotPgxLqO3vq7OrqEgHKeLrdMF8RPK1uN9XnTp2o0zdNVAoAB9hIDToD/j/YqDc80EuIosY3yxFF9WZ9HFCFKEj1cHtA2jhf95WhFqZLWGyPMqnLppmKjlmC64/NoogiYa7Noy4slN0TUFVhSqxvekWnrK83h28xoBv+CqT6vF9HAdFdUBEj4yTtjegvAWgtVAuaqcWTi7PRWjLcXE2gubx83R99s6aub7J1wJ2dXW+oP1BynJpC4Pna5OSpl55/dtTLyd3r9lrJpZGsSlCimvMFy7QdUe4pqRQVcRT/aIWdAjrvC6+1t1PXZCJA41leT1leXOT5+si1U+01yeN0rI7kJoSPb0wzFQhaxmeGJOl4pt9Cx6y2Abq58s0IUURh+nD3fL+Tvn+E6ntK9UPopbVv/eqI3ldUsGgX4w4Nt0Iarj7RrmPUvtjdfXJkZjEjKzPQXKAdGR/Jq6uBefa4rfr6kuOPH3Cu9K8StTE/ffTpZ0dHR71WgahVJ5X21gZhn7p85pe5+0ns5QX3RHm+xGAwG3QMXahjtb1mHgWpwSSXm0wm4e6AlxFV6BXwfIXeG26cLy+KiV1YTM1DD9HU5AOZyPkpB+x30FIonbXdnPXLJJVvIV4BpCX1YvsLywfqTbrRZTJRT/Dqxp/VYdL9yK/Kk+xMLigK2EnOkKHhC3DiHee2WKMUHUk+eXIGVMj+8oK5pu7ycrh7T4PVagWt8cTjzpVrk+017ad7B669u8JcuzmyHOmBtwMnIujIPr3m/E1A0Zjr77BSKZAaxMWAmtyQzQDRiLdEL1cASP0gIqmCAFWI3/RUQ+nD187WYbOM0aFmkyNT9ECHpaYFhDlkoS7s1iiUJh+qOwEVZ6VlmvbX+kvqDc7RF29dv0UWevHiX5RrU8v2/ooinT0PF4w0aXi8qUGW15CF4s0+tZjF2q+sxZMz0czo/tLSuaHm8pq+yd4et95gMtXnnzt3/Hg/ivH56UaaCYMOdpZ4UUyurg5QgYQe9ABKUwlPnYAUf4ID47dzCbEUaYvwRPrRsYUaTEg6iMvz18JeslHUS+T7cgKT8ZQAVeojy719dSO0A5Y37xBqDhZaBP0kIIdwB8yS2Acdn0aLg008vKNT/JjSf729ET5v8I6uRPpJ53xxo2sCc7uKX6m+37PjobLiKI6ys8czoGShADiwWEt5CgOk2trcwOGCgrmFL8I8p5fa3ArU1yW6c+dW4O8Idq+CGzaDHBrUlYyOLjfO97VGVnhGjM4SHs9DuHwJTTJFQighM0mfN8jdbr1OpyQjRR7yDizNE/tUYpKjelIoTPgkWyhDSoDC74Fo+Npkzf7zaTQGUYutui1B0p17/BrqkmgUmyaOV7H8JD1+cCQOaGG65Zm66ZX8+mx4XYm3/ykgOuY5g7mddl/Sr8SL7CutCIgMT9I5hpOIOo1mdhbqLEg+kZAC+1O1cwt55TBP4FlPDcuBc+fOvbi8ikaxf9kLsJBYQAiPLkOS1fvj5VGKi2jrYaBmAahuy+l1g7C2LRsVgxEG1K2XGwhwswGV0QDEh5P9XhMo0UEF4qjZrICNCguVfs+u1yvN/dM1h8/ArSmO8hJt6M5JtoNFuZgmW/isn6ShRJ0krYLmU7cMaKFsrWYehEw2fCS7PtSPQHp1uCWAc2LFD/xKIfTR8jmyzAy2UEaTrTTDHl0UgGZlDZ3Qlk7M5NWdnl4CnkpuAA8Bz/7V+aVGpCJdnG4LL1fNoxVfHnWKkVyJOyRykG4TTwKP63V8+hDjiWpWkJ56PUFKvq+kLB4Cosj1Zq9ZrySXp7KUgZQw5XhqylaE+3v7nqOdKCSFVNE2h87zZKTYjQu9usMzFhfzUygQItR0aYccn3EuHG5ubwxDbUGFsDWC6unqsOfqn9UVpFbs3vPLG+jevNJZe67g5KXCPpO5ZE3uSG0Gnw0+0o2lTck17a+dAp4NBiXSbmj0xSvvPT05+bN3qUfEsIKr8zD8fb4qHEYsFYBaQ954g4SAgHdGVknw6fWS2wNQmKWOE7lbIEo53GC1MqLTYapHRYEvV8jlEpx4hKihFMpBc7jqdPvCG4Vv8AZOEKEO/xrZ6DjG8+qWcb8kQ/eTKNBiVMU3bJA+igB9o3Ch5hQaeoNBSY1FaJnndmPJOCvS/SsA+tnyg7kANCuDc7wkCqPJca59cRbIHsnSzJRqDyYjGwk88WRAUKxcv/7q/GTHu4NK1DtOcY0uX5tErQPYqEI1mPPNDW5B1evyt1tovS4RUX38MgsbJQMFa2Uirz/d17vsdVoRR+UiO+FNvwWoFf/LYLbb+fR8zfqTgIZHImBGzpzx0Z7DTszoaOUePvxA1UUn1dTSoRYBKKnMUtZqXls2K0Flo69AmdJ/+yICqe0YDjI++MtvXKzQztk1GBVrGND49D2D1yosksNronnaghq0172EJ7UtCqt39Mr1o/Or17yosPGDwCAJz1GEgMZlpzTkBMyhBvNmuTlI7wxqvUhCVK4rOSPJ4yRy3EblcHgr1fHea+hpeyMhhFE9AzpIiLKFKjZrfuJLvNfma0aG2UbBPTlkwbVxrC8b70yxDLukvZCVlXRkopOPYGwCisHTG2+kB996rt9sAJZKEDQG78AymtBXrkahuyz6JVvQpKT7iwpmc4STC0C5fsrEqYva2qnZIxlZmsBhkh+ePtW71Ao8+XnqQys3Guenr4Xdpux6HVVLunyBZ9W7Xh07u7PEeSART530rpMEJPnKQeollfSvolePm6kbnYAolLKVVu/A9On51ojk9IOiuSdMBaxUS+ErlQq9+dp0zclh0q/QHQmw0HFtGCY6LHOMM6Ckt6bfq6u7PLTPmQDlVa88azbO1Rx1wjDAzyD1GcwNK8Q3Xx2BMvitX+5Yw54dDxQfDEgKpgRAMTLCRYBmZJ0sxxEUwrOtrcFrdTOgziv980vX0FSbUN+HnWR0JcefnQae+fkm4f9myMOsm0wIxVB+3/R7nRKZhgrPRJ+P22jIq2SiBG7feHZ+vgNNKFdPSPf0RhlKL7g8WKrXqx/MVpgj03UT4zTBg8tjH9f5taDa4+ETKoQnzqkwpEDUJ1WhJMdVi3UIQ3XT8B8CNNtkltcbQpiJjF3taobTP/JLzpIOpybbURmJQkkCFKpaoPlP/zSFYVzubB60xqdfmG4FnhSzUBHqvefCq0vXIuB+8BlJl+hcXgKeToMS/bkIqj0NJQSoM1+yTalqYrIuX2lQKgcpDCrJ5zfpOQnRhhA5spz6h1DVdN9k/6hZqRhUSgaqkDJUtkDUaqU/6kP90+3d77B+iQ7yB7GB0OJT8wmVzYuPrQSNDKjYhSLjPZpn8ibfHSTjNCAbKrMN5sgtcvpYHsnyfgkTRQg9qF2wC5YpUcwAC2VApzSBCkhCJntbW1vbeqxWrqcN3pV3V1cjXiv/XY+kpHMecIIi6WViUccyJgTQNsLaSTA6dXF33/R/gKhUKjmO6uKASkydAl7f4MXvCiUANVmrJtvP9ocHB7OV5PhkoXKpGqWH0wc1+XJvOLLUnjyOOEqnZwuNY6BCMSETIbR6863SBZkTryJOOD4yfqzvWj7iJ9koOgvMHkZRPAWvPgPnPPhLOD3kN8VFQxJtlyF5Pk01c45M0aB7dkqzHwH0tV4CtMfNCQnpwhlGcxl2SwZF+i6neaWDYirPK3U09XR620KAk6umzcjJWBoIFmqHAChjqNTdAahCDrUEmaCCAPVGqlb7esMIAkqpCdXzg+KXBCh6q3AENjqc/iSJbXA+yRUbt8jGXV2JiFZX+l2d6hRRi24B6mlur8LLKgAFogZn6McURccgIiv4ZRqmpM9q98dysxJsUyPp6o+Q+nPqSHKqhOdSW0gYKBze2bbUE3bHATUZYI/hyOpqf9jMVDHxTLr8hjYKpN7NhpPLe8mvrZyFlALRbRcle7I2yE8IOxOAN3sHGlE9hK30aEZwy0LpTQJUIXeDR5iumYOqDMJHkHnBprWxlCa7tP5Zsk+k+qBaKCQSAHWM1PWu6AGoXAJUN9r/FB0LXcvjKeiHNtFdjxWMaHIlLONvlJV4QJd15C/qtOXIR+TwIa+bn4XJnN/T2mBGJsYToc8AUKfz3elJZA4dK2hZCWZGReB1Isufk2h5qER0euGj0lRjE1B9Ip6MuBlOj+oJ9mnQW0vckZ/Nrw6MmuNmKY8DGrfQ+B+83uXpmpGv4aAHAUqbcS1NAc5Kmy7vYmX4nRaadrluGtNbNGMK+qnwMjojy6R+8KyXlmof/vAyx11FxNX/vO47k44TZ9lma8DWCTyR4HkCgYDZ04ZZktUU5ylMJp0Teq/WUauBAWU8EUFB25sl4oNNdBNLfRxXgah+m4UyOnJCFIASolZrfbYb5eh02CvfrJW2Wag8HgDwePPyZM1IIW+NBe/Uqen02zpd/i0Ldbmahi2iDt220TlWNxnh0owAlQNR82j/e+T043D64g9/Nuz+8oMihAoTzWJqhKXLWKOSO1Skhbp7C0+oDhSGA6G2SNhqYraXGxaTwemMzK/2ew9wRnJyRlpp68EkJF6G1jPDlDhsEyYqT/D5+L9ykQnEyUQRQg0l6B3kYZB5VZDmGfTKbIXStM1CFXpRtOJDma139k/WLDwJ6snCd2bCISr09OTr1eLgHx1Xl9Hh/23nxVLGa0AVMkko5x/JYLBG+m+RiV7AoP7lD3uQKalbu582diaK6Fm1fISu2sMQhgg8QdBbpXbGDfbYLE8A1GD1hlExAWQGtIS6ppUISOhQT2gTTcUdZuiWfP7OEEoBEmZHPAkQpZxkAmWhtEauIQ+CtsbXKJSKuE2yhSrkcctVUBk5+tLpmsu0WgaQ0SlvlKKdXICymbrocIVKKCQSAR2u6GsMk5JCAhQFiDm0QjsggnPIS81JH1YwUp5sj4voBSliZ70inc6mip4KprY2CU8YqNzdg2RPwSzBQr3hqvmlSNgkANVRSA23tmIo39Mg2M9t9iRioNutv0s6ilsoOzKc3kovnAn1KlL9NXwPL1WKgHQLQvHfib+ZCFFTyWhV38G1lA0GFIftoHO4Wi3hiV+pmSc1Y0oioLgdU3f70bBZQYUEVU8Erc4bATd61Xe+CJvzPuTpxZ0V5SO2Le0nYaohMGGeUxkUQE+fIjw7QlRymkyEZ5tbRyMyfgImGuqarM4IWQ+BRgEU1Ddy/lIHAG1rkOJmwrNXkg2SQwufF5arkHpKGKewUKqCyEStBhOHRhO8oHe+w4nJsklJLdYdFspmb6I+g+YiR9u/QssySS/i86N28nVVb5b2fPbfyOedtq2/R5oP67k74+oJfYXBEPpLykuWBSzSaf6QITSveNGWkI5yMgK81wuIZtVWaLU1p9hAB0Ju+nHB/vS09VD/bsomCQK7o9JgdbbOvxC2KrIH9eL4EQBtWxoYCAF8DhMmBb3FQYDLorsTgEpBM96j68XfBBXPmR6xWinHq2ki+mNylZg8EwqbOw0+PrQ3WUuAyWD/2Zrmv+FtLjIM7exBTJdFDUoH/LtwTJp2Pyeu1sBq0tm66YgEqBkMrJx72qd/QCY6/rb2w5koLbcrnrXVCtskRHlNGkOalYVxHAVQ+DvkSvzDwmZ6Gsxm/BHfDRigSIT/GcwdEu00iKdeQse3nGSgAwNtbV59fEhJIwyFxBTR8xeFexxTrjAlTOMWiiKInJ5SvRWvlkkPsUgrxqCUqRTCSOXCQhUSoPiwllAQ8jYi1T/JRB7kJGuuqwBU6jzpOLp/nE7oAtCtugkyvHKkeURrAKo3s8+jp40sc15awI2EH/lQh2geAqDVmZtnEriarw0EwCnbRoqhJ+4lQEnhjedktRKe7kT/RWcIdjcy2VcV/yRsFoCGG5d6wA4v9Zg24eRihxO4IN9hfJxdTCZ5fAYnuM7N0oloAjg9OblJVFLm6flGp4n6QhMNmRTbQnNcCYEXXJEtH5ivGQJLAvdOw/7Nrk4ASjo8VozTCi+cJI1LGyVAz9TN95OXmTerDXrJQt+h0qnrcGpq8YdYkrsHgNKBJKI+BbFM2T0LElCsoCsqr5unChQJiQAlRIGnNMuVMgAqpnp5uKrvbEQhuSFFAYMOKanBGupYahCAyuOpWyERb3I5oNLzaF0AKllZHNM4oOQSXrOJ/0oxYGB+KezWWUusCgAqlwZ2+kRI8Qkv0WHh3r6Kd1JwKBpdfae9csyPTRBdtOoE1xitPhl2YESaCOj5vPkBVGiDUs8Bv0CoUpi5dPItFJCJfgi5E2S2B6OQLxKi4pwXvWODV+5j5eV9p6jl7HFDVENw0nEEyT5N/K7AqAIMd4TaQr0yDijsSRdZavO6Q1VLXu6kFIk5iUIoPgNArQoWgghARa2iiGcm9nkThVG8hgJe4lHCrZON73oxBo2npMT/mn+CbAGo3tvfW9Md5JG8CsXoGFCkkRINklmijfszyRLXvxjTxnEiBIDCSOJxyARpkHngx3QybLwiVfuh1E7Q2RYULdglIKmix++XsDZ+DpTdWcKzjdhJgtOK50Y5RpnwDKigGT0K4gJAxwHFu7lqacDqjrS2mvVxJlie8Ea/EFDCCvnnd+vjGSnBQsn12Su46KRHeAdWV5e9JVTbmNhCRaekiBdw2QwoUeCQ6UzWzThwSPQNI0onVPe0hMvBovwUSUieaKHG9OHDdY1OEN5SDIKB0rNBcXEdzKhlAdX9vj0fQt+4Kw8nSQ52RyuzhIXS4r5LmU0LxUSBMkVPEwk9B1DGUwJUKQCFHql/cn7AbNoElCucpaUQAF3qMMfJDP5FKb3hoQSoleycyBYghVyX2NALCOUm4fSIM0RF48FWLwpeDH9Q+1oVW8NPCU9xwUJZU2JunG8P0KlbB3HMKJY8w8PDYq8BnXQR98bacvnCrzXXHQ0nAIofGNoDq9kLE32lZRwlT97eXwwo6DvcUFJbvljNJw2nqD/KuGQPHC6v6zslKDs3mho9bFTCU/I2A30AUKWzt4/KDblCGc9KCHWrrQgTA0sh/aBUBW1apgh1egMBqpAAxVf09CCXbMZQqTY1MaBbgYbsMbKE+IKSBpzyHRaqZAMl7Sh9FjVPpLfvTSJHHTRPxm6iFglQMfI08mF0WuKBX3BsOR2LXkARkgBA/BiwUIMJAwM9TPSVoGcEGwgf/FB3td39SJ42L7cSK4IWF2n1H9QNtuQ6auGXiGKyCgbdy4bCNLnCJDk8sTLWyPx8oxeTEEXcQtHUVK2icPV2LIVABsfdnH5l8xTuS4CK4ghfYzU3tFE3mxBF5QJtslYuLfSc7/Ts9DQOsZrlijvaL/H9syW5I4nzptuTg4Vv0AyUJsiezuHhJ98QNkqbCdTiRiR89AFbeJ+cKwffNDi46SfkQCUmxaAXE7urnqYyDOw+3JQ+6WHtYy4sYZnCeW0aJEH0XUwcPQXQBq6W3G5BpsnjEdFA70gC9Va0eWCByFGkLgh0VGQJPaLe29YaUg4qpbQhl8olJaf7OwH1NizRyQe5QvROCokWxX9K8ZW+t3i53Ep3uBWsgdskaGipU4pLSZjDUghGlXx/YLJ91uGgc2EwUcDZouJbXariayGlG2LjPc0hG26WAI17CvUjaCuU3gFinTwTSEsP7vlQU6Ui7Um/vbLLxhsF/gmIHuQASg6P00eMJ9pIs04ZT62SeeLyLk9OXvPi6TKgTCQaDJFV9PF6b2ubl4qpzVc8XoKy198BaGQpwsLFOPskOE5BG3MLKn1vkNuRJRq+KBUJUz2pZtK7vV7xN/Ept7dx/nSuCsMQiqLjnZ7hNawygtZBJt0aRqBKUrKW8aHkmrrpUfMWOUsuz5UMCR9gokM4Ub/vQ/g8KUcKFv04j9KVQzOPf5qNNhMHelTilK2MKLrIHjfXJRyxcDzDoCSZhZNSvH6wXjJQ+qTB0LHagVbV3doRJq6BcGSY2Eol6QdneQHoILk8AWreBFQRL6y5zLRSwxRXMurd4Y7V1oiXYiX/PV7dU91PslTKSDyqwo9kRRjtHsdyViNFUT/ujDGXPJF8cmRxIRo7w90S30wUnr9+DE7Z3jtqlV5/Os1DPo+8a8VPBxMNDr+dqi36xXI8TOne0hZH6YBPJZZ6w0KjM2WomBjPAeBpFfaJhr6Bcy3//AZhn4b68PT8NQRyeEbcbmGhravPQyHW0DpAgCo37VmUBhJOEqAmkn2YSghQsH9KAX1C5cSPFQUGR0irftAdal1tDIvkIw1huNqFhGblShg9cjZOOJuJzEH7H5mumXHgzmyQ4rlcXcEueywwFF2cOZm8/3BFxYmJkctn0DLhXhjHUmtOT/b2j1o5Ixn4g+qmQQXFvNC7ty8GWy7DRB/5haX9rkceLU3Ny+KNtZVZBOjsCZzmOlqFIRLsTBSg4OGApxV1vIKPCqFBUg4OKg0lo0SpWanTxieJ+MquN3mdS9MRt9Xb0RrSoTUWWCoTq3p2Y8pxjC91zyXepYEw9ZP0YEw1ubHczDN6KwcIoMYomQZWl8JELYTCyxG4As9eqU4K37r9gwjqOjoyLqbMJmvHfHssjc4H4sgNFkTaJPLehiZ7cSS54uDBY3PDuEXGRN2paxEMvHBsqsQklyhRgMoRS2+NXL95dcOP5TkVv4i53/kmrc0+jPN8ONRXmYmNn1MzZdr2U1VtsFDq4a2Sw8N7Euw1AAAgAElEQVTjzQSogs9eGQSg1meX5n9Gw2SaoaNpI0AN3vB0L0AebW0lrUI82JJlKjcvUxxQov/wMwPQHuTuQemhm7291JdRFG0QggASpqKK6KBeOHL99vX3gCkIGaIJzCvXb70XEfKeej1x1KCocJ6pYpymIR4/dnBX0qpt0t6L1ae22eTHmukOGLIL7aeWS+rRyAs8DQymZKvgZjABhXpspKCg7BfoG5OSsQIqTzsilm9X2nCEP1qhLf8WOXzr8wSVoESIYvZKVTrFFRPFT1jo86CZSNzBVTW9sCARQY6+BPp0dAmAbl4s9tis7LcAJZmdUgJUaMHkiTMRcY5GL6hRMdoUKQx+YbJS9r14+8deEqqiisXpkZVlprcgTGTW0ETaqLN1Iy1puE9Z55rGVcnLuHmhOd26IDC7EOjE+WvsPe+eBKD1g5CKMZXIMdSAtMSGWgLNKAagMZy2+QXM/a48EPaL+wOZdOcOeAIARc/52rdFRpLs08uANmwBisxHACrlKOp7w2aTNNFhQHFwa2C1EV9K7TzlmOwEC93qlQhQUdKCUFUSoG1huYEETHixGMxBvcRwUvVJmd7NRz8QUa1ubw/yksnU0P8FrP2+/aJzBYjShjIhvODxtkIcaVLow419NTjVYEzxNMWaqiUscQoL2yQDQ2tBbHAlRal6dh4qe35xqRJVxC2UX2H00gM0pO88XFBa9MGAJpdD10Q6+gxaHH8kEK1dzMOqTeDZ29rA83P68ZGRethCN0kdAag5PNnXOGqlYtPE8phBBrQR4zqrdWCaGk953ESlceKdLm9gQJUAtAqA6s0Sx7qZ5KlbEswII8qyG1I5Lq026qHH/T62Ll28tTIKRPPN+npltlQJMKBI8wDHOtrbvh93zpI5/DGxtZ1vAkFw2oNqWjNGS0tlgdNPj9ZzhMLXGMg42UQhCkAcNaFyugWp0wj2Du7+wAiaV37SloX7mMzOnPwLlPTR2alubfkkZaTeDjc1z2QPHEEBqPQcEe4N8mx8c7luoG/y2RLTILdrlFwEoK3TEbTAHdMDpA9UbokZBB3EJppgoVQ6K0vCq1WgjvkFkB4mdeZSe6kUKkdSrQBQBSjtaRSjoaff3/Bcvfne6HGyUFY9K6RaimpWAhQlBE5VzGHnJQSOMaw+FMdXbU1DQ10WvtcTFpeBurd/8ehoCV5eYszF1FPET+QpE4klKS1djZVptR+4rf2huprZzKwsOuaBcx50hwM20Ko2pKQBN7sNzmpTydTTI5Qx9L3MaKMJUEDX1ztKgKLdRFqCpdZDAwcVGZgRJ2A1K+OAKiVTjZdQZKFuYbMAFIRAZBKqWgNneWoGlDwUEFwHix5RJCEvhcxyN49D0FXOV4WspoZl7FG/+P6o89A5HH6Md8VSxQXjJkBNIRzLG4LE3nEmhu3vSEhYTIIV+MhFaiFlpvnn+aKzy6PhMFxrK5GiBsRLbzLQvC60AhYPuhxt8c4d917W/kh5US3NkDMuYcsNEnwUp2bqvg6Hb2vtCOmZMsfZ9x66RCVIXZ0uX2/ldB6+BiJ0tETJ7a+CfwyKA+iToHkE4RTBeQ7zVo7Rb2IqyqY4tUojIjSJZ/slQJU8FCVKW8HFJoU0SnoQ5K2cw5ky4JntxnwJtRnS73XMeV9ZKTl0gExLaHKoLGXxPRe5PIvqqxhXO9TDMTh9Jc6x2ocWL6NYUsdvwAiK5Eze6VefvtZPlSgFdYqg9KGUi3k5VD4gmjeIZ96bdG/O6eHyx3IRQLGAG1pl4FmLJr7vBaFr4PguB54hglM4HGUH87lzOvauEpxim0ayVTI/o+AXNrsegE524FhiZHopjGMV5q2snQho3EIx0qSpu3z06fm+V0m7ROaMfO02RyIhr0hLFBC5uGpouHH7vQhV7hBQvwshALB1w3A2Lr446uTRnVzKYuIStor6FP3SczM+sPdncNi6shIeH11fo25+8wYSuKlNWU0frsnGZ62JUgH8l1YG1AzB6M2NprzU1A8afz6KRcsBHPSgox68GLBbW3eqkcceeuLo9WYAyhuYpJYEFC9JlQAolrQsQ8vhtfLJQbIE8mbYrXlgEuQySKFWCVD6sXgKv61WZ0DpR2UZw+ir7XXTy15+ML6l2RvpvzZAjJWb3t1EHinkoYEXb95+PUT2ZwXiMFEUEySMvXorMuolI+aOUyHe9MzeE+eqiwzMv/xcU4pPNh6D01dnZHUFO4cdWAOhEsu1SSu6htazriYPc6VwfPQq51YZODCsVujuL47htpZ5987zu57DCTosUqVzHpcuHZmqnakp/yL3SG1udJNeK0o7RNAewTELKSwMlE690WRzYH5+AN9tMBHQbJOzYxIdq7cDWaYegg9JY6PTud0JI7WfB7Sm/HQjqAl6BVdGIytXbt2+df1dWqt16IkD3InhkHKk46mbN5woqICTPrw02fEsxD6oEDdu90dCHHMVLA7kN5NUEtCQKYJTjnSHuxakJXtlZa3dQxvgIQiXljsg0Q+vJ5+cWf+XhRqSjCnifJMAlHzfan3+B9gxjAl98UP3SEo4QZeHCR3th88CppU50aHHymtETd/jlso/r7cN5xTcW2rt/HMrhwYH80cPZL/b2/4aPN4ALK1eMysf6Dk5Wycj2GHx0moH6TlRyACIlSvXr39nOdJApkbdzqAJkw03CHkpUpjDr9YU1J3tl9crvf1od94DSBuWjZs/Hgg1nLt1YwVkIJmos6fj+q1zDQgC8HW8ZNP9YGvdqBBvL0fYQpky5SEMwco0AMcMb8f86Zoo7baOZV6qrs4c6sI0REY72nkVHjaTOXx+7PmJBlvm2sHubhO0CAYfuQ3dki9WTBLxDwB0kW6jiU3pGRmVXU04KDcPPKs4gnK+xJEBTEFAyBN3ThnC7cSq2mwCVPnuZM1ZaMIRu7LNz4Zgmwyo0gl2zRTqB6DmQTJZuTfy3q1b/+NLX/iT68sRN7XiiLrM/+O11ym5ljY7j9YUFLQfxcsSgh28//7FDZzJTrPcfG8gFLly+9aLoOvosImuZ+BcmFomGoaEwN2HKOFfB6AhGosoOHTqt942r9DqZPubw+npwzHc16q6OppLq95bPMLlsaYZgFbWRmezrsou1EyPkhDOtF14RdOl8O2rLe+8rC1/eM89z3gW48QXAUpSsZxgMLm87pRkoAwoBB5QgLS1iYTPiJLLe7NxpLMk/2ftEAPRFBiADoTzlQJQuReA6kPPvrQ6QFpgCI1Gr9/60vt0IPUmOm2YlxvgUEVDPSRZdjYB2lunLShfxX/nvY6s/QrsE25o2bi9MjAQvnXrhhOio/pseT4qDjC0xCYA0Y7J1hC+PWSct8IhszTD3kSTAY2L9kO9k6/VXMb6LFduDvZmaBb9/qaFkfULa3TnAp6EeqpraWunbPiLkz8PqIkBjbx/1TM8oS0vuseAfs+OzxQXR+HyGfyWGzxTVP4aRVCkJC+lNpg5aDXw7tb4GgXK82azG6KREpTidaefDov4Geq/fk7M6ZUlo9RnE6A99BOVPPvV67fef2WDzlpuXLz93rUI0rdbiXE+iDFaZGtC5pLLnUfrUlPL+6DWcl7HfaTGIOhKx+wCX7E8EFm5dSOf2RelQYfQK3IUECWmGdHVG3l9JeQ28QRKkS2slJ0+4aAO6JSzfW8Oq4ydAXsmaLVobezwwTnsP43ODtEtJGCvYxDi+iyFb+w/HbFKRUKC3xOgofdIfqstz3voAwAdEuplrPOPnZ/jmh54UhdPgOJoLvITn1SQM57Uh8DC5MTcNSIvI3IB9EHlwHduvyi0COZRsEyjJaNffX4pBK7ZPAo8v3Bxg1emGje+/P5T77333krYi2npoN4Ldui600CkvrO3HPfdrJvsd5a8ePsiNnFhcxUGlngNbvU/O3rlCtpKrI/A+gx5g+hAqUJFJVEFAdCgl6TVROdZBaCkUDBJoU+yUffA9PTZmihuhB3jO7vZsIwmgOOfXTbchSwWo2WtuIETSL7CN5L7OszCQuOEFyseTIJy2sCR2uJHPghQIa+/lBFYQwSFgbaxgXIjjAImssroGsQkUS8IZliCMnv0VHlNr9dMgMrl4NFWmOO1Op94oqNj9PjrV15/FroxHPX+wZe+cNFiFLNbS9f7N2/evH37epjW3ehpZ8rtFWs2plMA9Lvf/K4WMeTQcZgo7mJF913BwHLj5nvPh5z5BqlvUurcnCIpnMvNA9NLBKiekptpC1CTgFMAKgIpNAKrp/pe7kxpWQOBBxMdirrGunATKLodoyaGW1xC+4CxHSx0rl0AatoCVFioyYvCCaSotmDfB7o8i20vZcViEzT3aKMr5BZzGW8IJHMPWSuXoINKSdABp1cMnE7tu2bSs4XqI7dur7ipRfdeuXHl+edf/w9/+qf/4avHDx1//Ts/+JObFy3irJoRgH6Z7rxz8fZ3RkvyB8PYR3Hz5ndCtFTMOV3+0//1D6nl8/2HnngRKR73qNjAjSXeeNJy8dbzITMfToaNZmMryVJrRLBJg1ZQ9wNm0fHz8Wgr1QLbU3Q8jMKaT52tm8FdQmIaVjgF6FZZ1ZcyCFAXS0YxzEsDoCM1VWYOxYmAiooh8hR8Ht1n0d2P2dDigdIFO+8DBqAw0NMwUOrbOSOh2AsNrELXzTJGSRYvqkgYsLm3RjsZ0bOFDsqRN0haqbQ6b9z485eef+LGjRsA9PjjN770J8jXFiypS6eNAJYuBFM1/PgHz5bkmyMQEFy8+V4IeheFrlf703/8x5+mYmvaoScoil79py8DUTj9RZTyBoNJ4krqMcFfHYi4RWEMlNqc8JZsIfsVFqpnF5VLFirkefTYpekX2p/zW/xNGuaYc20ANJPwtOP+W3SnPJQVCYAmWqg0X6Im4qplJBWCh3sUTjvLymdsdDP3zEuaWHJdDQZJBChLOghQ+EkHzl+xjFWRIBpGdXrtdDn0qTjHjgEb1Di3rpP4QGl98dat77SGrty48af/FwB9/fbtVyx0nFqVppYAxbY5JO8fPIuFQxHo2i7e/I6XxIn509qf/vBHMNG+/nOHnkDXfPH7/x+MGUZ98eaNEDRGEvtEq8dWl2ju4Sb9EtIS6NhsniJki6UZ97BQvblt9YWv1814sNmPTLRak1tZTWv97K4x6TYwhQxo4ZaFmhItFMMKfWgZgA7hvqCfvRff9Gh5tyaDFixfskeL6vp6mWZqc4MfIAsHpdkqTX7iSU8cT/eGIks1WlTAXkIbWX701hUqrJXeF2/f+ksJ0OOPP/767f94Va2SbkEPGTYBWigBOjjoJUARQ6HOMOmmC/77D3/0vZ+m1k2fO/Q4xEQXnzr6P3AjTljzzVshavmZhso2oQfooCNnEENlkzBntQO7H82svZFO1+i3y0/0kjgSapbeF9pftgVdrlw2UUTSTNxidIwFZHTLEAbUUjjXfjcLZRrLGrm14TuPDUT79nwA25RDiGbmJtfhVng8SeohBouZcfy4PSEpJMe1W+RX6NTny7XzEW/EK+rQQzdWyPMI0Nt/+RIDevz4ocdfBKC8jlva+GfxC0Dh8gcAKNgGApRitHNV+7//3b/7q5+kavsihw5hy/TFWy+9+v4GBdybT4WyERUMUiOG84dLrXSqniQiSJo0IwTpxiUwUyN6TsvyuMdL+57A3C9N/zeYaBA3uCRACc/qziBp8FjvQKszjARocnvj3WIoLQmwDjyFm4dAcH/wXlLR3QUFE3SDigz7ELaJ9DKelNXpxyPJ13QHEr6c+GOSgkoaEhqNT9ellq9CHOKldKrM1p0jgT2erAAUMfTKKAP6yjAfZaX2TgIUUhgAGsFZBmydunnzupfwNDmntf/wo2984+//O0zUeeD4jZs3bzz7Uj+KAHT0y17UAQZJEIaQbR7AhJSmIQAUbdmA10onzulQjVyS8m1N9jePlijd5tbJV1+oO9jU5aKdvdU8Q/OpVGKvMAFKcieL6o1mAah0JCNBpQFAUYlu+IgfeeBe3Sdm92+P1F7KXJvDKL6RPR4G6tYzjQgnQQgVDQNYeR6HkHIsW9/Yl5paAzsx67etTRwMr9y6/ZdVXgL0WXL5W68MW4zpvBGN7uJhccFCKdF8H4CaCdDbL3oNdDogfLb8J3/7jR/+6H99V9s3cODQ/3nj1hU07o8/8cQTjx8vMWRvqj/xPKGBX1pCJWsyQWtc0rP6szBZ5eZ5Jfl2SbNC+hjUmztWe189XTc37rflZkp3f2OHN9JQSUaAqiF3frKob0C+XbwfF7OgncfZOt86xMx3BRRLnrCUESF25EjWhSLWihCg2DBg5WPwo728LVAp9Ek88Sf7tFJnjL4G5Vp8DaVCeAWGsKM3bv9l4+jjN268ODAKC40DKm6LgqT0ZeQZWOj3w+CesV4SFSnYR7x44enyn/zXH/3wGz/6B237krMEtdMBbCLFa/LEoRKakcQFalSPIhwudVDPC32FNbz0s4h5E1CROKFOEe+sT+JJBtExA6vTr56qy4t1VWsYUIqjTdgizbcWod0jDOh/KTs9sKmH2wYoZpNeUFuWyyRm3nlXPThAPQbV4+KRI+vlda+9wDmpjcfsSuK8VqcHBrysCRNdA+bJbgqt3rY+LQU7vdybcI4DJoq4+PqN/qrRx6/ceLGNAf2PnXTXTrrxIXZ7ANB/vkgt6M0fh6nWMa+gZ6LYRIDW/fUf//GPKC/h6ABpNZCrGkrOHTpUTys4lArh9Eo5f124FcJwtJYM6GrEbNrUmCgkHYV4l8s3lYn80PlXv91XntzVpcm1STd9dNHN3qSdY+npeNXT/gXfX38PC8XqjKcubqyVpWpP7L7nXL6gPBkDT+wLQ81EgHZwUFOwtLU10lDC+ZUBNWOjFU3FrZHVuvLU8smQPm6h0tJUAGodXWmsGj3+xJWV1tFDh16//h9f4aqJlibRLSRe+WfQHhs3by3zugYUdm5DNvGhALTmr//23/7xN374jX/QEmtNToKXD4MNbODIlmh+EvwN8rB1gGURpEDAzHpgcxwr4SlZqJTnxagNgOIJvfDts+V5gbHqQCaneXqH+gE31YKomdc7yNIulE9H9He1UBI3QglwdRyrXe65NiMpWVsRrZ2KFmHyQaOkNvJ4ishgNKcnB+jYFRkITf4MfMwAdWfopb7y7363rhfK68FtgGLGiHlwa2tk9PiVlSUvlt5eRx2KEIU9VDxtUIOYQ3N06zujIZ5DE5WHgpwBzfve3/7hH/3nb3zjH79Z1xuhlINo3WA1i3m1UkpKJFfBF4ADa0MUJaPxoiyFmlKQ1vhlcMtCN+Mnx1A8pWvz099+ob3uZBduDWiL30MTZ2ld4y20PBy1CO7WtgBN490tFPN5tPMQOWFtxrG7nfdml+9O7bZPHZkpLZ9/lSYfrXSMk5coRCAgGnAbGFAapZoM5PCkLsJmD+0389qroFnRb3m8Alu/KJWZW5dwp5qVZQKUfH7DoorvnSpUb7z/pVu3rq+MlqCbNEmImgSgz33vb//o838IE/1r7fw1Yj8Qr0kLgKlKXBiFJ0ZTPOgLzT2kLROAkriRQpQwom0WSh4vVBP0BOBZ89/+NlYPBsZsUcrz0l1JsbjZ38JbGgvVKYUTdVXmTSFl4ikqAShtdMJml3sqcrB6uSK3VnMYJ+YaCc82rPOBVeAkEJYoVEWsBKiCZ9MmRFASFoFyPq396U/y5mk8l0BvkSCAF6C0LWHXLw5+hQDo69e/AKY4TSpECy03v3T9+pWVUQOmlmbm4CRErQLQP/g8TPSHb9ccZW0d9CGwQ7NCGuzxAI8EVQZCtA0CXRw8ARsD7aSXx4dCJK74+SxPR5flpnoTguipb7/QVw4THYraNm0UqYlO0NNNq9Sy4WPtAyImmxSKzbM+SvGB148kOchK91zhlvSmtmwhd6hGe/pV8PStiKDAkk/0oqsb4DZeKCVN8Hg3VQ7eSG9N6k++h3VfAFQhVc6KuJCBAY2MluCoZ4QA/fMvIQupBJ4qy8X3r185h/2iOP6O9aImLoO4DCUL/bv/+vnPf/4Pf/TDH/518ST6WEyd0FmGacATN1BxGJx/osEG5CI99hSVkM9HaE0H6Ya4GN9K8kKexGUdCGpozPomXzo6WV4UGNPMaGzI9ZXVmRxI7RrcYB0bHtSyM8WnwyYBp3ybkYq0xDI8jEEKHrzHpC7psLb0cCy5vPzrr3LN1GMWgJZwD0JLBoTSiA3UjVfZOto/Wf7Nv1vva8WpDaZQ4hY6yD5GgA54AftSQ/6hQ0/8+VMwUUKUtvldfP+995w0C4A/89M3CdKNpgvTX/y7vwGgn//jH37j70+QiaK49IZbkXt0iRZKKgu8EgjqOLJjVpIAENtPIjisaG0IeaW5zWaS3zwfQys5MPm6Nj9/9OipGphoJW7Bo8HNdmx8VpGUh50YESApLaCxoFkKF2ryzWO58VMUJSS9daFXar7H+fmkx3DfVdwcpfgkEXeQi0iAGryN8CQs8C0hQOlsIPCkBgKa+vbyn/zVBE7SQHGcLTY0cAxFtiB1JUgIAhR5OL/+0L+58tSXbtJ4qJD4egyVvG6i2Sh9sKRGkG54FcJnv3jhv3z+8//+83/0n3/49+s1kxFK/QiVrW5eAbJpoNyumWhZFVxAx0R3GA0yfmorhiP8Gm23UCGjQyolQPuxNvKlo8+Vv5w7Nrto19RqhhYXj4jznzm2YBqU4y3NNRhsbcoHtsKG6F1MJSEsFe4Eg3f4XoDSrS/ySrV9XITirCsDqsyGGJGE7ABILJw1GZDiYRz1lJK++b2/ap6P8PoKt35Tk06AguMPE6A02+vBbQKeuHL9qf90c4N78lf+0/WVARrSiVhnYgEBk24E6PRXLvwff/D5f/8Hn/+3ZKLtVV4odzFqWuoZHOQsr5BUEiauklE6OXEQhwH1vrvaasYNHgCo12q6cyWMxJCYiNlDYMHN8o6+VlezOJY7E4AiQUPLexePQC1qy+yy4D7v/ry+fmt2HMxE+o6PTsHQKM3Ppd7zPAjqUNynWFu+epRyfBs8HoDCeZERl9DSmUUMhadB7oAhPbqWyOnU//2Nv9o/GWEwxJoHiT/4/wl7F7im7zTfvzPb2crunnN2z3+yUjmw3SHmP7uSFmcYAiyFAbeEAB3mZelEG6BTkEsJoW24hUuzcECthlOXpaE0MeWSaKgCyy1ymyK2XCyK4IWrDAgF/igLOrU41bGv1//zfH+/hGA7//+PikpR4Z3n+T7P97nSS7gbwSAkd6HyKrS4FgLom+/++7/i+fd3322OoypwJpgv2DM/LPvjJtYZa6cyXTMEgtTMiwcPjsrb8tk0Qanq7PUjL3DFRkdYaaSDlGg3uihEVEpxve0sgPokpxVj5olzeanzQ6fBEXG00mJQm5WKxMYDhz9DchKzAbCROLviEyyM+vWl51/6cS8mucAM2wXUuclnPysrFjd888Urh3H5/DMbbZ75EerJsA1JwwFFOxteawRDUK0QzQHlZiLTRBUGVBStGLndvRRszKULDpWM2yWUNRkBKDxtB1Bdwu9vvvvu3bt3/+vdd7+6mhy3myvmIKAsUSNic5nQ68AD9UgVpELpp7K18UcY0dyzxeLYPS/wBWf2NCRVhYlovxLVM4nhOJEpTU5TUYW821aj+HaiuC2Ji7WKVth5RXjHW+8dfu2fX6dCOSzXy85+D3P/3nr+79+SKFp4oG7OPFkXJGVrXwgt+vp3r76HAQ9/bv3K00iReCKXw9q4qQRUFEqtOtIUDJFH5yiVKrux5iv0ve1hcTbZ6sHupSyjbs/3At0JoCoGNI1W0BQO/f7Nd9/9d4jnVzchuM9ytQiO3CTXyYgRNDpz7SYBFbi6ekR0T13QwtDDBOJvS8vdL2Ii6ihuZiNraJqTHWh8W46YLsRpqAR0c9vp6DjZNrqIXrfdRTUKLW5LcpnLW69f+eiXr1EKHZueX6Np6P9y4q2OYFnrZC5fIuzk2XNtfPvRBfNCaP5Xv3v1dZSP/LlJTk/D7cegq3he4/HVhNKEiBgK6OCr3sNXS6IiG7JKlbzavhsHL44qNTRvYDcVK9jLKPdwLyXcg+j8GAYUrlYyiH4FpO+++/vOqmQ2z985Q8viloAg0mkIqCDdQ5CZmV6wNIX6DekedstMwy6cF+w1pnu4qk3WgyJCeY+YfFIUAaYR0Jy0ZAJql+btun+EXsbd+ValVo/bkkzyxsvHD//8vV9y83vZ+K/3XNBZI9cUiR0118+6bV1bGNDdBBS3+TdC3AP/XAvYjv+BE1RuiKdyERoNykZAIeSIqHgMNwSdfWB/Dr7YWPgoGsXq/fsXZ5TRFNXfvd8JKK8b8AvRRZScy4DiaqEDUZLPzrJkFrUkomys2B4+DEyvGQG9lhkAoJmpILqwtJiHEAku8UfoTiQW8XNbuNIzNwJKHxH6xCF9h90hePVDYQcpd8OdC27b5xdRtAk6gQ4Gs8UGEbUoZMffOlzx+kdMRDGxBpPpfpaNjaTIY8eInBotjjxr9+vpjgigIvKbkPl0dy9/+vsTn0/9MCxQxrx6ZuPhbtBUUtSL4I4CaRBxrXGk8SLyQhtaw28DaLlSRUDZYIKdIpETUDiPJNz5JKHoDoOfoTP9/quvvjIl+3DF3eQoidkIqD2M6s5QO9DUAA8AxeORPr00gyYsTA85IqZacfpC8MI6ttaw3xHQnDia45abgoKHPWgXzQn1cZJPZ6BsJjbqfDSW/hordF7he+Bo9nv//PEvfwac//x/Y+XWz05mQXqjoRexRxwi6rh50qmK4CU5FXN/uAS/yT3xe4HueGrHX6GMz9qSwgNl1dr0JaYAqBtrjKO7M25JGEcVu0caTwJ6/2IJyu6gtwyoyAGUHTk+VIoDlU9J8RFR+7cIAaihIZOO5alAED4uimhiqAKBpomIuKklOk3PfKprBoBC5+Hedy8lWkqTd6IICi24cHmFNN9gD5XgIzogVqQAACAASURBVJXtxn9hbsK4HNh1MW6faTEiYTIOUR/mDNihbh2iVGuP8wativ3mmgGzViZ/7w2Xkz/HME8qPKQ1R794++Ma89kcPhjjaK2yE6VSa8ymQ2cWzPwX1Yg3fc9Mlx1oXPxBCUaHGeIZUKpvwJ/dE0onIIZ4uTGcsc+KyMbDjsKJ1oeQgC4E65Op7/k7QAEI/UnotAHQszGhLJseGxqDfRa8aWdzdBAgThZxnc34s7yE9lxjQD0EAgEEdXppsdKKWe4Iueam0Yu7296/5Ma+RlJ5tOrHkDMqRh/PWZyeMVSTwTtYT4roszReBpHC+Br9QI0ZG+4VLm99kk2jqVjSF0B//c+1NZqzOc/GvhDr0HnG8wjfRY3QCAadhfogPHIJqWTfp79vWvBTP6gO8ZRp41UMKMqw8EVQ3wSyNjGYY4e/M5ZJKAJpbjDa0knt8sH79yM2s4wxDqCOkCM18tEfTquZRHVMWlsyA4oSXPhPoawRBy2ImJVFuZV8kZhN80Fbg11Cr5GVp0fg6uERMb1UTXOp6FPggTF1cbMfaLi444tCYY4Yar6fZgIZ2zDkgVr3xHwv3pNE3SiqgzGrxfqaFmONATof+fLriZ+8jn0H2NGDfe6//lWFrAZlR7udeLrt5F9DJqGI3GKXLmq6UIdxCrn5p79HQOGGImKvqClVcRofB1+ZAUVEHEDZ10bb4hAJ3fkCsEhT5I8goB7nLHClGdA9DqB0cLuxxJOqJtovRqdqy8HCKfxp1IXREj8KKsElw3qvPbpJXC3FHE3czDigtnkAdfVIT0/3cBUEpEbcWIxEF6kPTVBKYzESMr5c88NuvO7QHPgAENE4mCqpug3NtABazAP9jpEH0BgqV81v06o1NWazRSY5+kb28deOYiHCzylP/6vXg2Q1NK9mJ3dVfJa3SvwfJwl1Anr0O2OcyObv+MGOZ5rIqzeWpjCnKTeH5p0f2RmDJrhcfOvshcGwfAo8iF4Q62J0bb7d9y9GpX5Qk0KTanbHUU595x7e9u6kdsXdoSg3OSuM0aEqigEFTW73X6gPRQVDRShwjNcXi8iJpB88UGP2fGYAD1SQASEtWEJES+cjZiKK13cnqyTlBriSuUXDCQ3Txim6WySNP5uMA6AYwTICupO/BWw1bHJAd2JWDga7YtA+dF52/G2X7PeOvv7rX1BW+eU3jntCQml+BTwwlvZhONmILk5CnyWg6ARFOeqlD8KeAPoMyeuO/+vp/0nXJByhrKIpB6OUsI0cy51xP8kVc04T22YIjQcPN/Gkdub+xYKMpKM1Kprbxj5M1yhwYt4K4j/UN9iGtvP9MPY6IUDSnycBFfmwXyCwjO8fQEM5j4w+JnQT6jTZx5jKE1D2zC50zyjVOigALFzbw+sxpIr2/QB44YX0UouFMWy6Xm6aSiraibtSDB82fUJERaxLm/xrjdbaYtSarVrPyDc+qT352i9/Rv20p0+cy/OU69lEpd0i0c6tvhp7PJR1uOwmoDqkkt8Idw95cvfnM089/d+CUUOIcatqFVcihiH+fmz7RDHi4QwoW8izhxN10RE/TeUoBLS9/b0alZgBxWQ2eCRYJRnKTeCjYD++/Tb8cWr/Esdyr0ooBFQUtxvmDns8IbPxGJAkpiOaB3pEyFTegztD2ZOeUTC9FIylPCJqnMCQHUqG7IyxA92/0w+7weiLpaCNUJyjihGK9gPoHoeAbgHlA5DUxUYh0Rbs1jDUykI+fi2r4j0s/8Wy2sYTJ2k9aVrafjY00u7I2tOdnOeAlggGdI4F8MJcdjwJdMd/V8ggoDJrC1cihv6EGD+6ekjTUvLtEkpAaYcLZEx8XR+8dP9iQHvGqZri3U5A2eg9Dii+bnIL4ejQnZ4HGkoiGppDXhwBFekAFHPvsTJN+B2g6Znp7AcsfcTUaJZZ54P6MCh9Sq6P6IWtwMj+/eibQP2tkCpw0eSZXAygZOb3fJenvVJ+DzUJqbAKJh5Dx/slni4/zw7+5L1/RE7p5QOvSeRsCiXM3H4+5+G2FTvAr1jqBfU/ewjoJeTpAp8AumPHjr/DYmV3GhfIazybgsGApqTlsuMNCk8rDeEZ+ZCmTmqru6cjMjPaTwLoswR0D1SdA0oeAZNQERUfRWPsekNbNP11oTxRDBAWMpWHK0dAxVJ+mL0TUFdimcl4egR4eKzQDTQGZhIzmNsmpXv4AKeYEd0tZDxxW8JXLRRj7L2bmAPKI3iCKA+0uEZrjFa3aftrPX1fq5Ac/+TogcbGN17Oxr5Xai3wE6OYy972RyeHcKtdlYCil0PHefae2Tue3H0eIgsPJI03RHNAmZHHFwltpV2y/LUTSCl8Cw9dhzRFd0G6a2b7SdwLn2VJJrIopPNYLEFrCtgJmQ+3UAoHGFIlJeeVERWK04r9mIQSUMsW0FApB7SVV/l0TkozcaJmrCxF4i6IWmcfqjMXi44csQ+wEEHpuT8Plw7CCV8AeW5Mkdzz7JYn/j1AUe2AdVDRmhpLtiLkk08Uwb6RRzGH5GN5jREUcoTbge5kvXmcqG4Bbfjfl97CQJftfd7P/OBvJIESCt0p9FxRKMZhoJVSRESTacIyp+5Ccm8wag7uY2iZpaR7Oio9M/PYcTvQPazVlA4yIQeUBJqKDFEUnht9FkCZYcc7qfjsFlC1Np7bJSBi83A5oLjLZ3Aaz+Q0MzPAI2IBSo/akt10MKfgAGVNkCIuGrqfprszEd2PrSjUtCCG37QtTfkEUIqKokc05ezZaKOyB1MCPglBMDh8sLw6S3tLw0YskB+2240fvcu6+tgSDf71oV6rPTEN/3rpGK5KPduA7vhvWOXui9UhNLyBAwqN309EMC4dxyndO4VsHbk4OZkc81hdnXZm+mI6XJpjFVRcsYe8U1ynYkEyJ8dPzEkort3iGJSVFuoQBEL6ky5YDGjuWZXfHgLLAc0loiIhLWTAFhEGNDWAzlCPAHaABiBGkp4esVBdG1+4+4gYmRckAkSs8xr/0ealOB82Kds7FCsEYv1Qf+cGv6nYbqG/ExPdzQPV1ESnoLDRooyUebmgqAbLPtyxzp3GeuaIhVLcvfYfcepKF7NBvPzfKcTLiEwyOqDp7rkdqK9MHuwbyDovWAFOGrZxQkKZzsfRrAECCrdcjH+CiuxFwnxj09J0hEdGRvsWULrn4HNQd0Dt/2Ly23fC7cLYmjM6ZJLjm8UOCSWgIm5Rt06tJAmVCoXcggu/J4HizdU1k1yoqKVdNQ0st0UxFx9eQrFHAOqHvS0YTgyFyonBHl70QdiBPhlq4nq0qeCTAU1RnW3TmJUSbJf1DMcklyAEhLFW8yzFDBhQ/swg3+vITmeg1K6WnD/+9aVXj7u7RzoD3eGlkGf1oBEUFTUwSXRRKs4nCSW7K6b8ocgBFPIKAd0jLmotX0DqnAE16hhQFjNnQFM4oFLyKYWhGP5VhF7ps5oGqQOojgMqpTi+BpXfTESFxJOtnlbzQMGTgMIkeWSSV1owmmVlRKWT1FEv3MnvVRS57WZfLtba+uQkwx1FLxUD+qzdxj/7pIBSsxH+bdyH0tpqzDZFmGegb3m5S3VQWBDGAMlpTUSMmCZMO5rRmYTGcUApsbVnf05uc+n4v196tdfTvWmHk8dUIVdk2bKwaBHlmKTw+Dfy80GfHWsc0FjaKwTXGYcKAYVYNY0urAhgKzigbgRUSFdJzAfGVZUBxRFJq9TQ46ZukIamtRVJvXmgoU5AyzRyDigbd78daDpPFNLpKsj0iErfrG5SXwdRKhHJpUXMbrSTmo73GPz7tOc6FIMIk9MokFeckvN9wVDHGUpAMYwQAtSmrcUChTwXPL5hQYmJ4VhvVIPYAQMqdrOfobgm7Y/jDlE2DT1ZNfFVw/i/XULLp/vWrAyMEpMosmptSpygOEJTOKC5xU5AEdyxA8V4fwCF+2UMXlrIcM3MzMj4LtCzDCg8IClb9aFL0RsbpN5V+kleQr23gILoGQN2FG4H2syAkkcfQGdoAAHNaKdzdHaqXA+vWCzVTbahAYpZSlKDnQBKg48wkRxfeLIqDXEBABXxDvn3qzwC3gQ0DWZergiUlJRnu2Qr5MElg2HY8iOnecQ0Z++Imz0gwiR0P8tfs9h4jGrim7nxdy/RfFan4SM/SlRoa2tJQOE0aVJyWGtSbjGN/xYxoPvFLMtACRvEc2KogCC0yFI9teJBQNvnK4xSDIJMztlPkSRa/nHWKGVLQELZjknSebAsLNPHS0kkQ4UUqTobTb8koGhx0mMJIFvjK+X2LQHoacEsULrSE4AfHoJ2AE3NSJ2/0GNuEOPijgQ8lleQ50GLoUXkMDGl98a0jWSaugVrqBLv/D6crHqVzeilcZlpKRqzTS4LT4wMdnFpUkiCS8Jx+IX4YqXZZDGsPCvmonlDZAR3Mwmlri2qQ4qb+GZ8DnXhBNQRbtrxNwplbW0tBBRA9dFpDGhxvionDS4XBxQeAhdpEufmpOmS8XfDxlN5HLyZdgDVSCGy+QyoVHpEWGhs04l5P51ONSFaK9Vo+mozNkvtFAvPRhfSCpvC0NBmc6BlXOftd92v0J9bjiy93lJ7OnU2PYB/wBRmXiAgtIKV3iYDZc6gCLjNigknSSm2jMEFpeUjJFZxaF/aKU5TiXe7bcVFnPrzKRyLnundCDG3paUYrUqZfJdLYnhetiLMNzgoDEDDIiOVcn10cdyzLPXyJFAKpj3rE2f6wxiAYjyru+RHdoX/S1L42iwF8xfM7AhFw3ExLvSUURIzoCJ+FhvsTY6OVD5fXzu1kp4uIJUnoIgc4XRlQIVCnVGvIwvDeZbYW5Ec3WbM1TVo9A0MKDSbAZU6gCrHz4Clf6F/sx9to5Y2q2sbXxSksgdyySx8ehTe6N21bAu2TlOMAT0f9MLFci49bRCk1dVCAoqiP6E4hQHlcLI5e/b/WM80htjtIaDRGqNFoQhOTCwPC2sKDM/Lgz+Oxkjf4OBaZQ0yjEIROz3dmPVjQN04oG6h+5sB9CoH9If2UXfBikoIaKWMgLKBLQQ0V6ViSU8Cun8//VUs3wmgcTGhaMOelFcvFKSTF8qA+tEEsRy6TDoBJaTebMO0GJ7JZHNDqX7yOm1awYrkwsKU6MJCb/xcCKCe8rUzhX71/oWFUn9/f29sezVrPznKPR0fnG48caxdkCpIZ1Sj0gXnzluxqAl2Kfpssh+/hBGnqpg59VjBHIchHojF4DaW5iShblvDdVF9jWMQ/TcoDK/Rqw16hQyWKDE4JCwEQPvQKAMJ9c1jRDVFuSJ2/ztyREQc2epWEdecDKDfMKAowAv/S7vCy+XgWStnGt/KXZMwRxGmjwGls2m30B61EucjrYDwiFQTsrgSBSfU1XWWAYXeoRhGSksqsNyvTV/GJBTk2C4laXFK29mGhjKjZg4svRnHlOjmQtTg2oE2MKDNqArPxxSjFKPSlp3db38qrly50HH6RHtSUmoqXsL2C+cNyJdTj1KO2LGpFq89XGYffCCGAVWhyDEtZtsZuiWhAIrqEpTkIGZv6IfCeyV6eUlCwsM8w8JDKKThCaCDg8G1Wq0ZW6EQ2qLFBzCoDKgb88bQau2zBRSDHbgJwb6k8DBJTOOt6mioenSKKj8FjfEsi0xLeth1hNLHKDSIwf1SmqvPmyoATwHsLqy8ppkHSq650LtZX1NGPwt5AfX2TiYRbThTZ5xrhlwW0pOS4gRUsdbgX+8HnHPFKPkrLp5Uaw337t1bW1tbH1gfGDD099tqs2oTK0598NYrh9q75sstLblIJ+XCsvtJKXTAH9kkonhFc3KKo1HhJE5hQJnT5GYfCs0eMSehqKzCzP2KLJnCy8srMVgeHo7KxDAKCqPHODIoLy8yuEcrtzbkUgfpdqAUUnXzEec+ARTDA2WS2trWWrld4zk3tBhZyrOszkFkDz9wQFVp1DqoK9ZWL0S5zrbDygcIjl3RNGMNKhYmwecBSP+GGktRLrcpkWSUiWg0PKczZcYWAMVRib7PlJRCDqg/gMoGOguxqLq56Gwb/u18Atrfbzab+52ebFtPZJZvZPmpjs35qSC4DXQJE8fF+COwQs4Yndd+ZJewuiknJ9qYQvk8vgvIHtDgZsTtZCqP9DUBbcvqUciCvXZ5JfqGSAAURBF/j/SUBPsG+fpGBu/ypT1APrGYLLhTiD/GrkqoGqIzMBQDIK8yoGHuYdXPcLs/IKCtrRYGFAMxwBPtXmn5KmegQgYU0U0coYjZovZXrRxdCcAtiYC2v3XF3CDFJQdlMlIpLA2Aakub7Tyh4oV+EFGNvrSzyKhuRgcYcdxbtw2oobMQwzZUbW0P4ajEFRepWz/69I8/ozWmb2G0L57333/rxIHG0+c6Rnt7RxenerUI4Ilp5Gqc1DuG7gssnCqkslCkPQkoouI8UKdqB15MCegLPqE7Cag8XBa0C0CDJQyorClbIouMDM/ziqzEExRc4qusUTdjyhi6/4U8UGZURG6he3K/umkH6kJAn86WQeH1+holGXkZ6/ViQKOjz56NE9v1hf0FUBMxFWvtifVpMDdNRQUI2glo+0u/vWKYy9Xhss6AFno3N1iUBJSks5COTJgasaqu7WxzQ52xoXNv4V7/vYUJdSmdHNBCWHlP63Bh/fU08JyMgV2qN831v/3qK0lJ7Xgy8AjghdIByj+zs8d+3loTnw/tlsbE6WJiKEYlZPFQxMhipLocVby5jYCK7XccN+c8BqYVUl0SA4oOgfBdu6DxkSHheEP7yxWLLLIkcldicBMBjSwpCVZq1bjv4lJ2hANKm/Eocx0qyn2XAT1qB/pDSRgUXq/X10ro3mlmPPGugYDmc0CPsMFaSK3g7pFPQFFZ3pq4AscwYzYjM+mV939us7YUNeTm5qfl+9mB1jWTsBbSb739AdS7uE7TVtRcaow3daJ/a+/efSoe6N5CkzlM1tpQWJ+DiCmmAPpzQE+0zwZksCeAJZZwZQpgdh5Zu9T2pBfPNSmN8N7xz6JKSEy7vwiotxgxnRhdnCpag+ohB9Dtb2giYWXZobtfwHxomWfkrmAv0ngGVGlGl3J4SYnXrl3BQVD6YK/gkl1KpQYHKYtN8hLqxgN98ysAfc4JqKySAbVVAqjSkJKmSqP2pKLoFHjGlPymJkT8NTt9GFBkl2CUdC3a4xEBuManps5/8NkVm9aiN9YVNeemxBFQ//qGWjmAwgcinkzB/f2T69TGlIkzKcbOzoRCHuheO9DwEOV4szQ/t7kZdePsx5z1RHt6Ol40VozDCnJQRcLnl9Jd29tdUzsqLRRjgwkrhmYwD5+iK/DekvNjVPCFGNAtoXRzehjQPZxRgsKThHoFEdAw3BUNqBIPSgzGB4PpFO3pGSzZJQFR2PpYDqjIATT/6jckoR0OlT/vqeCA0k0+i3mhsEuqomgNpY75rDbuyj7wRUNZdgm1ITp15YWogNSupMZTLtm21iyt1Ww0tsU3qFS5ZG+a51qxwlHKbLl3oT8h9faXVtVFtxV1lhqLTGeYhFalnCHVZ0CD8uSlzf4YAUXnazNN/5yzNmakp2c6PRxMFJKghIxqxdNTO1oN+bSSNg0Dm5qlVHtHqxgR3S7GPS9e3RbdkJImtlfiOMspPKc9bGzhHsxnrVEAHMEjnABao0YszzOkpIeOARDd1dNTUlKyq1KLbwkojtjPUDf2X8zwN2OQ0A9CeKCYaOuptQFoq4KqGA3q6OjoFPyAxhhTaM3AkVgulEr5PQKKxjqEaKxBVL3ZUR4kl1daWuH9GlPwBzQaxJSkhXubm1tl5mbGk2w6PXgfU1ycYhwfTknp7PwcQBM4oHgKh8x95TJ1J12VoO1+IAoht54WBHAZkO88Ai67nPTKYWsRwk0+mLZI5ynFpuG9wQtVAagquk0zl5Ij3RpY6ub8K1ohjcIqmFdtlhdpd2JkGJwmbOTRqzUGrWdgXiJJrVdQpBcT30QvpbYlH0aJizBzUUM3alD95uqXl/7+nB3oUz8qCVRAQm0WJDwVNnTPMaKQUk0bk1DiKaK/xofyFbkpKqnPHu8iS97U1OjqYEn1qaP/+Ou33z9pw150zVmj0ajSwTk3mfSB1gY7Szx76V1zcnFRW91wUUrZO4V2oHg+Z0BnZGYeqH+9HWhqgCtP0PUJoAJ2E8089H4/5qihgGXSqESIYz/tDEe0SwwJLVap4o3GBq7C1ckW8Uco1cBR7UmsuKFN6UUCCu8IQIMQZ0fPsBo0JD0kol7BwRxQL68eeE9St53CLaAvUPQt96u7zkCfefqvKmVKmw0aj3xnPwYxEkwoPYBG68RH7EQ5oDG6lGIdbuIp8ryZ0cWlzdn2pK6XXjr06nuw8rn5SCXosY0WQCesnhYCyjxOO9K9OowXMxY1aKo6CaSpSHMmgSQ0wX/IHD4aZm0m4dwCaj7HA3X9joSySDOAtr/yCyuKHEW7cyf1NerJnLQ4HRFFdDmHgGraAHRLQt2edQZL3iDqrJCXr/XaFRwMqwQJlZREolIuJUXdKgsMD+JElJ4SepcYqdTk7vTbuV1CpflfffXlF84S+iPYJa2tlrwmrdlAAmqX0Gj7GcpyiVQOwgFFDld5YTYjg49cZLq+dLR/AuceueWIABTrTBNmz8oWBpRnyWS0UFdVZKwbrqvrTADGhAYAZRK6d8gQvpjXiqsSfTbeNe/1r282d6QGCBjM9C2k3K8yuViJIDXp0Ef6Ot0eNxGWNJrnhHGY0eXtTeExGCoA1RcBqOhJ+bQXLFDBkhD3JEjgLjpDfWVB0HukgABULwuUyIMTGc1dPNDlZSysQrh89xZQEQG9yQMN5IDuePoH2QpZVhDd5FsdAhqdotZQsJE6/7gQ3n7KZ+h06IrzSS7SB8+nknNIMTVE1ZKO9s9BXwFU09CsK8tvnjC7y3H1Ye7RXnI7IYn4r7CsKN5YOm5sSNi7b19CZwoB/XxvAgNarSxqZvTrSUL31g+bj6a6CrZE1NVJVDM5EQ2AE3zsE30VroVCNMgYc5t1yYheIq6dzICq9ZOqOOE2485LKtdaSNtWU7S1gEmPl68kOHFXJOpmMOzPrPCUyCUcTQK6q8erZHkwTFuMy9JuzsrzEirG0Iovv/jxFtCnfvT0j7xkSE8BqBXNSbyApqiNACpyO8Jl4mHkWTZNl5KfnKwr0h5PDQjg7QOyE6kd/RCver/6opSG5ubO5maTwV1mHi5kFOlHM0d2r66oyGgdN9eZQHJfZx0noQkJpoGQxVFlSzN9dnM93nXurTeZL3zPGbpNQsmpyjyBbAFqBGLQw2VsQJQatbTi0DLSeQCNL04WOhLq2/xQaj6n4bt6beIgaTw98EUhptoWAir3lEhkvru8OIeKoAYP9mGqits2oBRxj2n46i4HNPsZrkxsx1M/TES6k9x6AprCrDwBndQJ3Y4IGU8hYrEcUFWcD4alnuLSE3jI8U49B6A4AesbOKD1QwZPT9swOyrZKbm3ngPaqcsv1ZvX9HMJ+/btfYcB/ZyAtoSMLlUaOOz1e+vxB+tNBvwbAqeD0zV922GKmAzc/ICA9tM2YyHOd11VjdLYoAuNRZmF7gwWNKrq4qm4X8i8PrftXiiV5VOPBfbU1cIj4kWUzskgpvLRBqWnXCKTRCYSSlBN7MnyDfJEhySK0nY7eLI6QbTP3v3Pv//AAZTLKWVThh8zMTTRTOVJQlHhJSW/jiVtxD7sDNWVnc2hrG8Wzrd0B08CWkTHHoDm1jOgA4HulvHOTrI4exN0uGdyQBMKkxs0NS16TefnAFpVlpCwjwFdk89MlVhNzFYRexOADvS2B6Q+aZC431O2Ds59hivVjmYetdTR6GmkThlRkZ+0uUGXrAJQ3OYJaOz3XD4RLkJGqKhGi2tQsIOnVyLsiboOQLWe5EFJOJwQXt+gIDnmmcbYq824qjam88WYjfj3Hc5ASe//qiLSkxb8RPOPWq23AyUZFcZwZ2jV2Vzv0DPmSJZAY762wFWQkdrY35LQDKPUEJ1b7w+g9S0yd3mpqZNJ516y6ryIFurKiox6g34crmhC2RkeaMI4xjdU2+YY0IS9CZ176Rg43p6R6cq7ndsVPyMjMwCFTwjNpGdCRg+3qologxlEi3RoJZfmSpOh8i1GFPejhEy43cbzQhoLHxRbLHYFO2gS0HAGNMVgwcR/mSwE907ymiKDgvIkCgzqxWWVFb6K7ECRM88H0B8/ARS/+kGizKbecprqaNk4AxrK6kX2c2eoKi0XSUq916wgw2PrTtj+Vr/axICmxQAo7jlrmDrUYjJ10hSbBEgigeWkFET1ZitENCGhGYLLA5WsLvTaiujTTPQnEjigAoGrx/c9GRn0bwNoBlIwrgGzxzE1W/ysT5VeoWhVn8EkU4S4CagGQEWxzjaem5zuxuXHsJtMuavEy04zOzE7MThcpgRQzUBtYGAQAk8SX8IdWSnJ61NoUekiQk2pUGQHKqaaVAzz+fptBrT8GcccB9L6SkW/xmHk4TVhYaaY1RfGckBJQgvRdRUaWlZTzpW/O+6Exyp4oNH59VDa+qE5ubunudPEeCbo6kx7GSTGVIdEiEFf1NnZ6QDaOV65urBYG88DZX/ItF5BQJHthITSG2/n6ZcZ7NUkoEjazaanX8vWT6L/G5PFFWiMK5O6YeBucXydWl1TTEBxcXb7HlsvCi3WZpWUOISTHl8EFQyQ0BabTNYkQZhZAhGODJIEYUgQnFBUWwvZAj0RN/UAVkko1g1vB2rfiYzBbDQcmCIjBNSMpR5IfklZThFZtmQpVXugFSy0sLT1eGb61pUQqZ6kKxoT/MzmhpR4E3YcAKjF0711nKQNP5qNeMfrPBEtLEsxaiboAgqV34fP+XzYsrww5WUm7vXcp5om1iremo2YnZ+fnw0IwNVIwLAKuB/2M4AeYPXYLLcVIbMtja9RhMj7i/xipbmT8fEAipamWKGI35Zgl1HWggP318cNlQAAIABJREFURVqnDenLC+7x6vHiPM5srxBJiNxQp0pRm2WyykpcHsODIoOD+vrylMqzrAAxVLR1hqKlimrdpJ0ENOwJoDvQ1bgNqOb7gaIrtbDUcio1ahvQrk+MzQyoJtpEHr5prFUWpiSgJHHN+qIEUOZlNKFQ19lQp0cUbx8PdB8BvTh13EpnLX1Wwj4C2n96ZWWegM7OspCIQCDgZVXgbKRANACHOG3HiMHFXN5U2drSrGsoigdRfUpuqN2/cRh63Bhf4ICqtLLAkHA4R4leHNJdCt9wAIUJMShklb5UfhwuyQvqy5PIjawAkVIg8LioHxL3cVY8KJZ2fvPWd4A+8xeIqxpSEN2gUJOzhApjWVCMB5osjQVQbYczUI/0qK7X2NUdk1o0wxQrMk3YwiWKAcB8550E3Ow1pmY7ThoNVgiixk4y6nagrYMLCxdai7jjk92jTGv9H8wWgGZUAEkocp68iDpJKFf45IpIade/WDX5MVKM61BWZgdpBxqKJklE0ZLOAd3t5ihB5pCS6ZcWG7UyLPCRRHpxQBERjZQoCGg0tX9GUnY+UCLp8w1S6EtZCXfoloQit8yA7pQ2f/M+A+ps5Z9J9KStnQDqUPma7wEqjQkFUHXT1BMqn/qGFRF6AmqcwxFKQCWDYWZTwj4COqHXz5l4Vux8LOw804Cgkx1owufD+sHphQ6b2rSXM0l0lq5ZjwoKIJ0BriCI8oYtCRVsc0fxhcDUH3qtFcM2Y4iob29JuHmtJR6HaJsRngop5363ndtFlGyVuBhloYqQkJGQII6nV7gEQM0EdCBLJo+k+hH3kCCJRIlgVoxI5CyhVEIpYoksacO/fcGAJj7jvFWe7T1WGzXRnCcabazRNPNAvRlQMUkoHGfvZkPPJoLnHgEeduc+PfVEP3JFKA0x6ktNTEKtkvKw1gkC+o7pplVbajI5cEIkO8/AIWC2nxHtnLAOLkxvuliH7SIKCZ2zvpdawIpGXMk4Cf6chFKhI2Ldr1ywgGgoCmjl4TOr8taBFrUal5N8KXX27d7vthUWhXDijVp+4tLqjHJZyMhImGRXNkWWQnx7CKgqOqWlFkCDWK1oiILqR2KoaIsVtzrOUCGrO/ILbXj3C2aUnIAiKkqT2TSaNtJ5FWfl1VLIptQb77w5CZXyQM2JKx5UJLMVnBS0V5ix2wClITWaKgJ6sz+kN0Q7Z3rnnc/fMU0MyI0TTER5qrgmndFhe0Ih/AA6SE3D5ryF6YULtlL8Hv+fYgCmYevhrihX7hHw1ugJCcXliQF1xWsrmD1Vo0bDY8ykURbeeypcfmXAYABQMdfr6+h/o+YbklGRyG93Tk5aHXrlA0fCPEOCs3tI43sqFdZSXBTrbDJlVmQIlSqgDC9aFRcq4oDaL0o7nYC+eem5JyU0EkcoeKICaQtoNIBS0jKWauJiCKh3fhmANtiqCzwCHEDZd9Z12LqGJHBzfI26tBgO1M0rsgtB8jVTAknoxD2FZY5nScD2kVTik3Vnykwm+jWABi0sTE9lD/BAaWigyXzlxShWJebBfCd6MnmszirPislI84+d1NbpfHZfx4q08N7RvBBbv8G6DajdtcfaKlZehkrFHJVar6CiQ0+Zb6KXPKinJwvHJSS0rl8BoHCcFEqU6qhy7EB9RPupSkFkvyuhDChURymQ7RL6o3Cm8RpzzXeAUlIdBSAAqpMWFtXpvAvXmkYjopA9DnCKn6d2ZK8115tMLTUDsErNe2+uK06VK+Da4wxNGBpTyluGOHd9nx1oAt2aUopMCb/BR02aoIXp6YVqOE77IMk6HYmooaIrwNX+cGFl+znqpPOOLF565rFsbR3qHBEcVQSujuaFVdpaa/KF3wHK4sLo4RVSwQ7ivhRaxxMoCZJn1TqAGlCBfL4pjCbWxauwnWcPV9i7h4ByVQo7hVtAnwPQsMStu/zfoEXeQEcoA0oPgonxPNBYqlMAUKnUP16THNrcErRUkO4ElCJOgs2e9WFE6tdqDMNQ+b0QyuO9CsOEaQiSOTTcKrPeJNkzbUkoIT1z1jjBA63cXOi+OGob5iQ0GSEVk9p2zOM7RJ+Q0ACqBWICGhWVmQqi6vzcmNxivSKsvKM8EMpaHPpdCaVUG8u25XBEtTIq5ERwqLLW1lOraC1F73DdAEqQmyLZdi4VrTvy4Xu0RFtZeQfQsSeAPoWORGQ/UjQGvZOE2oH6eXNAdQCqNpYVNhtQhOMEVMBCePOJAxOQ0HGLlQN6R1JyQWLlgV7u97SMv7OPk9B37Dz37evU1MyZ9oHn5brKzZXp6SVbESe8xVIALW2lmD0VhwYE8Ewd7ujWYYOYaCYV5SGWFyCYL8FuBph6OPgyr6PHQzyxIS/0CaB8oSu2NPjEMaLxOEaZ9ZFktdoQaa+JB1DNgDwEKz6bwpTmyRz6PB/WbEFA+W1qDpX31o394bmO8C2gtAIE2Q84TYYah4QiYB/Pn6EMqI6A1mv0ZYUN/cvTBQjyuDru2QKYhoxq0DOZhltxP4IPPzHWJOk438oBNV0eCJPXkUtER+Y7jGwCcTVplGoG1FRa2bFy8f60i5okdG+CCnPy8OJc6ArwcHUIKYJMHq4OoDxVBJ5Yewg1MgVEpU8Fa1Nyk+Py4/XwI4/PSJRYOcgD3QqPxMKxRzAUsQlGVGXQsrKZ8OAsGwG11MUjRTmgDKPSJoREOKDJoZxY4q/avZv7pZgBdfPWjf/huXPbgP5dGCrBAdSsBVBORJGQKW4GSCafKO7SxRFQc02Zbty2uhAhyOBEhgumZwRkpp5qGhsehrukXR/urJ+YuGwNW6quHJ8YIoqX78llcIngH3UmcNKZ8A4pvsmgsBLwTlNDZe8sgM600mftHVIVI3Z/ubX3HwL40Dxdh9IRzWM4MxDJh4HyoFgURfKYbfKgz0mPmipRGory44qRtnMPWx7EyEj65n2o0cDuhdqv8hQnBao0lUZLRQmewT0EtEdhaYEjisSngoD64rfFBHS/kNP5mDhquGQCSkMWqe1F2vDN8+fCPe1AERf5nzhCCahVyUkogKox76y5MFTq589qk6QcUKul7Ezp+ZmFKEGGU18rA3qucn1s2DRkUBqGO00TpssG2ehi5cBNE6ZhAGilTLs2xIAymjBV+/BmMsgsc0P1ADphKU9auX9/6XwLma2heJQ9FV62VryYwfvu9OrB2QRHRExQ8gfPFCShJgFbd1B8TVFRAVPlSsNkXE7+nIGm7gJo7E7q79/t1GrEsLLxPrEi7CsE0P4KuafCqyerZwuoxkJAs7IUygEVk1Aha8TGwSvmujRRqYYaRwgpMqf/eum0xH0L6F9JPBWtAKq2yh1AoxlQnxgGlIgCaGG93lJ0pqVpEXV3GUw8+Tf6ZucjrVeh4aVK/Vynqd40dE+xOtWjvzmEx3R5rClMbuAuovuYeJLxx+EKU9piqk8A0NamQwX3D06XW004EYYajFWFhUOG7HbIJOtOioqIKCiI8uB9Upb3dA34blwvICogatOFjr20yYm1VuwcV9OETgbUzeE0Cbm+Qq6ABFbJqOw/2SNTZNuYhMotdXWUsbApJHm+WbVyhaE4rhhWiY8woV0Tw2xCd7IOzdhYDujXlxqDHG7TM0/9LY5QKwFtxYLELQlFPWxysh9XzsWANjOg6sil6agM50AlQnnpAYLqyjEAHbZo10wmMk+VfaiQGxsagsoPXe1XSGxzdvsOngmfM6BqRZhhAvEQ00R/5W8Dpu93j7bOvfObhKE5vabQP6HUdqILZSJREQUX8SwsLMw6G3nc1TwCHKUQmfZMU9TKNRd5/2Ta2fi5MSv2mReJtwMV2htfGVAfzB9La1P2X0FfUbatlgHV1rGrkoGARmZJFFYOKOsj5oCKOUeUmiVEUp9YUcO7lw7k2YGiJDwyEAVS8EINFoXVYJfQeCMBjZOysg+UexHQZpR9njEET00HsO/KIaHkB3p0yAeuTgxdNstvDRPQsdaRpXM2w006I4e+uqcIahqYIKDvcCdoYSH9XKpwbx2jz5hYrzyQevH+/e7sgcu/+Y1pWK8/418/bj39YkAU0ZzGfwsrU1N020WcxO7+0hdhb1ZmNVABqBePWJmvDm+bRL3t3NgtraYohgF1qneIdduSUOwzSkvTK83rV2oVtloGVKmtQ04/ZXxNEQ4JzQpSWOKLnYDCgRKzRmKS0Bc4oLlXL50YdEgoujw9ebe+kgqY7UDPosA4OSeXq+AsBFBdc7PFUtpgLpmaTt92WxEIqI1oPs92FcZoXVk715lAtQ7uo5snbWOXTQT0bmXeoG1siANK/xWWdeJ6P6x0D1mHK2oaXrN80BVBZql/+PN9pstmbWlhvan/QgH8ffZ0T08tLK0uLi1NTUFUFxDYm52fmqVBbkw4OQnNRCNOegRegFW5vuVhW1v8Wg2bmiXeBtRJQmkwV050jdKwvm6TbwMaPXdHLiegSIMCKGpWxd4spoxfiHczAWVzYxB1j0XB2Dagf41QfyvdO81yBjTeAbS5WJXPVyYxoA2W1tIia3n3NKUjtxxCHGxkOKqb7ly9OvZlltwwDEdoYiBwdbMje/0mfj10893+kGqJgQVLeJ0vw7Uz4bI1MLx1jO6eY9aPk9ILLt5fyr53GUAH0KuI3Gn5jYM3ujE0eGlpYX7WY2p5FDRXCOcKhUpnlrqoJt1RRpYpoKQIE+kZueVhdFtbW83ZGAwPx0gPMRuhsY0oG70EzynaojQMAGj2FtDi+OibY0o4ogAaIteoVADq481asXPieKNE6TZqegHVmLHfHStxqPwzfxuI/YSk8VYFgNY5JPRsQ2cx+S9UTFPoj3R8Z4OWgFYT0EwnoHTFTvXI7JCc/PLul3/0QqkAAZ2T501tHu8fQ2Zp6OZX9+TV5ZXjQ5x4kmU6U9Vp+nyoRVndZB3qNA1PDJxsT48iFFfehOyOa/UT9RP3zt++Md194/bSQmoXamxTVzemNhdWKOQM05SaOtO3mcQHoriQVAbqVdENir9lZQapDI2+BkB3c0BFwu+R0FjqVovWypmE9qCZ0NbDAS1W3RzTKpqasrJ2BWGxqR0odSrutwN144AiehQz97tXEh0S+pfB7hjiwI5QTwY0nr8qEdC0Yor8ENTk5DOdRQzoDJrkBdSF5QAaQBIzOz9Y/vpnd35xHAWBc0TUEt6xcCH7HsT18s2bb9oiRwf7h4cSOAndN9RZVWXqfGfYcrwX3io+fQ0ppAywWKq+dxUXBL0Stm3s/Gj37UdLC4BHdcwvbj4Y7aJkPXNH25OmRpbnu1g9kGu7gFU5Z7TjOCedv3hxNFzRamNAd3NA3Z7Ued4oMaAtBLSSAZUwoEU3xywE1MulBO3EKtw+Y54EKtwC2vCHQ+U8UHSBhFODJ2m80lPRT0DjmYRqULxdllYs9WdA/ZOrAFTZWlpq6+WAetizO4LMqcXNqc2VzJnBjgunLvSGBFrWgOimNWx0aqnacLmz8+bNm1+tS2Zmzt8zDXE+PSz8mbozne8MmbPOZZO/9c54xbGkdiI66jI2VD9skJvxmvQPzowCJwQvNbUL7FYfLCJ0j1/S82J73kjv5rX52QyUrNFDn5cR4MF0/uLFxUjczbVsvrWYU/nvWnkmoSlKDuh5SW0rBxRnZsPNsVoArc12SZQheseAUolXHI2hfxKotOE/nq92DyzhVP5vEWmhoiZ4oU5A43FVKuosS1Hp9nIiqlNxQFtso93Ts0xC0X7JrkqZSzMZ1Ie5sLE4tXSqOiSodp2A3lNUL0ydso6bOi/fvPz7N5uWF8txFwXP30Dlh0xDmrrL7/yftawLHa1rBPRKIwrqwWKh9wppu9yCa8K98AvtEMCA2VTBLMClLo08mIFhWlpcHJ2Zqa7uC0SSbXBwuXx1pne0Y2pFAKgw9SSi9y+udJR4hmiNxT4MKO82CfnyYV5CAYSAKhjQSAJaywNtnhizAWh2dnm5QqtmQIknARXaeW4BLfp6C+iPziOGivEF0YZWGYpxmFGi/1CvWgqg0WX+rNjLX5fGgLa02BYBFF/3/HyqgDovXV1T58svvISWAteZ1YWpqQt55z8ztGAX4piyZKp7Ktt81XT5MlaoDYSMLpb0XyUZBVIARfXdO0MT+uwTxy1jps7h9V8cahcQi+7qO8PDw3o5YlVXz1/rwpi2goIVGCL83VPL7u4j/BMYFoIS7rAwTAugPsLAkZG+5dXeKXxpvIhOL62OKNp4oKwP3E1oxylkJVsAKkxWpci5MzQ4/DwBRX9CcX7x3E14sXkl2dmJ5RK5mYAmS71pYEYOZvKIuJ4ojisFPBrefb6XA4p7py+CqOTVmy1U3aSOj1bHg6daFa1v6cQGyTKqRQRRXcqZzjKlRd1iW+pegMR0ja7Op85mkC1oTxrNO/fKK0ldm8uL3UtTM5LP7gyo1ybetUmmlqYu2O4xnr9/01I+tRg5AOef6TyI1qXA/pvPnz6dbUUcYOCPr7Z7sAPw9vE74+MGRe2dm2+WIGZy8f7BG3iWFhbmkzb73MP6wkLC8wYTy6ury72ozCs4ODLSNwhsKQP0YBktvVEF9KfgbK2G6Gm5Gk4+AGUkd/LlmW6s3xa3JrT7yDmVD5acb62thWOvxq7RiTfHzACK2odyX2rlwGIuKTtC4YYKWT+5m5DniXCT7s3nD3vyEvrDcOpVUCMyorQDbWlhll6vNmFEG0XSqOSrMK0MEmpRq7N5oJsPZlKpphGV9scuhOSVl1f3dlTPQIo6Bs9/OTZeWjeGmrru7mtX+q+O3fw9prDew6j/o9nrly/DGOH5/PKwufTmzXuVF2YbbeaxqwN3nm/PEJCNnp65cufeFUmY7d5A+dTU7Ud4bt+4GOWR2pUxOuIeXpIXHlRSfvz48ZMnMX8ajwt+ENYgKtByh6AuzjPD1D3djdZ6TPn0iWNAhZx4cm+xJGZuIg7oQMu6FUCpQ7NHrlQX5edO3BwzKPISUU5SHonFUgAaR30RceQ1CXkJpfw6Ayotu4ruWU8GdMff4IvIMiDIZFVwQOMZUNy+KPmboqnScSU0hWlVcJu0LQYeaGrS8ghsblfXfMdMHpIy7pKSwby+cCLaK7ny5dhwGfza1e4bCx1NrdarkNCb/1qRuHkNve73rl4dvnz58vDw1QH9vbt/xNk6Wq603rlz+P1D7RkeTOmXSwb7HrgHysNmRle/Bc3b01FRqYKp1b6RvsG+8MEgvH7VIIoR6ccrXBjURDRsYEiSO4sUjywvrcCnvX+we7Qf8wf307wkDgN3jAqZygvZ3AIe6Fo/naHgWQt5LSrGMmwADWJAS2iVHAFlNom5oUL2Z1FDgcZLAC0sG0OjEgf06URmkwAUR6i7AjdPAC0loPF683CzxqhK3suJqKpueNyiHTB7AWhGqqD9xcWRkZnNjt7yvpERdzTxDla7JJb0PVhenJoqSbwDHS41ywe7b99Yqg6XrF8dWxtYdwkfLVhZAoAK1mlotZ6vPF9RkbfxeGZptKky2+XcT+EckXd/8fHqzOPVjRF392+/ffzoTxBPXNEXlx+MwATlgWhfiKTEBTwrAPQ4AU0knpBP6ioMC0Tr68jqDVxX798AUGyh5YByPBlQIT80iwOqVK6v2YGiiVhhbikyDU3MEVBS+US5hYDmkMrnMKBiu4QyoAhylo1dej3c/TwDGunOehXU8EJpqBgV3q2tqaNh7PVGAhqfDE90H0o6qlKGhy3KAVsJLn8BkND22WX3wL6+8DAcaX2DJZLwaszrSBzs2wCevOOfgWiLVrKA429ptPd4f//Jk8dRlk8+9xRnomdgmUcvdFxYxiKqgpWOxBD3xBMkoun/z30I18Xp6RvfPgDOR7cPFkStLM1sPHjQtzGYl9eHbnY0YQeVVNO/d/zw4eMV2efzgiRhDGe4BA86inGYrt6evtjNgCbHOSSUmwZHIPnfhXJA19cN8iYOqERmWxubmBgGUAkBTUyUaKPJcSKSFMYTO0Yr2OPvUt3YpTck7pHPsPScO/UqAKgcDc1aY7wD6KTROmdKMdYV66jwYG9nFVpiWuUDtYMc0Pb2ro4R90DqlcorKYdihJUT0MTe5QfLM8sl2RX3xu7Zwqem78M4LCyWb64sMNMLVE7PNAzN1ONuUC6YHx0cPJfULuBuOhhDXHBx+gbOz4PY+3X72wew4RsbgxvA2YcX0d0zMLwkERNsTn5SkY28GkthuIfBhcrLk4Sw6mGyT7cBNB6zaNhEK04g7SSpAI5+Ck2uYkDvXZEr7ECVd76+ygEt8SKgQUoKutMxTBNdhEI7UNZmxuLvyCq9HcSAPvPXge60fE490K9wl/haNA4JjY836scn4vXqqmRWLou+11IAragc7J5acIU1ak+aR0AgELJSXl6O704CnXfJPl/du7rxYGO5OvF8/72KkNHpg0R0+nb3fe6Byb7v9Bzsnga3i5DRqID5+fZUFoID0QL6UMHtx7dJb3EAbODw3MjbIJp9JTMzUHt0wAQFZXll2/opb5ElB9RAlCGFw9ZzjhQh/Xa1v6WY0hxxdlfHjUknq3mVkiNJQOWV63euNKEgFJf52p4gz8grd+6OQeXl4czKA6gm3gE0BqaJjapgU7fsQOd+959NDOgOF5zjyJSqB2ye7uU9Fgo2aUrX1HUAilLjiXEULrDb597OBn3dVau8P2wDQDOZeV/sg83Nw78IouXVJUGkgiXlMzOryw/6ZmbKm5qOD84UdB88eB+6Z8cIVNP4EHs4oNMocVhBADnKNZUPdKTjNxERERcfPbp48cZtvB6zi30PNvJIOB/0lZ8619jYOwh0crmyNvvWrQ9vscdWi+Rl4nunEsPdA+kYdec8VosaTQHcAKqth+q8aAIEU/mqOrks2yaR4bhgVt7Xs/rcyTt35wA0hPmh5b5yIwMqtAMVczxRAcIB9dbN/ecXPZ55BDQSQC2k8a2eYb3nLWo4CGoeqNqimZirMVYl6+gM7Wxo01ztr6z17OsmlcddcLSvLyRsECxdSETzwgPLYZaCBqtnqmeWRzZwTOYFlc9gjOrBg9MFBRFkdQFwGlu8IrgQJ6wGL4kItKcjq4IoYCZFjBCkj4pIL7hx42L3oxsXL0ZEjD54AG1nOC9sNjY2nvJVKCRZtuxb2x+bMuuT99866oKagzAYNE9PAK1U59MAKsDgxz4wnRdzQ1/sQN2RRw4s6cNNqRVA3Vevnav4cmyuRRkWzIBGKhhQzC3DIHeaxCFmPP38qAKExlP46+b+45ILB1RiB1rpmXeqSY9LVnSdHWiNcW7YrK8qTi4koJ1G45ihshIri6c2A+CBjj7o6xsBz5KS8zAT4eGDJYPwrnHWlR+fqR4cge2e6Qup3oREHryInHnGLMWSMDkLkY5M6ivGWwCfrszEnYtVLNBQ8HZcNjMQKb7RffH27Wm6Jc2MMJ4P+pZHN+evNV67EISZCRzND2+d/PjkLf6Xt/qztCd//faBoy7hYElLYgC0pYiNSONUdNsVh4Bi1ERVXSXds1Y78hjQWgBdmT96ZWxsTRsYSQ5EeTDnN9GMGKqPhbWna70fA8qarf2lc19fqghkQOErUYfngEEemPixxUqRJgZUFR/fgqK54ZaauqoqMkuFnWb92JUmueeDxamFKPCEkRjJKynJC0HxdMnxC5i00nH0woXe8qCQoMTqasjo6urqg5HeeRAFUIpbcJ3Zjk5YVy6OGuDKgm8MqAcDiqhRBpYrYE1qQVRBxMpjXj6XR09fu3Zt81qHr6K2n0d465cH3n/7n+2/uXWrRlvx+stvv/wxfAYeqAFd1Zjjhy5wGgXHhEtkt09CKnwloJ55F1JnB8OZUfL1XF1ZmD9V8eUauubLySj1oNCcA4pePUioVOqY/EHDAKgxGEBPBgZhL2o1m3ZHNkkWUvEZAxpPRgkBkjqMI18bHtebq8ry62GWOjX6e/eaFO6BowtTER6jG8uDI3nleSP4Yno7Tje+/PLp043XGk98UNFTq5RLEqsHH2x8u7o80rc0C6IF3Lg1e6Mm5di56mNX58djq5JB4FGwsIBztCBqYXXkwcYGpPPCuWvXoO6b5xIVNQQQz61br7363P/68asfcTzpIzUWEP31r944NRjoGQYHGYFJIwLNqCqcLKoqzo+jlYXkNh3hb45CANW6D57r6kqqDmNAmwJXVy4WzFdfQdFwcHkieU4KHIWqOAaU1czxJydHlFqtpQ1fY6ZD5Q5a6UdjHNQGAK08zAHlrLwqvq5Fo1XPjRuNVVVlzSiS6yy1DHzZJHd3n1mZipjaWAaskj74KtWnrzWePn36DQDF++NZrFpA4ltdAg4bD9w3wOXiyny6c+crVYN4BPATw7iHBoJn2GttECGgqlME3z1WlhnPvNHNa+w5fa1XlnXLAfTtH9Oi5Z9xv2UfsmSdBNADjeeOSwIZUDXGgxJTPBhLHwNFJY52oJyEnvoJooFHQ2iYTW2l5ypEIKAx+06FZ6RXIrsqaQ3xGKFEw3YwOkLKTftxEtDCQuQ9j4ZgEtYzvlTSYyUjL+v57KTFzICWltYBKK5MNebxcUwK4XQeQPu/bMUwomUEfmaWy0NC8kJIVxjO0y/Tu8YTpxD17ueMbnYJueEPRpYXCgpowlO6M1CuEiQgwy6nGZTq4ztoYJWYtFLGbYHx7NtYZNLZ2Hi68WiQ8pYD6Mn3/+HFrhd/+k9OQG1Z5z/+FRbInj5wtGTkwUgIKyo8Sw8Un5Tehx2kftzsLAAtA9BzP+lKevFEoiSY/NDAGRxSCxkXKk5ieFt2ogt6l+A35cT5cUCZxjsUnsthEtBz4RjcRPckBhQJz4rPrgCoigGlMxQhUb1+bbwOnmhVGVzRzvHW2i9tisC+jUe3cdXpQ68+FlN3nDjNUOI/fLfnvLQ2+uboO+4norBbI48Qewvg0r6cUlOilNXYOGk8m2xJUCGd7MOsnHcKRzHjOd8I685eunK5zQlbuRkvAAAgAElEQVToKz/pevEffvpLB88PydZn/8vLv8AL/HLH4IMHIQj1nj2bEp3PzlAapIGDM9bviN8RISTVmwMa1gigST89KvGlAWsjo7j8XoyYr3YJCjsPor6oOdOocvYT0LgYkk/HEerv7c8NrKBEclD4Xz319F+UhCN4pzYYlJKTn13RckBbSuPrqlBRXaqvWRsvxbQEEtG9ncNW7Z1+Wdjy42+/XZ0ZHMEsHvegjkYGk/9x4pSi1i4st25lewX39W08GNlYmg+wDxLgzkdX/hB1ltB0sOST0hxhQVTq1MbIMu6cG6Pzm40Q0WuN506fkrB/gftHbp38LVZt/69XP94C+iFMfdbHL0NE33ijcQYvhoU0nWwSZrhCW0Nh2O3XHOLCgIaf+En7i+2v/LY63BcloX2LdJ+LCJjCZNbz5SSfbJhVjB+GFyWzIafeDpx8BhNAf/d2Hg1ueuYHf/l3uChhtFbT4c8qtFsSSkCrjNqB8VIj6XxyfWfn8IByvSIwsO/Ro283+txHPDH66dQJJpl2GT29S27jgD7Ej/6Tr1f3PXiw8WBm1pVMkmALqMfW8WmXUuLJJJQnim0VU8sbjxZWcUnYvMaA4l86t0t5y1kc38byxS+cjlD6WG1lxcu/euMNDKNfhHjXGtNUKHTjQhqsgo4pO3ml3jxQZdCxHyd1JbUfOl0eJAlx3+iG63wRV7fecM/I8iCFlmKaMPL+NEaTs/GYyOnt78cEtJCX0N+9H8mAPvPUX1gA1CrP5oBG80Dhh6qqUPRzr1RdA51X6RI6h9e02QA6MjP1aAMus3ugezmn74STFL7xgrzy1tY31/9Pzx3r7dtY3tiYcsXl34NLPbvaJdTDru0ZpPus8diVL5ugj87PLq3OLKQubvStbvLyidfslLx2G7yPP7rz8bozT/p3tT0f/Orl0y+/3Li08W1fbTyuSqiS4wZsh4qE3vaLOIkqBzTvt/8AlW8/ljR/oWRkBDFHhHQiogTX8tzRywIvvY5F7/yl7CZP5ohK6Pz4yR+ssKbhzd/9tiSkgmU9/xZjBww2eQWAKjmgLTzQOrW29V5pi95YqiouQ7vbmLXJBc7d8vzKEkJpI+4jF46dA0fuACWg1dD4D+3f3a31L55/Lmm0b3n5wSprjLG3HHBnKCejAY5jlE5Pms1C1p4lhZH5QyZp9cHqtXkH0HPZyi14D0m/b9F/23h+eEubdfQAAb0GoBtZLflcKaIPmwQrEvJE/YTedgmVR/72J0l4uuYXlyEpj6YB9HZE1GzGTKAMTjq0FrGmZNyHWGIJAsqJp599AIg/A/pFIgf06f+uNBgMrcqTJz/rV26doQxoiwWRwlKzPj6+uKrQ1DA8UJmHg3NkaTZiChEQ9wc4QV9u5AUUVuO0FzR+6/v62XPP//QnSXBYNx4sor0+lSXQMwXOEpphV/qMgIx0vvyMlB6fmTGLbKdgaWN5KonjSUDfy7Lx5wneP3xIxq8fXgX9ZovyhzWVhzHcv/Hla4sA6tsySUsXYvdQs+rWdd471m8LaMkrL4LnbAe5FI+/fXzwxsHbNwqiIgSb4TKbgQrCkZbHqmyySUJ2ggKnnSc3d67hzT9ccgmvYDmlHsRGDNqmw1c+y3ZIKIDWxRfHt7Qq+teq6vQaAC0bGh4ep102nu6r8xEFN+C0c0AbmZDiufaBr6TfgfPDW+8/99OXXnoxaQZEl+cFCH0QTw6oR4CTD8qsvQd3hrKfMkiUMYUxI3V2ZnkxdZau79eOtR87fe6kljuhNTzRh7dsWqWy5tbDh5OE9Cze8FO/soKAHri2+O23G5FrxZg/hpaP/WLHLgchNW/4cTP5ks/UyRNfebE96RpuEKtIQN54/OjGjUfTuFQEzJZXok8RsariuGQpShMwLJkcA8ya4d7sE2oY0FeP80DPWyCh8h4OKHn0dqC4fFplrQOldUYjztMqE1KR5ynk4B6+GVBw8dG3Dx5cOHG60XGG4k4oyXLWvvexuPWlQz+ZX4acLKIuEXd4gbOV50Q0w07V1UPAS64HVwuC/PHm6sxsKmn8sfakl9rPdWTXkgxqHuIdaE6uPSSecqX2w8nr1ycf2p8PtdkHDjQeYED7aicRE/aGUx4Hx8lp6C6rJBb665LPVAHoofbNZfe+0elpioI9fvy4m8JdEZmnLGhaQgEzZpXhfgkjL+ZN/Ja+0yyvvYVnCKiEA+prgZFXZJ/kgcL9ZE+dmoAqFP0tdWY9rH5xw9DwmA0RHMQbe2cjEKv8dqQaRolZDNJH5Iu2WYwPf/XF+19cuvTqTy/Al1x1TWXBTg87UOIn2H7xdL6Hwnbh2HVdXF1JTZq9Nk8H3KFjp4/W2j7koU2urc0hb5FlNZgxts8GoFvPpL725RMHDrx14jaA2iaLyREHja0Inrcfsyp4j06Usip5+SvHTpe7P7g9fZ94/un+7ccIayNAFrDZpIc9Qpo+WVpIRj6GvyBt4eQnT53BGObDlRzQoFY1s0kAintaNOWQ6QBVA2g8ZpnAyBn0VnWVqrhzeNwaxpJgg5sBUQcff/tgGTxJeGjm37Fr17ab4A/X7o7d/fo/fvfqgTwQXepqT92qMOM7EFy/9xGwN5LQzdUpVNd0JbEHQE9lEdDJSeCbo2fd1r82NoyDSfvQGeh1Y+3Lb5146/1jBLR/EtMb6azM4UfuknzGOgOtk1c3nusdGXkM8WRED/7pT49uI2oYEZXRg7ElzCShrFOK/QiciecdUDbvh/JthQzoKQ7oDyUAaqm8cvjkZ4kc0HgCChHFbcnMikkGrEprS5VKVVV6D5k8JCDCRlNnLwJo32IjCU9SO3t3rdfZJn34oaGlpWXtzqdvf5od8mBjBibGdauJ43sklNVMCBxEqV12dBTeKOpskg7RP3Ds9HElnZZ2bHNzH9rWUTmFsh3lw+tH6EP8O4PlX3577JVX2m/DYUZSiU1zj8uR2tWd13d6D6Bn6hTlR0+VuwMoRb5vMKQ3bndTaKbreI2agBYTUEr12V16JwH1t0voqUoXlpeX21oMyvMnofI9ck7lARQXeQ4ooqUDBrNSbq4D0XjkWTwTsZhlcD614NFjuOzXkrraCSjNopwHUGf3RaN5qIFT89H6LZeRjeUF2OwMgaPIbAuowPFum4QC6OLoLNZNtyfxEvrKuWztQyfdnpu71T9+GY2jLUqlIdePPoR3uX5HctWWf3zlledfTWJA45OZhMbFbZ2g/ANRY0Dl5acGR/pWb3d3U2EveaF2oKlHLVTLSBJaDyOfLHWm6c/T3A50x1/LrS39cOuv2IFG80DVPFCk8AwWGfawV6Emba1GFtwR6D4ympR+G0BXr5E+ojaOSdATQCGtehSx4qd1LwQzqamg/Umggm3yuY1o6uzSCkrtMujvZhLa/kFtzbazcu6Wefid3/xmLwG9bgd6nYC2/uL5Q8+/lPTo228HzaoYOkMxVVQq5GcY83aFfvBAS0bQKgSUNwoQ4Zq+wYAWgKjgtEVDbmhxMYAm24F623E6eO5lQCUM6P+Q96/bFNWHcYYGb5NQAmqQoPCpdmDASsM8qJC3aEAhx/ntnnctdfrxtxurUxxQEMXbE0Dx6GuDs249/LDlo8HB0RUPVJTZgdqPU8cpwP1y2wGAglC6N7U7RPRoFoaMc2rtAPp/fvObTo1Su06/5T565Mj1+NZfPXfo0EupAOpiVulIQgE01NtZPDkshWVlZzSVfeGjCwWwSMAYhYzWNFX+TJOZd21k8aJiAlrP26Rt1mivs4TKXdiEWwBtVRwnCY2U87ViVIEXzwOVoa+EtjHLrQPRmDU9p1dcOBfoHnYhNQJf7uoSEx0q38T3fcoJKOfZfMiAnn346ak+XCPBJpWvgnSGaFdxgesThyrV97lm2HkmHXpPa2S8HEA/BFC04VrlWWtzqE7jRNTvyHW17e3nD73Ulfno8aNeczELB8eQQWH3I0dow88OVO45szJNhSYHD95eQBCHyejFCLSeBFzjgKqKc+vr4dYzud5SePvzOSeh8gpWOVJpMGglvYevHD7lBBTvGdBKT99spXVgAB0qchsSTqqiAbnLsURkSDPSbzx+vDraziSUTfZNcrhNzEt8OJnfPGkjoGkPxz49CQkV2IHyTdo8TZ7sExKawcdMt1Q+6T2lxgmoOHduzTz++yE07CqzP5qY4IjiE/yuq/u/eOnQi13zjx8v9Zrz2YqRZHiSzPvkO9m8+SmcBFThvry4cJABvbEUkS7wiEKOIYr6Hzyg8pNM5XPrpUzj7fK5/WES+p6EAT1feeWWMhJArzgDpXoH+PgDlZ616601AwNk7m16zeRk6bhV/o/vyTzDN7sWHj1+PDP/0qGkVCam7Ukdcssth5+YnwvXrUhfW/vhw5y0ubH/PCZAp0N7KkWdnlBzjqrrNgm1+6QeAoeEdr1EQGk8P2fOMe9qztByc2LOrK1d/yUPlJNQTcUXhw51dS08frR00pyPKdt+0jiiEWvn6fB7eKDufbd5n+nGClrvkYPFExAVkdqhNUwyCW2u522SXT4LnYF+zgFlKt/UdAU2iZdQg0NCVQSUBkVY1s01hoEB9EBnr1s18aXj6/KKX0R6uvd2Rd149Hh186VD7XbP6bQvuTXsDnP9Os209m/QZ9keovuvYe3OoYz0zNSkTAbULqG8XDp4Pimh21Q+9cWjHFDSbHr8EyYgolfXa2uvfPnLTyfuAihG5PoR0CuXDqGoeenx7e7jAGrXeG/OoecC7YU80DMAKhlx3yB3CURvLGBxWwDacdFlFhXV1atUT1LFPSQ02SGh245PpNg/5yT0qB0obBIdoYdP+RLQeA4oa/GObmmVtbaojeYBFJZ4Su58adDUjY/12351ONAdntPFG49WFw+9xOkk3p8Ilt/ixJO+ZXz19XN6aDwKN/KHza+nBlC6eLuEMp4Zgv8PCWVAmcan/uRftGpeQv0wurAerY1zawazrf/jL+/e/fQuenrwwXoAzdXceRVABY++/dO0iwZTiJGKI6CxePPb7kcSULP8VDWCdqz04gaACmiTC02siEpPLVe2FJHGq3Kbi8kmObylwu06z4Ayt+lpS+uVWvnJw3g+a1JyQOvqGFa6zBPQFo1RTWbJ0/fnX98zG8aujt29i1T2qa6oiwcfzcy+yItQatKxbIUNOIvzIUOIIMT6Nc/pofGohdk/FL/+kmv61hRlnqb96PweCSWm5Au4ZtiN0j+8bdU0YMC6lEY0QzIwXMM0NLe+/stPP/30LuSTpscQ0esNhk8xJbZr5fHj+1P9anQBIqGe7BPqSFTag27gAq/pjFVy9Fz5CBNRxEEvBnhwQGfR/zA7qGxpoDMUQFHO86QxgnTSGxmld7EfuZKdoRbblazKwwxoFgOqptjdJN2VcPnUy2oxDMWoaVlvRZwp8pf/ccd8790337xrg+c0j63vtx/DcbIr5Su9ClvL5GTudb9mElACatbjBECtVv3k+m9TWaJuG03BdqTfuTqxNJPDzL/6kWFujk28Zk2O6Hyor5+4+/XXAPo1gNIILeJ5vcXw/qGkQ13dj/90f9FaSvtaoPE+Tv4SJ2joZ+OAVh49faHvwW3uilSAIn020gBt+umbEnS6UThUlZvLrp/b3M99dqbIsTuA/khru1J5/jOHhEI0Cega/YzHSkAhoi3rFZisJ6v86H/fvXf37pvvXkHx0KLHxUdk5/m7dlf7Sx2y2rXr10ntgJTGX861GNbWJhGQrG9YfyuV7eHepu8OVWc/Z/z/AH3xlbd/94evhhIcPE0TE1c//fWvfv3rr+86gNY3N5ih8e0A+qf7BxetRRSuhMaHbk8Eca6kP4CO65s6znWsjjzigEbQIAMGND3K4wLWgDRzVj4/hxYWFDpceR4mL6ME9HUeaP8VZfZhJ6B0i58s4njGm5mExreZ1w9Xhhx3kVSu42sH0DuYF7OaHtGNwrh5HmhS+4uNkqxJhtMP05T96Jub+xrPVzjcGtbfTnJ1jF9yhvmEhAr+LFAql37+0jeXWQsujS0YHh4bu/tfLx84cOC/vhybILkdon+zxfw2HbrzVEk5am0AUOkWUH/HRaeQmjGSz5wZbz1/7lxH74NHKGhD3146dZG7sj1DHrPVWg0DCqNUHKcrdPKYqDqJwaRnG1AlesVdeKDaAR5o0RofxDPLLJgohRYbw8fZsop/eq/fMnD367tvvvllpbv7xopHBEoN2WUpid51HStXxnPnWD0bTV3fPPH1H97+z29uYrLo+oEkYmS/KW0/PL9jlOxAKQrtuCqhFem5S/+GsSS/QcuoaXh87M6XfzzXeG1+/trpP345MYFGcvYaqv9f6t49KOoz2/cWBaG95aJYlEUrTv8hWr7Ujr7SZ6DT2kfo04gYLTY0Q78jICSRQwKC9pREQeRSXAIC3dDFTYjQ2iNbm9hbEIPacpMRsQUrqPFaEXUUQTBbJZVkZt7ven6/voAmM1Vnn70nPxPECwKfXve1nvWsC6O//S2A/ulcw11IFULIf51E05qHk08aNLXhgpH2VzdZaeQRjo1Sf4uA7jx+qHzrlxxQ9FH+114HngwoR5Op/D4r0OkJWm2CllN5HQ/0g/qMuwzn9a3YEEC/cf3fG4ZrVG3LYKtI42FEjZgWvL94z5+e/HQFcf2HgSxwCjysTCGe/x9o/paR/TL++QECuu3Y6CYHoB6TOdrpTknqWe/JLqKnAy9mDrTSdwGe/UMTL1+yU5+Pvn15ZAQ63/NHEP3y+mgYpRrbH9FZpQIsc9+LsgZM6G85dZ+U6OytAFC94EgZgEJCf/f1NxgHoDIjVmshCs3T797/xz8yG7r/UwJqc0Z7eQnlmXbagLoJErRqnaXDKqEneAkloKT0VSo9Q7u7fHRYp6uEN02DTwJQ1O6FD2/jRBBKQhxQ0vkj0t20WAx7qf/IP9deZH5/CzsGrEDfJJ9c4GQNSl+vkrpvt4b2B4af9h5kAtoLnN/++c9/+zN7OKIkodfuPm0ioNtv05zkS6zhhO/5PRL53/IFEXuqs80KtABArwDoV19/RVdlMFOzcefGnVebUQ3dxoAimyeNt/kidveGVUIRhzoCtTTraqYA/Tjj7glO5QloCqGtNgyrVZYXTDrp/zYaEH6wHV/0N4/o2CCXK+ULDBQN/pb99z8Y0GvxxHMbU3nqHr1uQD2mpE2OSFkvL5ERPX0yLuzS8Ineg2RDewcmXgInPX+mH9++jDlLfuna3RMvEIPiC7pNJfeXXScO7kW38iPOhDpIKL95E0DH9TXHT7XcfEbHnvfQEXF3WkIHvf+wBqWmz7Yd5ASUgNqjpb3vMZQc0G3r9/bagKoTLIcw4/BmoNe3diuZyiMRLTdYVIfGxgbi40lEx5pp6vrxYtQMv/lqOydBSOdPtzf3X/vyj7bn4LV+irfhl+8yoImJDvQ8HG2oBy+p9KvEyRN5QLqdM9OhPs/pgMZ7PQd7h45wPEk+6c3LIzFnkXzefXo2DEnnh1cf3KCK+xFDRutvKcf5fO+/8FeS8DQZnPVIPDvH03Mgoc/QjUdQz9petDZt++0PyzA792nhtoP7OY3f66jxn1vlc30n233IAZ3LAdUfcgR6YjLQhHR6B4lolR4301rIx5OEpgGoXPjqBmpdP/z07XY++zx5+mrlWJo1wv7jNfjgNSMvsHeEVD7pJBuqnWw8E90n2VCbcXXkCUfvzpnQDz/0meiGiB7sHRh5+ee/8frOnkdQepyGfDp2KW574un8Gw9oytyvxXAXlwxQ3W2vg/m0xeYMaHdC3pGWUsT1OLVOFx2gfkCB6PZitQnVIJzq389E9HOH3MgOFAtS1jfSmNL3AGpkQNO1CW0dvJfXA+h1Dmg2B3SUB4qhhyr9LtWuSiKaxoBK6i4Lby7eg4Qebuk0n87HRZ95/v01nufYCO0J2PEiHoiPjR5ItAKdbDHd7dJp/bPJgRPGzBJZdrt9++KTF4ezsQtqYGiEE8xHNqCPXo7E9z99cSaOqrNH7uGUN8qZUbR5fC8JqJ2mVd3pJAY0vrNKFwWeT7763VcbtifiTDU+JYBuP1mAbpoVKFVH9jpkR5/v5WjSm70fTwLatgulkY4OO1A0gj74+PrdDM6GnjCls2Afp72fdieoVG1nR8bSvouPf9ElenXjGdySH452fbsYSh/HVdXDQibOfHcXOHv7J47fY9/q1ZCz/RmjtfmJiz9x2GnFvXH08nbP7zFlDpes6Gl23Vei98Xh8f6BgbEjj/486bkNER0abrrk8yGc9KMHt6kNvPH2YQD942eYbeKudZoin52dnzZ2djaIz50//4TGmXZuuH+DDq7jptKTpw8nVKM89GljDwe0cK8j0MK9DCcRTS6sbu1sHQggoDMZULVSa5fQbA7o1rtc3JTytDyhi1Wgtqb0j1Upg1TaCVL5tBfNomffPhaef7kTxw42bMS3GxfHkIaGtpQ9h4geBE/ue97z6OXxs09Hyz7kL+a13UPhsXgSRTvbKeE95+i3M6CnP/S5ODzaPzAGlXd4NmCI+2rLxA4fbxyqX7zhwQ0A3Xj79j1tFe4koIiHv+LlfzgWMzs7Gys+7+w0iC4/vI+K8n9s2PjgwQZaCrWTiuWqLz7+AMMzjT3b9lNxpNDukKDxhZ1AuSWZAc2u7gXQpjOXVhunM6DNvwD0xFMDgJKb/wBAxyxKkVI7AqJjL5qFD7/5AbMjOzGf/M23GxhRLrbJzx2CX782tomXoT3Q+039ldEf+vkttttFRtVB9T1+XkL56j1Xyf4wzufixPj4UMg9m4ju+TMtIHnZ0nLAJw4LHzAzcGMPW/S08aU5uxMXB376+d7f/naqgCJ47Cys2NvZqD9/8wlaHhgJffDg3s7FiThScfJ0rjgBhwoBtLXnIDro+Ce2cak7SzYbC7FpLnk9D7R8sLM1/owd6CGl5TWgH9iANpCEUn5/YmCMI2oB0bGRZuHjr57gTIIf3PyDrx/s2c7X1bfvPJ3fgZN9/Wevsm+Wjh3ueXRkeFUcW52VOLXH4eCaHCX0dRll4T19lsCwsKahnI4WrHLADvHbGzbgJ0yOthTHYfDnJIWfUPaNTOVv6Ac7//g5i3h+y1dAkcFZFbczuaKiNXkw/eETHM/F4bQHdNZ+8UkPv52nT4mV/Dqb1p5WZkIb2cds44Klzwu3MQldj5A4OfuLwdbetEsXofI80ISa14EeY17p+tP+KvzLKWz2YSAeHHN0QSoLks8Rs/Cn3z15Jqy7t3HDn7Bm5ZudNqLb4zTj/f1Da+5Zo+49f/5zS+WOODb+mThlPMQx+XSQUFtr2QHryZMfWsswPpcisIvj1JGrxcXIOzEN1HLqSBwmErffvrGHJJPN0QDoOUMjaTwB3TtVPhHwdFYUtnYOKi+AJ50/e4QZALRpcF79FK1TpSPuHxce5IFiYfT6bbyAvlcICU1evyWcBDQ5JX28t/fFpYthVhvKF+8cgOIujAzOKz3tH0UriYjWZxPQsZHhZqWqeXiEA/oXYdZLOsb11Vd/ooiDEcVPlzTDw0MtV632DUrfsiL0JE2I8Ty5SVCm8m8qjiYufl3hGWb4b6zHOQ0P6BlYHFNWFlVWNkFPy5H8DxOx/nrjjQcbEM4zmvc2bHikTml87/P//en+vZx4vmeTT15z6wtbW8dVD588+eqbb/fcpqutd6JL435fIcGNyPBIn358rKenkfkkXF5ir4UUNtKB/y3JW8CzryFhdLA/81J0WJQvA2o0GjtyciZ5eRvQbAKKMzopNB8eHz8QPzCWNmQxqRKatWLhT1//+JfL52+QscIJ9yffUujEMqYP48I21XaUHX+0h5fQxfdORcShXOuR6LCC0MM6fmvrKjn4+8kPB5W7rGI755pgSn1Cw0KjDxxoasovfknLsR4B5KNHG/hnz6MNG081Zzc2fvoxgGKb7l5bSeS3vIQmN35c2NnaHfTw668gnZ/QfCD2lX548soridkElwSgH3zZ01P4KUY8Grd12jJ3Dmg4bGh4eHJyr0EFoGfCosNyubDJaDTbgKZbwybETWREs0/0DwMoJDQlJeMWgCJFGisZG+3qymkTPv76x59eXb6Po1kbvvrhh6+/3eDnzrkm1DB8Ijo6Wu7xfmPj7ZYyOrdNC0rc+bV1fo61ZqtgOvh7xx8cUDpwxy0IZkwp5D1yJKI44upV2vmAE4x79mxweGC5ofGFjRXVH+PIBep0DjR5jU8u/Lixs7dK8vjGo438xeseHqeL6+QSs6UrfTeribQCKA0htQLo+mReQDsreAmFBcVRjiDt+NCZUAKqZUB1bVagu9KtEsq7+ewTA8NKHHqiNQ+D8dyDuJ5qnBYRgGI0/MonOO2GDQEb6EAxDGlcKFXZvH2S8shtkIxuuP2yJelDnEpgQLlmzUba9s91lzwcUnj3yWJqfcvtXWdA/Vhy4MdurLhBh+5xM97XT+Ci93APB5PS+Ed7XralFDZ+/O8ElC0hdhhOYFySKwhol+TKbbJXaHEjdd5+yoylS11oTDKVr8CClMIK0vjkzvW2Zy8DShvlofGD6UHq8bEzF21AdTr1VKBbcX/F3WvZTELHsNOEAb1rA4r6cvyLUdWFr3988pfLNxHwbcApJHwTNOe/k1UtT2PSNrqlvf3US6zHwrxjPvbdLP6ETdgSTOvj5+HhPqWAZ/P3iXZZtdWe6WwtMb1N/wiQfYs9Od+y87cMohUo9/OejVdMFbjcurq+4nMA/dyhmc5zSa6v7+zsbZafIpqUlJw++fKxQqhSpld1N+irsQGvHoWDbZhA2l8Inp1cZgTP3shJaCdtQO/LTggyj49cunjxZ4Ce4CT0g8Fr2dlbs7f2jyXwQPuh8azONMC49usUX//440+XH7MghX0f5Cg3+LEtVYGB3oHeJ1/eb2/PLTueH4i6iTu3qBYoKKb5xEp0UqFkiqx6OBag3FmEgH7PTpJSP96RY/+NjTqhVtQAACAASURBVCQQ2wSU/U6pobHx43JMuX1OF7pw0zN/5KpvDEzrbgJqwoTBSVbeCSw+h5OBMm1zOmaP0g0EFD6plYBCQMM5mlsAtLDQASgOh+sY0Et5rNrUJhYLHG3oCSqPAGgGJBRI+18kJLCi84l+zoQyqHgGTJIfMEb56tmjjTzQDX+irWqPyFvinN/77//m/fdPn8wPxb3bWP1FG38Xc8q+kWPKHqsHSpys6ZP6TFYJJVXnYbJ/wmYtEelu4EXTRhPPDWN9Z2F1OYbcEJR/tHevrZbJe5ctjdUVAKqXXsXrDet/+1QW5rN1o2MGAprAgLYS0AqYUAaUk9Bw7EHk1vqAaGsf5hGVoxoO6BwCKlO8EWj2tUECeveFUVVFjdATAwPxk56uoIdPfnzy7NWjnTZH8CcaTH9wBVRv4+xxIrKXG1gC9uAR69LQGlxHfWcSimXjNPCQaC2NTPX3NknlTjJyOGmNrfV1IYx8nEQ/7eGB/gmusq68cW9FueHjTyve2/blR3t/y6eNtjr7lopqaPKg7gJecu4ACMbdTePxA4b0qhMNCeV0rggLj49V1NcXEjviuQU/wvdSGIq8s7WVdiU1BIlklqaLDOgsAiqXaScBvc5s6Mdbr92tB9CnL5qxxwwymj2FZ/y46jwD+q2fTVTY22+wsOrBzfuP7t+8ggOMV+6/xAydH0dkKk+w2cm1RBIn2dLE1zui3By+XUDtQsoY8jQdBHTjt+aq1ozyLxo+RkkTPmmvrdq+3mZCqxsBVFmKSY177Rcuo8ArUw+lxQ80AKiBgH5Q2ENOvoL3QfixhT6wsZBlnsmNJKcAKpRzQDs4oBIHoAkkodkc0F4G9MSLLmzdYUAHKA614oQ9NckfP4FXuuFnUz0OKmasbjx+AKCgeeMRgjsP/iYpklAI1W38sAHlLrUjEXVohji6IptBtQK1iydZTbsP2rBngyPQDff1uEBUqWcaj6sb9jKSXEDPA8U94smt2aq60JdXLkhwvF5lGh0pSRsYaEA4blCWs8pIz0EC2mrDGb4+HGV+SpSsQA1YBqHlgc7kgBZMBnqdAa2/2wug2SdeWFQGdObrOaBWnLfib6V1q3CK9qfLDz6ZJKCcGj56tBELsb7FvlkA8OOBenD6Sv/dtvO0SeikWMlWI/Wwd0isKk8fzXBusDohJp9WM8oTPWfI7sZO+o/rK7CcmEzotvXrHXCGr++s3k3HLeXnS89j0VOQSm8ZKklLIwkF0HIlqvUVrRxQzmRy4kkaTxILCaXf7us1iSQSNQ/UhYCKJgEdZW4eyXz9sV4M2GanvBjGC0dAOZyEEstA6ecBvfzx1z9dvv/JJJ74mckPfce03Zt80Sf8DRSgsXjjo9uLF/tZn53W0ZxEd8c5PA87VofMlFd5G84NVlV/A9ANLwUNVdrDEhMMYCvnk9avt+MkSWssr09u7e1iN6uIVPqu8TT2kMrzQKHxd+CTKgoZzi3h4WRBSePJBBS1QnCL+vpNQiQCBwhoDgOqFsoKDluBKi0EdOt1OKUPso8BaMbusSGEZdD5Qabn8eCJN0Q1Pn5Udf7mD68Q2dtp8kLKBJUedj/sJ9arJ/Dz9kf3H2135y5i+mTxTi4HtRVBJgVLFInSURuH9NNqQulF4xXeZmp4vbcCPtXVtausHUArUN/4nMrD6+1Iw7myW3Zy64BaJMEFPzjT2j/AAb3FJNSEtbYkoHcamcYnb9kCluH0cdsY0PAtya0VjUXJff06AsokNMfIrRmaBLQ7hZSegH6akb1//9bdoyNGZVc3B5QjavtvwCR/eJMDag0BmQ2148QPWtbiYeN52x2bqLcvpu30Ox33tr9Wf7LrufsUoBSC7tnIA91o/9Q2CWVK8kjQpavbfk5SXl/ReBBxzl5rh5LnibJGfflgcvJAGzbs6RtGxwetQEnlq06Y6JRGK+eTClvJuyeThOIjWwtZ1LSlCDcRFyXfGk8QYrdhBIVNNRxQ0SSgVeUE9IN/I6AZBNTwAiN13Sm2zBMkB3ieaaMqeSpyT07PbOLJgG6wyie7NI4niklWdzpGy04psk3p3IE6G9NJkw/8aSXH+ggvoZxV2ejoDPmfNrL3NyJLKjUHP9pZJzEQltbCz/e+t97hIaKdu6t7AdRXou8e7O8f5IDuIwlF2NT9BYBCtEnjCwvXh2+xSygBPVi0ZUtRIwM6qhSWpopDCGiBmQMqr3ME+gUH9H9/ygHdWj5mwc1A3Sm9t+LjJ0dOt+LHDuGI902/jfZvarLCU8Lu53AeCXdw2oVvJ78E33o775sk1OMNEooggRU8eUs6SfGtiP0elNaJ23FUU1UN+SKNf89RPonLls7qhj4AFStHBwYGBu/e7Y//jld5AqpX7q7PII3HQbtGAgobuoV9JH6nMLkIElpYf6yo6FZVkGT6PEUMAdWyZYIzJHagwVagWLmOIiCAXj9hGB9WJTRwQB2fgVu3BtIsQQDK8dxo42nNg3i/Yx9cSGR3cNLy6UR+H7aHVT6tEjq5n+xhv9zP0Ybu4eOmPZwusM+9kRNQTkfuPXpc6luQf/veQ9VueJSDNo23AYV7aSzvBtB+WcJ4/7Vbd61A91mB4rrUYz13ekCvsJMJqFVCCWhP0ZbkogoATb7VJZLNvEBAL/FAXWR2oGbYUKyw5YDW7z8Goid2V40ZVYbulIGpQKk5P4xLXq74bXRIVSbLp0NxmD8gC74ElCvkWS+8sW8jmDI95jBUwv4mZ0P5f59rdLz2ycET+9jP113Nv3fvggr1Jmh84d71U4CGJ1eQCS0aVyWM996yAd1HNpQDuht5552DBHT9Fv4JJyePs4yNRfBJKK0cSy6KbxZK56fKWkhCBW1s3aVCbk09DwOoBS49G5fA76YaYAYW5G9tGNMGlQMop+Xck8arP83d3ve4Pfl72sNbUJJOPw9HhX59ImRyTd59Sr459RSTNdziYnteUPfs2egYX2y8dy/x/nnJ43sn0WpKVSJo6vmy8HMrUPgiork+PLmvqprCyG6Vfrw3fgBWtJ/0fd8+ADUR0PTd2a137rSSxjMBDU/mmHaSTyqiqAlAe3BrjDBrvll+ygduPpatXXeWSmy5vFmptaTvtgE92FqRsfVEA2rMaPkzibxFKNNsEhqfphUJb7jvcbSgG6xAP+El1AY00WZJ/biFGFOBerw2gTuZpzsnohutsZMD0I12l3jb78ary6X30BLxeyRNqGcm1AHoetJcFNoPVu/GfXkobTT3c0AHSDx5oN3d6V/szsbm6EK4pMZwIhrO6f2WRgY0PBk+aeuxnlvjSlHpfCMBDYvmgfqKYicBbSCgu/8NQNFAzcg+sbt7xJzQUDXASyb7zyqhNMh8Y6c9oneI7DmHNFlCPf6uhE6az/GYNEbmkCxxTPewnItLITby4QWd1bpx/tW5fNzLkOj3EhvUETQB6Hs2oMwQAmhreX0PJY7Kqv6+73ig+xjQfqzxHdWX1xfaTCgnooxnMueTIKKF9dkA2q2Sz2ZAo8OSzOzmWee1orU5jkCrT2RnZ6QwoAjCMramNIzUKMurBoDxVpqVZxoPtEMpvL/TGsPw3xHPc6PfJAlNtK4T8nhD+Ml3lD2maLzN+FrZ0nasxTzRjRv5TNZeKyGL6vfo4cOXH55kc2k3FPpsDCrAhG6zFzOBFOJWVFGeQUD16aMDtxjQeIYTUtqfnt49/kV5feOdOwcrCF/4FhvQZNL4Rjj5ouSK+mzs56+SKGYylY/2iQgW8DuYfQkmD3Q0vZyAbmVAkSZkZG+tHh7RpTcMkKanpcWnOQIdGzYK66YU5SaFTG+UUIeLrab0NSdPjNmmnBw24i1ezFeY2Qvmt9Fv6qdefOOB+/bbBPT2zvu4ALG1Zy80fptVQsPDOY2nygiA9qabhuLtQIF0H4AiA/+iuh4mtJE0PpnBZDZ0PYBmwCcVMROa3YuIQJLKgHpF+4QY57AdLmqRuIafvgPQHAAF0ex/Q1GhD2FtRkZ2dZemWWnggfI8rUCHzMILj3ayyuYnk+tyftZ08zWgk+4N+pkTDJNHmh2Te6uM8jhfrwi6b6fgjBqkO6+oygcPEtD3uGwznFrppMDQ+Op69C17BtO7xuK/Y0B5nPv29WODcBXWph6801PBTOgWuw2FxmdkIJ5PxsUbBLTfJDLP54G28EAFtvodDzTFDhQNqozsFMMQWp9s5M6q8GlpfLl5rCtIcn/nlDolH4IutoWYk4C+RtHx8Ky7x5SS/etW1uqZOKPC3r/NFZ0R83OGhoAm3vvwZGlQw2Byz+fWNCmc+SMCAwtYXoiCUU9KwmhamhUoI/rdvnFlAvXoCilN4kwoCSh7Ywd6MBtA+7CEXz7Dab5ZVgagUcZZ/K3IcrUDUP0XaNRlZ6B+V99XVEQ6f8Iw+qJZP2aTUAeVj08bVYoeYsLAqoJ+1C3y4+WTr3wsfk25bWdnp07d8gfrPBzKT/bZkSkp/esPiHKpBI1T4OTzFZmqqje51e7jOaBMQnEbO4DeMiQMAej3ADrw3T5OQAE0fdTwBWk8fHxFI29COTuaDJ4ZiJp6oPH1g33x3UrldDcAbfGJ9sqjSRxKlcRys03lC47qadghO/uDf2NAofPXsxsaXgyZ+r9jPHmltwIdGzJKZKe2T/qu+ATJw55VvubP30h0SmmZ1ZsWOxxdcv85ogSSfdrbts+dmPgh+utCZXcvZAoaH26TT05C+3bvRpqU3GuCoEBC+zmgJSSgL8ZVu6pM5fAgpPFWoOE0JoKCCAOaXNRzDEB778R3iYzzneebFUcCo71yjC7c7T/BYmOBFailFlEtAd1KKl/E/gHS+SbLOAWhTED5mgwXj6ZpJRBRD/s3w88w2OcWXwuQiOTOxfwNV1PO1iS6TwnqHdeR2PeVLHYoqTo8idZ3PPxOXi1F1Vg5TkD3cjwdVb5192Bf55YimFDU6L8noPH7+CdgVHXIoG8ovEMaX1HYmcx5eA5rIw+0taJ+N4AOmFRvOzvntYmPh4V6FRiduUs926RSAQ9UZaltTqgiG5rNAU3+fH9GRoqhO3OkH2O2afbHWigZw4ElyZXT/LfBM31z5Dk5JbKuFvSYHLtPGnD0YEvd3NmhZAfc3EvFLkyktorHa0QxXPLyAtWNEwb7kOu8Z084eaBFjUxA+04kdEAqAbR/IJ5T+O8ANOiQSZ/SyHw8KgHMH1lfiMaMjOvHqPtRX1+d3dc3mBCkdXbNbRNfDQvzERjdeKBmYxsLnKg4glVDHFDsZqSiX2PFZ/Dz5WOasTQ7T6vK492xEotMqLhPV0NxusgqypwHn5xTWjniglP2w4+QTjncPdUEMHHmb0j0cKyTTA0duF/6UQCAfa4f5h8+T2vXRfp+AG18b/0klQeZIuxJYw22hCGSye+4sJ57NBYALUfe2ZNhS5NsJpSAIgy9BpdU3QsTKqeBOyejNAkLObLMbtwdf++Y1dgWjKnwDl+xHeh1vDhFW4o6Cz9DH+QL0ozXJBQ4Calago2bJ0/SOBd9Pz8D1HFUaSen6It3Lp4inFOM6uQYy9GM8r9hv9zbnZVOKMa97X7yZZ2M3QwgKu/t5TQ+nPNIjCnEDe2gnvAizHmZRt4EdJe+erDnTm92ha3SxL9lJrSxqOfuCWh8X9+ASfk2XeNpTM2PC4xO5YBi3aVZK0bghB9SANUqG7K5p5AkNLlw/2fZKeX6jpIxVotxAMq/NwK/BMd0msa5Jt0COzXGnPwLVJvZcJa7u21j02tHlxyLUQ4FvjdIqDt377S7+22/06iNCCVBuKbksqShtxcaz8SSl9BkTtI62VhSr6krwAqU8/AMqEqvTxns6cnIJo2fLKDkUlrv9GVjhwA0flwJAXWb5iRNzQ/0LpbG8kCnG7WYaARPktAcrdJACp+Nf66TgDbu/ywDXWoj6wjSU8IDtWo/RkZ1EpHsijtdOmFdZMsNKy6eXIBzd7h5m20LpIv7tls3Lru/kehrfRJ3x2xhMT9ryhcDT9JGx5d1NLCA4LpdLO/u7a0oXB/uoO2dXEZOTTaa87IAaMD3af12n7QvQKtKL8/uRdqZTQ35LQ5AO0lAs6/dac0+UQ2NR2XF5OTsPM1JHJwft/CIVM0DdTKrBUoaYu7wlVlyLAwok9BOKvS3QudP4MLP5rGSNEcZHbC9V1LSoYOMnvPY7sebOy5emhK9c1ruTisdKLXffvvUjXsnT5/meH7yyWL318/WvUFCPaamXyx/YP8wLXc7fe/KeVy8IsTdVppc1I57Wb3dquyQtk6OTDLVN251pw9n7gtgQG0av08DoA1IsBoJaKuDgHJRfUbGrWuF2fXl0Phek26WKzy7kzgrP3DJKfFs/iZfZ7PZohPAiHYEA2hNAgeUk1DS+cLPtlYlKJVdJSUElPsBoGNptiiqZNgowuLbe6eZ3m3nRMt9yrIW3oQuppPTAHr6xoXzF0rbsZkMYTh3m7nHm5zSYvuL9CagfqyDCpRUtz698xQGQGA7zR0lJZoOmX5wsKKi0yaeeDoZ0KJOpJ1FqGzoxxyAlvBAu7BkvZcKQ9k2E+qo8XdvDVbAq5DGJ+hcXJxcXZ0VWflxC9rFLtbb5d82WpqNENC8tSpLTk5COS+hFQQ0vKix8LPrKek6nbKjxCah+GloPM1BRoea5RLhw5fU3tjOiSKvxK8fOl7MAd1+79T9K3UXcNsZL6GOFXt71mmzxm9IX7k/4y5pAM/T2D1I2i43WkY0JWkBOSrDIJrAnXaNRyPJChTZY1+8wVQSgOf7+AGY0ICSkhIyABo17kPvpRmx7EkmNJyL6jNw+iAbcc/gnb4GDIe5uuEyAEVsdOiSc1JnK9AZRosFywRzcmPlcE46HihnQOif+Wg/Nt2qVTCj9CKWUB02rWS8asxuU0dKRnB9DvZvXsWEOmSUn1R2n7pThHH6hB3/SqSxRww81l2heIs/EjZptvEXgHo4AKU0le4iOnmjDrGSKEhnGcsEnH0BFlUDNL7QLqDreQFFJs80vl/fxQOFTwoIwPv78ENjVpkG+6DxAGoX0HBeQOkBnPKGgfhxvc7ZbZqLM5oepaFxgXV2oDP16o5DyOfzBPKujpxdJquEsqwLOg+gJpWlTUSx0z6+ahgwahjhpbOEvdUMqWW01v4k3WPjwd+ZPPWQrAMRPyZWuNGO3Rj9+rmQXwZqDyX8Esm5nT55qk5BobzYMlESwF74gC5Vdy+kwu7it+DcBwvrW+upiXFrNKEjgD0D/WkBtkeDFtogJnCoIe/o4yFZPFDkjvrutAFDghoIIaEuirrQwNAssw2ok1mfo8WJ5LwCGbAe0jtKKL0wH+3PNqgsucYgi6YkjSshlJRoTcBLOEvYT2klAZoctOwkpffeP2klOvUYt2NPCZE9rWXGaf+pfZBJx2d/Bqjtz+jaHKygP1Uqo0heJpiAdDJTmBbQpRwfJLdiTZDIgrIwvaeQXHTRra6EoUxCuM8RaOaIDpdlo7GH5f2NRbw3AliyfQzo9YzC7N3lg2njuoSZuEwFnt1JURAXWJzKRU2M6Ox0S44ZBz7PKXB+oU1vlVCWdiWHd/7rZ9kNKsHSSKOyg8K2F1D7Ek1zwtgLBnSkxEpVMyGQiYSvzl11ZxN3ixe7/7yEWtNHdz+H+0DYrmAP939AQlkHlZp2uFT05NUrWYRTLlYPZWaW8L6lJKBZB6CFyfaYKZz5py3JPfXlBHSgedcIAc1ELRIaH1Ci4YAqE7pv9UC9WWbDR63gmdxoldDCjAZDWr9JZeYBOonPxXkfSZ0+zQZ0ps402qW3tOeIAVStP2EFygVtnZ9/lr1bqZ4YGdbrOpg6pe0LwIDOEMklY1lCIkuPZriZrrO4cpVd+Ekuio4pLOaGQDkPYgcC94w/9HD3e01AWTAwtcjPBk14xDspkWc5O4564UJfwmm0TGSCT4k1nBwxm+DkC8O32G1oJ1fW7DMYevsw5pWgJg3PBNB4puu8hCr147eYj2+0Njo7WfrPaTssaEVGdTcMimoOD9BNfDjO+xSAuvK/dnN7K3101GA+3C6WHs7pIqAVDkCTMb+XktCM0x/DcPWaFyX08k+I5UMaRvNFicMTUNJhxqhlKrwTbo72QOeRbaplR2JocJG5I/70l9+bdgW/tlIQPXysDU/ExRbc0VtWy6IjS3Rm6cOrGJSlHFNm7tBkMv21SihecsNgNvWAuSgUbgVgwnsAdFDf0IewflxlwUc0NQWk9ad9H5DJGdCAzAmlqbfnYAaFjbwFZUCTj1kNKDWF+1ETMltVfNq77XGBh31drEBJRBMMo6MmdW6w7ByAdnOBKOwPB3RbYcWJ9EMTkMQhFPg05EMzc+RBwxoSTvDcV2KVVRDVjOSYcc/ehSsvE2k7ggebZbL32xI5nH4eftbIcqf1P49JRsHdY8pBW2CkyjEdZsfhBfwL23GuhgmnRKce1jwPKGFM0vgQPWBI1wUTmmyX0PU0UkMjCvXQ6SKqjFTiIzKbAuIH9n1v9UgE1HCrB/QqrHWRTiaprRk2oMe2pqR1SUQznG1AcwND64LtQPHOW/ru0W6TJVZS19GlT5nkldCa+rzihD49EsZyZEKtbB7WaDRNWoksR2OVy30Ob6H3Ix1w+MLzdVhQi2X07LQB48lZgUQ7Jw4n36h/04FZO1DWlU+0Ar2N5Vsv75cq6JJppdkywV5kxD+Z3wfgYBoDmjms62YmdIst6+zcwtpDIDmOa8MHTIfIhEKuUbqzuSQCWnXrIFpxDgJaRCl4ho1oRnb/sFwY7GTDl3rKOzory8aXnlnpXd1Pq5qDkWNo9VVWCeWAwi1VZJcnVI4wWHnNuuaOiaZYoaJL40DRqvHMHuBvqSGlsgs3byDc3s7vxbAS5YPUnTt3LvZwGNGZsjSY+5/B3GlNRNnJRqQAiacDr55LZbqu0w6PsBcWDJmYjQ1xIprZQT6pcVKSxJXuevXp/bhJuD+9qwn8CGgax5IDOpw+fouNiPFpfGcjcCa38g7p+vWMjBNpL8wi9JKsAjkztcX7uO8MR57TnA+ZRnE2XilX1eBSJUc3z4bOKnAr71ECOqJpGhm2YBmuVCQ2vw60hHwCcdeMDAsQRAkVSC4RRbmzdU28zhMqoskMIYmo7dYF96k7wx0bSuxjaT4SCxdenkulDFMFR8TMJieUzISODY1RfL4v06IH0M6icAcBLWKBdbfSREDHE3LOBDCgJKCZnAXGTx3ATQMjyXYBTS6yBfX0PH3eIRGlzreFnXODj3vmiqfbNZ4e3KuC4XqDMihYu8vwFIUrB68UvqUxu0qp1TBSGhj/kZEJqWStbiRgEs8ATvH3WX81ZGmD5kvO191/yc757mQFeEqfdjIvRSdq3rzJPtFuUBOtD1lj3CH0CZ2gu/mKdN0I4QygzI2F8byElgwNj5WwmpxWP44KZLhV5ZMJKCzoll5DUNdAX9+tLt3Ec4ZwHwlopobDmYkXYqCXxm2sFrSTysKcgGZzKh//wiyUzXB2swKdg9pIgc5pMlC3Q+k0DQ6iu9INT3FRIldv4rOETnLzTLM07MkckcrVyhES0H08vgD+LScx9AtEIMNaJKS4Yffx/XuJzJ66I+BJ5BpETEDd7So/6fYv7lIgu9llnZVPMNqLrehfPXgG6ZSoJzQB+xweJJvfM6BDLJ8saTaNM43fwvUvSHMholuwBCeoaoCKw2YN0/jMgH2MJf8rTVf5ADf0Hc7HTFYBJTNIPJ+e6ZCLgm38XKfNw0UNweYpQF3nKOmwx9OudJUSsyMEtIIHijrz+sITeh1sFUW/Gg3eTOhkAuUQfUdW4Qzg35DWlXCRdQm+QjgoHXniy6Wnrt4+uZ27NIUvJu3kT3Darljx4+Uz0WHVCNlNK8yvfvf1j3R59TMkmeaJzBJrzS2AlTbglAIyCegIJeUjZsM4FUY4EcWQVyfNe+CgliFI2Q2NH1RqeRPKRZ8aJp6ZGo2p+ho0vrXIOstEczedjCeLmDKyx54bIaAO+N4t8G6Z9BuciLahO4eVGKMN5dWcm69noS2YIk9ozC5XThBQBBYkoRNi6UxxB17cElalsUroPiJaMlTCGzQKm5uaRjoERhnZ06yb7TcgqXBTJ5mzn7SWzY+7p8oj0TFCTSRxducl82ucLf3xx9/9+PXXz4QKpOwljvLJgAYQ0CEYUXwZEzjWgaCJA0qupYgENLxzXCdKH+yj4nAOJ5KZ5Ik06mEOb9OEnioAVqDJTECLSECf4toIAvr0+yGJ5B03e4Q0S9HufU420x6Fcu+4ztqlp1N04+ODgzieZAPKJDR8W4ZB1QHZxFfKdH5CEez2LlJ7TkRJLBlKLrIep8SJTz2IfhNcVIGZYhyh4sLjK6deJp5+//Rp98nrMjxYz5LFUIlc99KDnWHfufERbpTAkpUfGc8fsRP0m4dCywjnzG2ZUUAJc9Xfk4SOEVmEod1kQjkBXQ+FB9At4X243cQ02NnXqxdP8ECB9PmEMqeJCWhTR/pTim96+IEIWNAiFjM9fWooT3lKIdNzs+jdmc72IH62oiw/S+w0Feg0N07pT2QP3u3FXrEKBpTX+aKiY9XwShriRCLaFClb6zRPTUA5hlaa9H7A+FiJLQ7hfiI5nciBoFIFQ3I+9typl/fYrgt3D1sn3QOtfbqeFgZzsTuJsbvfhkckl0+ePPmRf9glHT/cPC8UjFiGrNrO/ZzGxT4jkNARsGnKSe/OxqRx+BabgBJRnJUVBRn6OtEOIhMaEPCcJFRzJk+eQzgBVKt/SnW2Ii5iJKDQ+MZjgye6dCoDAQ2YUMmnU5HJCvQd8ZHj0nemTX1QdFJj93/3iesood6FW6pPwTg1F9yS0O9O37VJQ/JJUtfUISl1mmNkxqqEF08rUgJKv88ENJPjyeQUUIdztM1GMWyqSJH6+Nz9G1dvsz0KFPvfRh7kzmTS3Q9LrW6g/Iyt7j/9AJhfW2l+/eSnxw8fZmXFrjXWJ0QmywAAIABJREFUWCyTXBKVlwIyn2cO5WjVuIZDKzDq0Qcvso55kQWlMQNMLItgQnsHGuRdTZwTwo+SphqRtonS+kyN3vQURWmOZyfjidnawmODBpitZuhu/xmtcs4ke/lOVtJh8aypJpSQzjSDaMrW6xlP7/afwGq2hmweKF6kPoT2yxlQJqE58tlOM3VDvFBO+olia6bxmTYhZT6U8iuCOpGXozVL5SJGtbQO50GxL4jadbfZ6eX7V3Cb+oULuGD11au//MTLJl3OgY3kzx4+vnkOJ/CXRuXWCIxDpO48VXzSsefPNYgqdEqjWq1TyeSmelSLuBEviiXZk9xnChIZUWrq18uHn7OvS8NENEsoaMqkF70jwfCUBJQ+cD0B3cKypLvdylRRUBcMYZrGaHZxlMOZ4oLirHedp73hcXV6V2UYpaNfT/tPpHSXl2czlafeZ1HRYIMyr4lJKJGxyKY7u+g6MnmQdo3PhGsf6Zqw6br1Le9CGVOE/RMTubAA7BJ4iez8+dQLdEkt7ufGFXssJmBvXv3AySbW/H39A66sf3yl/VRZWcya1StWR5XVGtVc2EQuHnoyMTJi0SmVuq6OyhUrasQKAG3lo3pYUB7oHQhoUFdfLzRepyGgASP4skrOTMiE6iayoE3Nym6+UJ9MIWgy15u7+1QvkYpUSCGfPs8xdkxS7FniU6cUc6a9Eei0WUaVvqGbgD7talYmYKcMNxsJoL1VCdom5pBIQrViFzcno9YqgUM26SSgQ8qczAB78sFElV5+WLYmeCgQBdARCGskZFUcJHR40P+VyxTnmQO7/BfOrZOiP0stPVe2NCbGf+nSFSuWLVsRVRYjUA3zgSjFZxM5ap0y9nBB7boV6ypXrFbLVYZsPqoHEZ4n8ndJkHIcUX23SgDrmfl8fIhe7KYCEUkoWXplenY9d0qhqJMEFB/d2Xh3sDlIcl6UgEtO+8+2zXZzDI6mvS1tEeAO3zc+btNmmZXppoan2C6UoApSNvBA8a8X9Z3QNxNM5uWb1DoXZ6fYZg2PcXREY63WAN6wCn+TvtAAu4xaHxBtmoBi6szaSE5W82rURqVRoMbTtrKmNi8vMqpAQXBf/cDuNfrp2bMLpYej/DcvX76MwVyG/1evbsmTcSLKbPSwWeF7DjczH11XWblu3bqltTIlXWRjjemTGc6+O91yWZCeonqDcoK59y6q2WeOYP+xlgHF0evsCi6m76M1DskkoIO46EyIj6Te0JDa7DZJCJ3npbaL33qDBbU+c+Yp9aNP+7uDRHCHvTzQonDofLl+AnKWyaTUbHRxdZ5tHGGBVKYmZziTq8/iyyOPhSRAw2UhAZnMSNl44ukQK2Nrcysth7Sr6Jc7Nq86W5m3uQmbds6u2tS0Q9O0VIoDrQB6nzQdJ47ay/z9VwHjsrPL2AOsK1YvXSrWoX2E/AGxo1pmbE+KCzxXELVuHQFdEWVWVvXxSVInZrjvMIXvK5dcCDLEU2HEzKKkoeYRckUdcgZU06TBh1UUFtF8CQ4lQEKRsoJnFa4sPy9XNQxmj3fpXCYr9UypIlU2a9ovPC5tCd1P73bjWxKhDWud7Qkv6m1IH27igDaNGDELCSOK32By2ZHDvD9HtClHosyjXzMRzRyeaLITBUBLkG9tSETM0k2Vh3YNjwwNW7SW2nWR6158D6LP8X+Tpk2kOIf1Hxce3Hx2fm3N0k2bVy1ncsmepUtXr14Npqtj1qo6yMBoRrQy8eF877jA3Ni8yMjKoaFhEO1Kzy7iTidgBDEZPO8U3fkuW1maGtSd1os5WRZ2Prd0se9HjXv2CqAuTUNixAagCKeBhSQsCO1sHBxPx2BPliyhO3u8O2HeZAF1e1sukWT9Es9prrMTqp7eHcV0pUhvBYqvraivW29hcodPPKFrc5rm4mbUMqCazGEt2Vb+AVCJxQb0uUVA6t9k5dmhXBQVErPUf43/msg2palZm1NbW2PJ6Rh6wT87cAn5uZj2VOH50od17Wc3r1rBlJzDuZp7VpxdFhWjlqjxWYe0OuO5q4GB+Z7Hg2siofCVw5VD6ya6THR1FRSrCFuriu4AZ9GtAZOuXa7EUpEBk56cEQQyh2FUQCNyEDY1aVUNrK6McAAjzmxJS+vgOO6VEcbWqQzjuJLP6OKo3Yg1U0Ui2SznX+KJRexduOFRKVQo4JXYvOkW9rVlm8iIMgmNFL+FdrSL2qzhgE50TWQyEc3kgAoFDCj94RmtaqLpOfNI4HlxjW7t0jWr/f2XL1++atU6tbF282bclHC2UqslmJBS/NuSgrLcslyFoiC3zP/sCtxLwVguX7raynM1fmt1iEBijMprU0rPYS0jLlYILPWtrIysXJejhZAOGRrucEBxTKDzDnuwgiLnsMiE0wHU/MBzpsM4QUAFMtgYRCywpTomoJhwbqzGtjvwJAMK2cpqNyd0j493Kd+ZzM7tLblIUur6cxbUjf2BC8pNT5/qhFlZqqpGLvmkr+1OvwFGlCWTTR266ZhAcZ6hG86k3KlppIteaquEwiSZmZfigAotBLSJM6Bacd6qZatWLVu+bPmqFaui1DWrYQ2XEVvtKiagmxaJ6soQHUWJ8TcjYS2ZgOLvQ9nxN5kNXXb27PKlAKqQyhXnrnq+T1sbF7QoBJV4ItXNkevWDRsGeaCNTEDpGVTGJqklXWMDAwbdBHKAMyOIvJpI3d6eLZdEakoyO5RYlkfZACacsWW1EzwbB5GrCt+dfxQjX+Pjuqk1JadgkUg682c9Ekfa5ZAJQM2S0jlkRFmdtYh0/lZVesdzZkSbcnTombq4uujUDGNmk5Z7h2k5AVWwSgr9VpNWGDzSxAImCGikqs5/2aqzZ1fhgej55wmOLl0NauvO5ilrmcLnyGNbSEDbVCrtsrMriDfP0fFZsTSmJUskUpQe8V7gHYglUYFxBdKjxLNGpo5cMTRa3VfEgGJFaB/HM75ZHFWsU+HUx3iChb28WkkOBXFq5VwnhRzFwBLMxiJJYm2n8uyDndiAm4FoUSK5MNMJPaLx8WbxbOdJMZNbrEQkmeM87Zcf17f1o3fvqlVzZktwEG19EQOKT3MnG00DFg81FaROd3ab7zq/TTfBrCgITzQx99SEXtmQWIEvtYQrjTy3CGW5JJvMhApkkf7LV9GPVVB6iF2eFnE4/PK6PN9m3DujyVOszS075d9hVEl9gyPPTqxYAVlezrwR9wEsdFq91D9KIJOV5mJLoZe3p/cST+/80ti82hptrEIkgMZ3Zd/hovpGpvCQ0TSL+HDThEw3lDbWbAy5mJl5MU9GX31TnvJt5/nvAijiZ0M2iig9yUWF5dW4IAN1dTh4kWyOm+tMvaGbFH7aZO12ga2Idfk7PHExpa4bV2Yq58xUKFPglYoYUPLz0Hmm2U0C6XwnVxdXt+k6vMYklBOoLjKgGjZ7ESuCxJZwQHMkoljwfM7iZnHsmuUkncCJ/2Aclx+1rFsXWRkJFgld617kqHC30ZEjdXKVMbhNrGa24exy3r1zgejy5etWrImp8Q0KKogorqspi4qJyPf2XFCcFSvwVVKZYFHl0LChj/uSIaBM4Yu+608oOICMWY1imKoGOzLPxBiFahawKOY6O5mhUhqtsnuwiCLE1nJ9Nixoa/1gt1Ikngs1n62vGu/WzXN1m0wqSygxO037u0Dn6nBnz6jyHacLQRTao+hFnwY63402DIuPYqmjgsGz+fPMGs79mKVsCoOrnRhLZeIJKk2RE5sQixR5Z5iXhzTkbV62inuWnyVAq9bVUDBeWxuZu3KXtllpxE759iyJXGc2N+tUBeS8lhH75Uv5Z3XU6jWrD68NCgoSxEQcFYTs2LEjKTTQe8ERqULOzYHLCs5WNfQk01eMrQutTN+/G6O0RCMQdWiGjKrIixebNFo4IgioVjl7mpvzPAjrhBFDYlSS6q1Ob+jFSqcURElB7850wYyyubnDojfNncJTIJKYp/9CTG8LBUwG5J4J7zhlITloZDETe7n7BvVdGtJdjZoVWN1o+rmDRBTJPZQ8k68/N8VmBSNw4kq+mqYsiSIr4jkDajEvXb7chhMSCideqa2tPVq7LqasYKVYpY4MKatTEE8TeIoUR9csJ//FePovZR7ePyZXIJYHBa1dGpGrXrpj06ZNSaE+PgtPyYSMJ4iKLc3jRBMhEx0p5g0oRDBGqhsZUUt0ExebRvJkwqyQCERx75BkvKWfKK7RdZNcQxETyp/29nVW4ZYzJebBXF2mva3Lsej0syZ7G7e5ChF4uk37+yL6Dnkl/Ty3WWJld2EnA0ohMsrcpPME9G1GfprbfKNZQxn+mVy5dIIVGDUloBuMkGZipITSQs2ZGkmqooCzoXDlq+wCSuoMg1ijrqmN2ry0VBakqAmJyIPwYSbbYDCpEP6Jazct54GuLvMPidhRHB19WCxTSESKwztCtLU71iDs2pwU5r0gVy4UWesBmP2gthydGO5kGr+vS5mrGdF0yC0RBXKEr00TOKQqay+OyNXRNjBn19nmiRhjwy1KpwbLlekYJceBhmbdvDkdmKuZOV0nqBFjD9tkjZ8uFeHs3My/a0JpYNQ02j/Y/K7T/HdUDQS0iJNQfDK9hdzSiJkOP7jRCzWDsiUIZYhZKAhpYgqv0eTpCqTyDgAlM4pSjjQ1lQV8mraOVWvsCg8RXbF83bLalbWrI1bjwmXfoxExh6VCVUK6obp6d3U6FpoIpXlrlvr7k66H7DgQ5uO1MLpAJk6l4C8iIk+7adXmVas2rwmJDluYK8NCGeFlRhQlZAa0E5MjlCLhAGVB08iIRq2cyJOJZB2aiY4OiTALu7DN8hn4PtymzTaXFej7yXlhYW0QdhLgsk31vLed3FzwfeYYFxFPVztQt+lOM2e8S/JprzT/IlC9pX+wK2EmhFqfzYByoX1fX4NpBCI6YuRbUjAPOiT0SIMvFojkNVw1ChUPXYFAYZxghXzK7CQPpbEjVAs1R66yiygc9jpETMtqa/wjolbCHOWtyUUYokowNVRXf/Dp9ap01BOIqL+/f0jxgTAvL+8wryNZ8tS1MJapuUkHCipZ9LVslX/M8Xz8gVzCKb1I1c2AwiNR6/hOfLcqNmTkSHGHXD1hFMq1I8MdE2ahov1Iixo8ob1orZu1uvE7CLBO4JMqRger9Onq6U4wrqA9V7y2VBw8y9FUuljajDJZrNPftZ/WhN/YPN7bnTDL2eldOi1JzYMtTEyLxvWjZ+AZddYeHyp+MmTBqCtEKUSyPJ7oSKy6IBZTUGzWBMPu8gtZ0lh/pPFG/zU2oMvg3JEprojKjYpol4pEvpWRFiOpu6HBkF6OW4M/3Z1AS9SkudE7osMCvbwCveK8jkvFWeApkRQkhUbVsFh22bKo3LIj+d7tcuFlhSJIxA7Qscikk9ZUgmeDStYeMRHRgnFMs0gimIjsGCmQiAQtMQVyMHGj/Wpzjcru+L478YiSRDJtl151aKazm5sznZkBzyzZO/OdHQMmt+lvmWOnu/xjPOklewebTUbTZ7u6zZYZeil1KGLhRHIRHZVC/U1nb5q6kYMEyIhYEcwoT9RiLhCYxR1ElOpRZllpllhsNMqVkZs323lGRrLUZnVEO8p1QYKaZqVSFaRvSGlIV31xff/v/1DRoCQZDT4OlliY6x234HhqaikizaCg4JCw6ILINRBPekVior0DF7RD4yVSzFaIJNB4OjkDC5pMpTq5UFx2JOJIrDAWBjQWxRPySNIy4gkL6MpUPgFFqO8GDMiKJGKdShnrAts5zXn+fLc50qws+TuublPSSzcXZ9d/kCd9htkJ3b1PTTCUTrr0cQAtIqI9VFLsTrDApCtm8GkqHW3UxbI6fJ5ckorhAzxo25sFAoFR10HjuAFp+4bFFx5moWgsCs7dZCW6rpIBrc1duiOPyp+qrkM6nIwwNVSlmES4t+0Pf/h/KzIaKLAUZhUvjEM2hKHWC6l1peIgkUpxNCws5CikfcWKyKiYA94LPT0DC0jblV1qhQizYASUlqqjUmfAa6IoKy5TS+QCqSx2eHh4YkInVOTGFIhJPlmaMyMBE6N946YgiUQiF/sKZrrOdHJ1xvj8rLUyqVT8ltvrWmx98w/qvLgZZnkeXqS3VFUUS1ibMni9EyovdshsQGkSRaylDK44Sxh7Tps3Qiqv0UJEtWZdx8gIXFOapgBApaIgQZk/eHJavyKSnto8nqdQ13xolw7ms6q+WiUUmep//9Hvf79/fznz3aX5lF7+5kjqhbpSKayCKjgm7GLk0s1rEOivgXFd6Bm4IP8Cs57NNStVhj5WaKeV1X39zarLWA1qLhXLhcZYLPPFlQVDZon8cIvAOIO+B5KzGTrTeG9fSoJckVVaKpg7c76z01yUJ7W+Cjn6B8Fz/3F0P0v0nfSng1WmmRB6mb6XGqn1vT0Q1J4iLM9rC6mTT5qTmKPsIB+eK5OfKzuHgaORkaZIc6xAO3eezjLCnomC2LVBstrNa9izmSFdxiQ05vgpxlMobjMqEwwp9SkNSjqk+ekffv/73//h8+vwuSBaF+ftveDehQvnBL6QT6WyIDQsKWrTps0xIdFeC/EsCPQ+xRy8qtli+gLjyTg4QwLaG2+QsHWWcpk0WGKUqnFcMDIXi9Vjo8w6fjTB1Y14Dg03q5TGSVG668y3dGJETv+nNLnmfUJ3f7dplpvz/Fh0XYuS79A6gvCiO8k96B7Epk4ePHGdY8wlGS2QSAvaO3BrdV5uXqxMPVeLr0jdge7ZxFBOlkJWg0oxxBNEl1O0cxbNn8plES0XuOhR4auD+dydUpUOXx1U/ikE9KPff/RZSjoBlZwLDbz67NnNuiyZKAiduKiw0E2rNyFJivbx/M1vlkDjvc9RG1UkVmMAGzsCaeVCRWcjbZymswxtaK34YsxZi8JrjRSrgbWx77hQxOOKotls4okG37y5U702tN7Jbdq0/wygTgmGwXEDzto5zVfSQDrSsWzWRuihNRsSxeRJHsTFebCiIWY5euZaS4FWYJaJ57hgvGKW2ay2dAxb2qSi0higXMWElCs3nV2XFxVypJQPx2VrBVVV1dVV6PNSILn/9wzo9adVCfi18HLdlfPPfvoBe6eDFEqVOiku1H8zJUkHfLx+swRAF+Rn4W9JVLsE+gYkOSgQY+l/Lyx+glgmkgvQqSpQBskEFq3aiBhB/M5sW1dterNSjTqSzjh75ps123XafwrSeV/0jxtmIIeYr4aN70u+01A+wBIzxKJKkd0pWespqH03ReSKU0ulMoVOrFC+O9vZxQWRx9xZb6MjJ5OLxLnQdWAEzjWranMqz25eV7n6yBGBhO93yn0PfVH+77tNFPcIg5pPEM6P9qdUdbH4nnqg2Jr/Cpm6WKk6GhYXHYn2JixomJfnkiVLPBccp1NKQTr1Icx+UutisDq7P7473aQWlCqCa/M6aoLRkJ87Cx17cfA7M+DbEbFPc5npNN2II2/A+fbMN6P7z8GJZEyLnmnDPCfU5aeLDQN9PT3Z6Q3xfSxpGjQppTPQAHH8rG6zzNrcHQdqZHPmz5g+4+0ZM/D1Oru6UaTmhDqbWCYRhPiDJfGEQ8rBYqPKSsjnOYm9g5zw7x9kpChJc/F+NUT0o4rqL5Qyyn9ePfvLT3/9K+5yEYp9lUpxjLdPxNGjtQi51h3wWrhgyZIFCw7jdQhStuEIC62+gO80DI1X6U1abc3hrJrcgjbEl3LBfKfp02dMd6K6jivFlTPazDqxOdZofotOHP1nsfsZorsMg93lZKTdSpU4ZtLTr8dPnKev0gumT5tiXNyc56gFeSEC8Zz5852cp/EpmavT7HeCFwlipfBIMf5cvAQxRXHpqNay2p8FoMLLmHA4r8D9oV9+eaw8iC9wpH/8h99/9DGTTjZA8lc8uMpFXqNWqRaFBoZFHT2K9uaKdTt8PBcu8CQfj477oWYs7Orc0tkXX6XSmUyH1JajR/NyBSuDZRKZVBI8i/Ju12lcbsQyQpRhjGb1bMRH/5dx4lGnj4+b0DmCs1OYIKIDhiD9INeNHTTMJfmbohpu02PF5gKjrMDJmaw9vsRZb72LhnvBuVJgE0etoSyJuaWztR0dRwW1MTtycRRbdAH77q9cKdBXNO798gMYTOHlhz/95bKqev9HhfWQq1d/YTD/ygnoos3NKlVBoM+BKLRGKEmK8FmIkv2CFngy8a7mdD3tZqE9vri6/WheXt7qynV5RuxFN9eI5W8RNgdJRAg9RzvLxZmK8P/XcU6jkzb9DSborKvT28g/++JHMfjQd6eHDbSY3lgFdJuJezBktIXDlUbP3lWK27RHDx8upVhSupqCJVSG4JfW1XbUamtiQsjBi7Ku3H/y5Eq7ejfubz72BcZInj35jz8/eaV6eu3Lg4M64bMf/vZXK9BXQnneRbVKeSrQJyRq82bWqdsR5+XpuSCwDgK6q+0QzsvgCgRMLqkkQml7TG5UVOSEViQyFuRpRWvf4HTc3P4LSFpfv1jl6Lip2Q3662TEMpSBfiXC7t47d9jAQPP0n/mw6VpqWTk7TzdjaKugpqamIJZ4ioKX+q+iJIk8Uy1pfFRI2QWSRvD84coVi6Hwf+5tREh/+fF/4ALUJ5eVg9dwa63xsp3nX3+4LPTdcbErSHo8MHT16lXo1C2LSYqLjsA9au1iYZCuzZTQgKkQmvZWBeNgsrQ9KqqycsISFFybm6MQz5j2XwfvjUbURQcRPTSdYrXpugbsKe5SqbvQTARRXHljRG7GtMdufFzdbGfzpjm3qWK17GmTk9sWrkUTGECpehkJd2Kp9W/BYiXhQ2j7Dz9cOWza/dv/+WVKgvDVE3Y/70+XdeO4l7df9+qv9ucvCPDDLhYEZeV7J632R7F/+eYdcfl1UiksMBTefCihnE533BpoVvnGosInDM6NioyMqmzT5naY5T/TSnP9L6Ps4vwWOtGH1NQycWrWdfcODCf4znqrYfzWHRY6KdTTp5RW3Zyt9UIIqFKKaaU2DBYGSVhfYuUatOJWnAXRdRDQmhr/mAIJtulc4YDGln/2L/9yXS88f5+7P/onoW7w2h97+hMe2wX0r8+El9t9wnIkgrjAkCj0TletSQo98pB3YjLw1A8yngbwNAcjfJeocyNzc1cXaHFq6q2fqVu6uf1XAYWU6U3D2nRWQ3XR6cfRzla97TTb0D3YdwdEE1TGt6ajgjB9+pusaZsMs19rpTIWVVIkJAhZCoOG4hLGRI52qHMj2sUi0eXHV86B5w8F+k/3/q9j1UHnOfkkoKZr1w7e6lZesQP98bJQ2hIWlic75xMKnMvXrNmRfyqVwymXrgTPccwpxvcblLvaggEUIiqroXpBjSBW1TZz2n/344ranVI93KyfSXtKZkL/+8d1uunOs7qqgPRWPCYmJTrz2++YC97wGrspxeo2XwkbT2QiJKkJocL7isjaozk5tdqjZWUs43z1rBRErzTXf/75MYPqwgOe5388k4xeO3hwoEt642+cj//b3/76F5RMIy5dKpPmeeVD1Nf4RyS1c2UAidjcdghniAda+wZG9Urj2uBdwcHBNCgtzUVDtUYqMTv9NxtQzri40J20RpRI8P7c9O6xIYtqHqYbZs5uaKhCNYGq1hLd2zPd3tCIDjKqg1XEUyGlii+iJn802ZZSpens2cqCqBDcR1CalXr+skjx8KbAgJOVDarSR59wtyxufKIo7ycnP+7/8v5Pf8GD2fC/vJLLUAW9GBLbsrA4irxbUpSY03aMLJuwm3qg/1Z/Q7qubVEwe3yxDEtE42OxkuCc/3acfOhkBFEzqYszRidGh4bUyjluVFydMaerGSYSifp01zdEHq5qkVEtpeKwKJgDWgrxZK2h5Qjvc2pX54kFLSFlue3nBKlysSkFS5+ViptXiBvoveyo6j148GDvYObCwPzjLe2YEX94/tV5hSy4LCy0uCDC63jZ5jUxESGpZEzkOlhqPclnf3+VKf3QypXBvr6+RFQK5ZAU5KJfONPtnwTotFk6pbbGbEYZz83NpANRs9GZmXE0W5DEuf1MHOdmDPJdJCagkmC2CUR+eDN4YuJu6fKla/IsS0NiC3ZERNbSc9RSXn1s/+50lUzBHrEitmMcV8j/8WDv0xc+3j4+Xl4+cdFJx4+0HF4phVNKak/yPhISEhKTVEAvlcjcpW5LUJrG+8eBU9+8cu1aAN21K3jtyrWk9AqzXDLH7Z8EJ3WMdJK2GqMsdj4sKSrwEx06o5OT89/7Ap2Q561VULQkSRWjASSUtzOgq0ntV1tqdwgKDvhHHq2xnHg6PNS/df+/7i9vHl5RWTlMz9DZoRRcCr/tYG9VVaX/ph0HDlwMCwtcGOjjc6CgLtSn+FRo4PHoA0nF0cFkoAF0lypo1+hogz5B37Zy0dpFBNR316KVK2OzyNNLRLp/qHf+X0V0tk6uksvbqMrhptNZhizylfOd/+6HiSXBK+Xk3iW+Yvqu5aW5mI9fw9rBHTVramsORETlVa568d2t/v6t//v/+detoxOZL2xP94mD27a19g6Oj6PslteCZnxxMbb1+XhFt0d4JR2JC8z38gkLDTvMIggJ2vcipVnHcC7CfySga9tWskdK82Sz/ln0ndf6d3TvvsVlmk5mZdewVql2cnX7e0BFwVk2oKTywbE1uVEkoCsiayKjDkcXx8SEXLz0/Nbg4ODuTz+7fu1FEw/z+Zkzmqqqa61Q+PGhEchnaFh0dJhXXFJxsY+PT3RxWP5xXBnq5YO+XXSsiAvK8O+LdcbgReyBgAa3tXFAIaM0OvdPxRPpkJMTV6Jxc5s1T6nrEChKIaO/aOZdZVB5CQcU82kSkbQuK7YgL8p/+YoVR2ujOnZEHI9ICvM5MDEwEBCQsjtj7PnFi5tAU9N0CdQO1HT1D9ztHh1CW+ViaNiBmOIwb58DSTERsKeQzmLvuFACGud1RMoPi2BQVOq7duUi/gFNt79cAAAgAElEQVRKXkJXrvSViNY6/XMRdeMaWW7U9HeeJ5GlyiXzZsyY5fJ3gKaS5KCvyw4glJ46d/hUxIFNyyCglTX+B4rz8+O8Lu3YlHnG59JY1dDFMJ8zOzZpNBcveS15PzD08KHx/u7RVUnRF8Og2xFl+V5eYWh3lEX7eHl75yd5hYb6BKJPHxfXzo/fyKXw6ytX8jBX0nsrbUTx5bpN++dC6srmwtwQILk5zbmgkMlxWGvlzF8EKlLIKAoVBgEobFxB3NXi/OhoAM2ptUReTAqNDoT/vnTJB1f+XtqRdHp74JlNO5rOXPLxXPJ+XNhxQdf40IEw3F7r7e0V2nIEs2A+Fzdtikjy8fH2Ls73yiebiuVocaEFXNagM0pJ4VdyQMkfxTKYavXKWBRDZbP/uayoQycAYuoyfcZsQexb039J511p2oAZN5EU4ahEdDjw5Mm40AOrVgxbaiqjo0OjQz09EQ55eWL2eKEXjia/T3e6QaU9l3jHheHqeOi+95Il7y9Z4hWWH+3tTYYAgRI+goAWH4mICQmJiA4N5HrHCqORFH4lB3QRc/CceDKuwXLF7Gn/1I+r898JnFxk1kk4oVhKA0ftp0+eDA3ddHZoWFsTERoXFxq4cOGSJb/5DRrAC9CyXLAEkuqNdrDnwoV4D7+5gN5lD6SU/RyYnxTqhRcBQI8fCYkJiYmJOBAdWmdV+LV2JV+0MnZt7EqHJ1ginftPTPMfybDkXEmEmpliAnr4/Q9PxkWvWYGzwlGgGRrnyQFdYH2WeHpyBD2JrPUX3O9Yf/aiJ/Bqkk9ZBPGMCYkIPY5ep0jG8bTZTZLQSURjsSDFZdqv+ZnFaqDsP4mMgBYExoWF7li2YlhdEx0I2wdmdqDoWZJI8gIZGOgA0wErfchCr4Vxx5NC26MJZ0xIUhL1oCUkoIvsQPHeFAldFCuVzZnm+isGWsBabSwzpLAex6ZCL4XBgq7LaQvxCoSAQgYdgXpyQEkuPb29HYF62t56LvReAqChR5KKz4XChMKGRgjoEyiQGK0loCt/TkIBWP7ur5nnNG1QkILKZzxPiTD1wKWLm9atiFTXhAV6BsZ5e/Eqv4R4LlmwxC6hgOr5OlH2UP/dK7qluKwulCxoRG4W2RWyoGsX2SMmJqIrJz+LVsoUs37NIioI8j2aWyeVi/hHqFjahOmwdbVtZYgg4+K8rEAxpIAzMQscVJ6D6mmzomRROaqMp090WXFuVnRETMwp9KrYQD2FoI44HbTfBhiDQLN/zUBnK2v8/Y8GC+R8aiiUd5zF4aEVlrXFZCQDiScvofDvrwF1IIsjsTagmLnx8kkqS2qXFkeEhAj41geOM3EiafdJi6DjUilnV/lASvFrllBUo6W5q6Oidh2NFUn4rQI1QwS0bWX0Qm8E8wu9OaAQugVxcQveDBQcvT0DQ8lHcdKKKAtAo5IOy04V7yiTckknKfwU9YYJDcZMmTiYxVLMuq6Vi3/Nbn6GeOVqjB1pF/EtChDVYvvP0LBOHR3m44MsnAf6G3ia/J8D6k0gQ0PtPgp/3SssKbf4sOhcUtJh7qVScDmnNT6K5SRUKsdcp68vH55CXhWSeb9aAaUaqqwWR4pWLAs+XMf3JEVqAmpRaQ9Q5Sg6cCEfNkFAiwM9f0ZCPQl36EJvq2P6zfteXtE78orPCS8UR8RyUS5XFLEFnHDujKdMjDlk9lDJZKVUIpv7Kwb6TpAao9rLV6w5XJrLdSUlwjYaHG4OqknCvHFoPg8Uc4he+VcpRZoKlDklT2/gjltgBwqfdCDkcNI5oewUJ6BQeKmjgLJgaZGUBplkvsEMKOX4wXLRrzhqcp4r3hV5Fqdllq6OqSk4zCu9EUBxHUMOzhotCc2n80YLaQxxYWhxcdhCBpQhhBfy5N/Bu4g6k0h+uXjfa4mnz6Uda44CqOi8wkHhHdw72KIEinNhsuBd6IPggYiidyCf86t1SK5O84JqltLxo+XL/FfX1JXKOd20oLkhZUB/E51kA+oVHVEct9DLquGeFKFSaM+ewIVeB/IpqGLhUxyOHHtd2rS6JukclzWQwvs6KjyKy6gui+USjNRKfflHuhYKL1zr9mvl6eY257K8DmM37Ez2Uv+C0lSmnHJ4pQ6x5OiOHXHvOwI9EBERyoXvBDQQJ+JwWpv+BB4IfaTi6IVLWP60MC4a1Sevi5tyC9CcE3LRGBTe11b9XIvGsVQGbyShyrZErgBT/Jd6AeGw79xfrQF1mXX+1c3SwzFYGXD27Apo/bm1CloiBiM6lCOTHN20I3RJdHGcFahPUkRxNEoenNH0Ci0O9eISJQLqvTAuInQBDzQ62mvJQp8dm3IKiks5+USpWyq1hkzU+ZCiDiNH11TODf8AqRRnInEsVDrnVyugWBnx6ubLcxdaQBRz9Ctw5vVwqpy0Xjc8bJGJcjZvCl0YXRzqADQiPy6O6bj3wsCkCMzMezIJXbIE8VIoASWV916YT0DDIjYJCk5J2fEEyjkRvPPlOvJACjlz+zhXJMMDScUBEgmNj8xy/tV6JJd35Te/uXHj8cMjZUSUVln4R+H0O7597TqtTFizeXP0guhi9DK8yGQuCIuIiEii6qgnfDh4hSSF0Z/wQBegIbdgIbOhgfmQXZ8DEWswMCViQEUkgGu5uDOYlFvBdhQCJ6YcYEkhoOjNq3FDSJbLtF+rhDrNkzz+6puvvnnw8HGLv3XP0pqoWCqP7qoskAgLNq8ioPkEFFnnEgJKjcxowugFoDgnwwrOlLh7Liw+7r2AKzbHEWnIc1SbjM8V0K3iQiauES/l1pOm4j2xQqaQZgkKCipXLPP3LxWZXX6tMajbhcsPH2BH8lffPHlWd8SfWxWCeDQqFt9skFogF9atWnUAoVJSIAPquSQ0IiIkIiy6BUQXMqCbkrhjHeSWPL2uRnjxIWp0cSB16iLypDjEwLor5OKZg1/LnDmt0MXUmFShClJJFxUcPhVTVnN0xYpVS48GSX+tQF3nXX58A9to8Xz15HxpDAaZaLvaquWrV+PwTJAK03iCs6uSvMOKyfcs9PZEGAqgO8JCY8qO58f9hlR+U0QoKidLSEQRPl0t5mL+Bd7oylOaFKFFS8XWOaYYdFGwnadQQuV7wdHcqCP5gT5huVqcdV4W5Suf9Svl+Zb84Y2vfseA/u6rm6/qMBy2nAwpVg2ElF4WUdE5dtmqiDhobn6cNwMavRnNzOjQkJaYGED2Yfsu4jyX8EC9iiO82JmZhaFX870WhiXtWG2UclU76k/7oge3lqwnLCaX4spTBXkw2mURoejree2AiK5b5y8QCX6VTsntLcXDBxxNWuz71c3zdWX+zNVjdntVWV0QVZ5WLjsLoPnHj2O0Bu03BhSbGkL8Y/7/9t4ntK0sWx+NE/9T/lZSiiiMFEvWwLIRHlhIByL5yGcgcVQqGYMQVsmDIyEHAl1EhlgDEbgTUejPwEZYL2AQ1s1AfmjgvElaIvGLYzeN6aJJBUwGiQnkl9ykSF3omvStelBdF9639j6S5T+ppNJNle3qY8dx7EpS+bT23muv9a3vi2HZU68Y+FrYLtqn1w/NxTw45VHDm1tGgy4aDpQmrHGpUWbq0VhnWPLO8fSmypVaIOa0OWchVTCCEF0oYe7GWXKtHEZA20//8Ib2zyag9376oWAigYD7/QP3/7/7/Xmia64MD459ZYwCwEAUTXbjrB3j3mPTdhNUG/Cl0PTYdHj6K7STLSNIRIcS41GQmKKzc8tzIeyw0xlRLNCYOCvU+zVJuloCT5LKF8tZm91OjMkYUi8L+tMWXbi6YFswZWR/+2FMQNfoPPq89fnpodVGU52QFsFjr0I44Pbg4PjsUGg6YHdO47pknHWiORRggIJMFojOhsEQAaLQGxjp86ANNTYNRRFstLOhUGLMbpU0ad5awTUprrk1s+KYcUAJUNRUauExmiJ1OsMsycULAo5EJgtRopJ0CAE91n5h7SXhySCFRvpj/PT3H9c2siaK0GG6NRXR8hUikKnEgJJShETt0vKSkmXPIrHsMMIcSBCeJNZi6RvpzRVnByBzR4MjY1+FEuHY/ES84EDxgzUBZGygbkSoJFkrRUAOcp89VoslQtgw+vpG+kYsxiFn1lRNYiry8AHafUreenJveweFUjowvffjD2tfmmiUBrPctoxo8AmLi/n8aqWSVdC3XF5epva6s4b3GtQDoXhXUzL0LIXQ4uwNa0yzET45Mv3VtF3RCO44EsyUi/WnvW5Qv92OSWvFiT/FGaPorC3DUtfSxx/dkDGR75F90krnIQzQuPzoyY4FT5h+/vSnh650NTJIUhaBCugkE9XhsQQIHzAPH2K8BSMRlPmDdv0UqMoxJbuaz+Qslt5la9IWWRy9fx+77PjgYlIQUdiU/X7GEDO7HFZ/j39iHoFJ20YMiMaWp1CjQvbQaxmh9p82LGLI+XTHIcyaUGPaevr4853P428f33uDGoYsujWaahEKQr7J+QUogy0tg844l8hFgSDxaPnDq8hG4tImlpaWNzeLGoc1X1oYHMCplZl3CAU3FEFcYlpm88pmIR3vmfSbAnwGH3uwHdkSL7PoKe8iezWX//ThvHZ2nQSgn+95oEn93UPeTJ5w45QXNAuDzjC4cwxNghOAeiwMTT0TZgANAgCjQmoJJpaVSkljTearmYpGlN1xTZqEmVBjUkmhKbTi/IqdqUQ47bHYNG6n7OWxQDJjc71cSHvF9sN6iz8uv9kH0L9jG33IWXgChhe8eUxkh4NAktYlRSOrMlkYWQQ9UGI2BemZwo9oNJcDkz5crBRSyOXleEETl4g3AV0xzpvCL3z+jJ1NONsDsfAUqRFZKDqv1LY2NrZqz9PptkN6STrWkfru3r3P93kek/eRWUou4j4vLkYig7NDLM2kx2JsFOf1dDL3qsV5HVDN5eaW8NSWarXl5XoZsehKpQsbqMUbpJTc1CzAXKxznK15ZyCop91zBPbAr7Zef/fmydU7VwrpQ1q4A6Aba6+e7gfovZ+g8iPmMwqICe7sQmT4KwK0D6JByNw5kgxN6tH3MhIecGElJlBMEKSJuWXoiRYrGgcOpHQKpRFz4zpPr5S1mh2zD48NI4f14I+AMTCcL97AQeSbi8+e3dlKH9YVD1XctW+f7t1CP//86bc/GBzVSDYLJufKQgR5PWjeRhagfcQYa8CqlpjQtwPbaYS+QPuqBRxGTxBc20BAyZZTEKnCjuwVpYZOicudnVcQok7nrE4LH0UOJtLgv3xBRsGrG+2HtlR/PMVPpd3r/t6rNVceE0gRAJpcGF2cRxMEKx14UmtDq+V0MYZkC3WxlygQiFVsCxYLTSghbR/Ddhqn8TyXJLGBCDgIymJGAwVNeyARXX609fp/f/oRd144Br34DIZC1+6spw5x7yP1ht089wB677uH+cX/ZoDOj0as8sBwIMSK8nQo6ZqM2519edwc9YCd5MSQVCINCIbtUGQNxLJ5yhYe8rFcTcYtZRdXvrRnKvnC69dvfnz897//nS5qL8jq9zIBengjtP3C63v7A/paagJ6f1ESRu8Xo9TZJGLNWwDVE/UePTudsc9joV6IkYrLJBdscsaKFXKWpswhnlXykyUlORMXU2uvH71ST0Wsd/JNvnz52Z36oQUUiH7Ei3d7AX0jlzmg5q/vf+0SF/qLCZZ2EqL7A9pLMur6UDa/nmOMMRTzh4BokWYbIcwaq7jpOi9mMsqfJjRK1SFBzX774vv4Kbw/yUjs2bXv1063t3d1HU5AT6RePt0H0M+fbv2gAaALGoO5dD9pFhagZIPQ7GOn/FuWPAVooiAKk/4lC7XoWYwOJWKEJ+qdgWJecrk0imJTHqxksujDrb180QD08dNPvyBrO1rzz1Mu8fbKmY7uX0f35l9MEVvbapabWk/6p4/WCgRoASIEAFReGASgFl4QehugdBKVhJUkhEvmtHqGvYWITTGF6YQ7TbW815BarXz5pXsSVFDk/Wv0arIN9N6NS1+Q/eJlsksvy+UHE9BX1Pwqykz/WkQ7xTf7AYpj/rt0FWPccYO3yiJ0MDLNAEXg9e0HKE0wWYxh/60kFGB8dQAK6EfQEAGitObpvQZ1VbBDmJwtlBcFybDVKMb+BRagn3DbxcsXX3ozgew85O6Es8fbD1uQnt/APrb3tnTvyetUCYimDdLi/RWzI7KgRIkq8tYIZYDqFGFGMz+f9K1rURrl+wMhyla9CXW6PFOwtCY18/kv/wSRgQ3efnn89LNLX3zSsGK8uCmXY/YxWzUpem+eaT9ka/6U/PLpfog+fbMGpbtFt0FeuP+1pjQaoSFYdspb3grokLEoTyTn89ZJilBPH2VPoJaoMYrR+1qPlM+y+WYyVRvOCg8fsfVx78YXly8xQFmMXiukFFi3jNuVkv/24arjdR37mG2i9xpXpGaW/2JrDUFUTRnEyPBAzDk4jqsSVdVpEb8FUCCeK6A2haYx9lC9R22DUt9uGluo0xSrSBqnQrYLkGAmJ5Gk+Q2d8/eefsHMVtnz2WeXr9XlrB0GQgP2cadGOGTNuq4L3+0NUNwC7z1a03z55ZeiwY1Ccyw2xkY60UWjk/stgOImZVlO+yTZnAdLB3UojOJ4cG0CQTcEySY8KzczTpK/Y8Ys0L2sSt9RC+YeO+E/gck3IvQzbKabqXk7iZUODIwr8s2Ow7Xmz8ns33SvkYDe+/an//3uu+9eb3jdkGyTqSkPbaAohhY4BdT4tsTeOEQVvVzF79rY5KycKZDKMM5Mdf6oghAtCXm70s8BtZHCluKmNX+PpaAUoV9QgH766bPnZbeNtV4HnFXvg0MG6Emp/KQJKOB8s5EulMtlTVwQNFV0keft9jF7IIRIQwft5wEFHYcmPopLFh2VoXSh2ekwWvgQePgq5Mw4TW6/YmJwgsqvUJD2f+l9g5fwmy++uKRap8OH/saNb549WlunNQ9ANYZD15+/gKP27wAU6eC9x1swlKvXarWlYq0qiXk3hLkDw2PjYepo8grTzwFK9HvqMzHSY68WfZHZaSY2bJ8eyypZfzXAjcAGRxWFhakt9R3unshBVUAvfwY4AeiTVMHeT11sRZSOH7bE6bRMy47Ohnvfvn6zDjTRzCzWirGyD3aocjYM647wLDZQS2P0SLs/oMQX0wFPDNUw7i1VUgBpOMaknyLZao/iBOf8Pi16GykHj0ZsqxLahJ9dojP+k2aE3rjx/M1aZhghOp41HwR5sV/2dEhvXiA+OfuOsLQV2aPAgEYyiwrIRsNggxEHR/9zgCIFwL5JgE7pWMmUfkmQ4vJpc9qUTFVjMw1gpUcio8y0jj7NiIUnT1RAP/mC9lDC85tPX63laRMd0BjOHb5KCZXtic348rs3taKtn/yPgCfoWj5N3JAOZ4V5OCSGo80W51sA5QiSANYUZ4fTF2hg3hJKmNC2z0Iet1ot0YMr2AJhOjpqK8svX1ymJX+Jnk9URG/ceJ1CJ3o4IsknDh2rsUvzcAtFClw2XyM6yTwSukIKGvK+vLNk1sQcEyWI+WMum1qTOqzr1sS+ZWKWqvlgi9diKEVTGYX9upcVSKIBzDwqeZxyVbrPQuwxu5gdZcdTRi6/QEmEl+4oGf2CIfrpy1QJXKCvDbc/PnzV5o61tVf3Hr9687oObuggrCKdtmKs6DCvOE0LguZLEEfADQOiCU6y5+Pd+wHqsQTX/bdXvkzwuhQyUIQw+vVEhBoL2KsTVsguwsQzohq0DMJjxalJPblIOSiDE+WRS2qMluO2/siM96Puwwdod8G19erJViqDvQ48Wyx5U20pb/ZVnaP9kKgxrwwAUJC/AuDesbJ8794lr6fyskVb8UJfPlkd0vEGnp44JRDFGAsgeQqYeiZLkcUF/kQi2cVIP42cpF5+0gCUpfeXvvj0U+yiTzYqgdKkfPhot9DJ6ZA3Xr1M5WuosFF13Vms19dh4QWP8vvzDxyT2elxClFwZxCkxr6+PYDyEIVVypIwAY/fLzW8eucJ5uYCZNSATJQiNFCVhEUem/xZxK12MFB+dO3aRZbU08H0CVv2gPRZOa1YJ88fPl54O43RPXyT2ihC0NdpixWrGiiEYk7IV0UmWFpJZqfJ/Aey1hCrjM1N7QMoE3EBm0Sb9618/fViNRnTotTUC0WcaWT24zARIQOQcKAY97kjo40FH1lYhPdXv7Oyde0ivyUxRK9d++TiJboxPXmtkYUz3YdtyZP4WPdxsDVXaygJKTGlQILBYgqTbdbI8Hi1BCDA7BoHBRR8MYguoYLH28aq8ggrkSIWwW4eik/Ol75cTN4KazGRiGpJEFclLHY7+tEK0Z0zOJcCdvKxBKY4lwbJBzBTeH4HOye7fgJMYHqReiGfXXokeJOQ6TxkJWbmOPZxyuCnXL5YixVgJTEzr5RJc0QsKdVslGZoEtGQerbTAqd7Or3jl32sV3+FVMPmgqGSgPJy8mY+RAN2dGcKgZYDdnO4llmnCQcYzbpWw2GK9oFR6P8z3UclXbtz5xMOaOOhE//Ss9fe092HrrnUDcn7ro/jvhLwdBaRLJlvlhacGT/V1KH2u1KdDUdDNHSEwoeFlUdomk5HA0kMWFSV+mBxDFJTNGiZy+bheVNJDPFLP1oi+Ab7FqVcwVoerBzvamCM3BsGqPxEiBbjq1euXbzUAii/Nl2+WpfPdh3GVnJ7W4fDrXDh1bjZgQTRlPeCgFQCjU50EJOukgkEMTWjU0e4db1sbJ5Wu5GupIxOYiSZMZxD2BWQP4GwpB9BOW9EP2TExoCB2jqhSX1kqRQmRJlwLgHqzKdzdy63RuglKjZfunz1WUHuPHQtEHLzbjsvZJ1Ilpx2dOCrtohtUTD74koA+b0VbjKTopswrWHYExU6LuXC9k/ObWJEPCOTb+OnFSqhdFhhf4U83hXQRjOrmrQopNI9bgf5I0r5GG3LTopRbKLOdbF+99qzbUDZlQmIPrtbl88fO3TUxnZYDMt5J8uYnEnf/KBiW4Q2Y1KhiJ2uTpqtGcVEl1EMfGAzTeSII0o00SCz8MvNbYJrV6+DFV7nz3r95Xoms7i6uooqYLnAHkwcVhWnkq3mYZAE5dwiFUycZP0JWIupwt1n2ESbgF4kQPHj4rOC99DVmrCHXpDzJpPdbsN858zN7KAt6/f5khhJ7h+YDk0nJ6r4dzNLOsbiZkdUDgQ7aIlikd+9cgdcuzD8AzKL1Xw8JaYKYONnBheSt/yOeKVeLGfplQiEnYsR+yCO9hKJEbtSmTBXyyYVcqdGxDnPsyae3DNYUTC5U5fOdx82PM+I3vmizTRoGx8YyE6s2BT7yqRvZZCst8ejOk8muUAux04nMwQZB0N2luxPjSDfwrQT16M+VD2/msVtf7DknhTiSgJU/K/+52+l0nwVMzizio2loIEYOJGjSEKrAjMZkVfDMVPMicEcuy1WletX+FWeY8rOJQB68eqztNh5yPA8JXtRVVNs89asaaAqVJ02jc83o9gxVWOfDlmM09UIOZsPMxMgXOhnQ9SlI8YYlUrQLAZvkWYTxxbmV2Y0Cioof50dG/3b3xYXB/F5FL8PLom4ftqV0eGBhcV8D9zmiJIjaYpUKGVPJlW+c+1yI0T5KX+JCiYXsYueOFRHfPspWViN2SKopoNvZMv7FWfJ6/NH7DBBcdrhy2UMFrODDFCU3ck4Gqe6UW9khXuUSowNOAdRl8uGSdQ2NB1Z/Nvf/nuxHxzd0Lhz2D4O1mIwFAybxsar8/mKsp5iE0vm9Hogpu6jhY3n19RqU+NUunTpOmp6V5+nHrQdpgD9WPRm5pzwTyk5hJWsbT5pz4o+AT3cAZoomDX26eDZM0qAYgOF1zEwBFuRWvOsOhqK4nIJOMcXqtlwiL5nMUYjpb8tLiz2k9B1mDZfvC64N2kxfjc9PBBAySojMRqeQa5g743RVroqP7nKVzyD8iI9/LNrW8IhOpbIq1ZcSjhhJasRHMlF03zemZyUqjifCFDYmUJmzRO10RztNKLMyDm3RKeliZpQFIARnDD4HRvCtKyFyp+B0uLCaGQcg4qojdKl1T5NGb4xQTNJaJ96hqY0TH0Ey76M/Ammd7GstHW15ThqAAoSycWXh+lYAuHWIRQTgUi2tCLFMTwzX6rKvvlhVERp0wx4dFRx14VtA/YBNuRJs5i9rM9hHPpqGqfYsHN8DPOF4ZCO3UEhGxgaQ3t4MBAi/eUYq6jYwyHk+R4c67WlBPTeLLp1V2OwO66E6VzKSBvPrl+/jLpIy5JnNefr36+l2w4VyV7IJKYz2Xk4zGoikfmSw2cdRAWIARq2cIXQUMw2Tn067J98SsGDGvwYV35wYg2HpoxUrqP70hBOeCiO0uwRyvQUn+PoQcMRAH9IzBQO9pLSoH7dK3NDMQMM56cxfpsRDC/vXr54eSegdDJdx22p41DxQ8XS7LStOjOhySQBqHVCzA4DJoZo2KLjFPBEEV5/zlg4yMdoIAk+B3v5iM1pxz0/ZGRMRgLUwmBUnICe6OBUCkVigAAegnYOsqQQcaCRbeUNosARRV0riwiHI9Dr59cvX7q0M0I/uXT9+tVHb7NRO6AXz7P+QMKkSeLCOa9kksJECXoOyDpp0o0Big4SZt6BXSBWi+qRJqEkEq1XMsVYmB1SqnoT8OylbXXWWaTJdyKDx+z0KgSmE4FikHQelGkdbcIWXTAN2YGUxPdRg5yvLWdg3Pvo6uXrvPmpAvoF/Xz9at2bPkR0MRBHhNLsuGZxeHChhCvShHWQ0nhbDIA6w4yHTKR6dIKRSiZQ8xgh5KbmNnFEEWysrMRKouCCov45HStSM89i9CRirCJNXheQ0NLh9Ldhep72Yd2cTEI4pHXFpkJc8WLGIKbEpbvXr1/aGaHISK9upsRD1UhuP+uwj30NmY/BRWdeckQGgCgSHCfOmwAHtI+OdFRFEx51ph1cby1P61mhicHJVEKjgSGkCpMAACAASURBVGKMwMMlChsowzMKFREd6k7IsMIQeAO8Hl2NSQv5CVGaBTMbUuhWf+ktjzy7fvGSCij7QYBev0P3+d/EMPFDdW0d+VJyEUSjBcUvZoHngC08FOWA8m471ZKIq6ijmUSGHVNoI3jZJBhxRrFJBqeRaSUIP4s+uBwLYPucDrJSFLGiQsGvppEQYNP1VLi2EPznaKyW6Y1JyS+TuH9+gnSpUW66TohevHj57qpB03TU6uo64ICiGqqR4Ve4AM5BNp9c7CcFUWgGRWMEqIcTFmhYhsp22yOelIWyTwhPykuxzyYgoBGY9RhZhymBeoidBMcITybUEIQwCbU+w4mohusRQ0sMPHszG14S5r/++uaDuatAkFMe2Af0lC9dvvtEEoEn8y7qOnbg8ezQyJA9ngeFfnQ+OQqfn8H+AOSZggHcGWOk08TCUM8mErZHZht4sm9Smk9ybDi3okMepn8ZZSYVhKenj0Uo5Maqi3RFRTUgQHKvkgxuuMNNln4kImieSH75tXn1KpsDYXn9RUTotWtUw8NQSGdbG3nEdJ48ceKjg31x6j6N89WhQXMXgC4OE49rIEp3yjDyJhL+MXIaOFSDRkY4Y34bTJrrZIcRwpNuROw4gtAl5BnHxwLwU6L41LODDFo381XCE4hmZBIY8ztkAYj6JVUTb/LBn+Jr31+lJc8vSgxQ4PvJnbIhnS+fOn/+gkC6mP4DPfvdKcDWKw/TR6V/cREFkf7BgVlmPjNnAqAJjh41jng3TgWU1AJYnOpgpET6oWHSHZoNMRY+AI3GAGgixEKaVfgI0BLjn6C7D5c/CYKWflEgKWa/zA4ml8v74E9rby4DTfXqiSOfAL3+yTNIubqYo9taurya9584yAv+AdmPU6vcRvJToB3YEsT81hkTVLOYhtCqXjVRYDN0TeKikXpztHVSxond025XqU/sP83VYoEciZDxfZYSL2N4UWGaGIFEvSwDT1JqEwlRt8DuTAAsBQmUq9eu4QJ/+fp16iZfu3b16vOXr9fktdSGJp9Zzl252+dZXTvAbKcTkrhIpEKQs6uLgxSgAej9ADicSiimj0dbzBN2MEG5nD3rFUenA2Ps/Gl+WwsrupxHlWRu7LmzCvbYudko1N6m1lNY8ZCvVhFlRo0UpqK09v3FZ6iS4IZ0/eK1Z1fvPH+5tbW+9PxODhkXlLWhVKDd3Dh1YAE9LnpLplEGaLYKVsPwoDOK+KRpTligoTsxq9fv8PVoAKr6AxiJyhAOqOHZQnMi7xpGJ9Wrgte4iaKYGmQ5AKTeNCRw6W9BVFUm8BoKz7B90g568ROKzkePajkqx3hypKEzF0R90FJIdRzUUtOKy6rYaLwF5sfZ0XFUmWaNFkb9xjnvLJqcCcu+gHLGN0mHIlcPUH1kaJs8SgkBDc82kgL+E7L+EKv0013es2pm+qscUdHdI3MfJ5z4D19evUaIXrt491p9a33ZMwIMcd/1EIUPAjpGjzYjHj+geCahz+JkROKFxcVRHEmmsRCXryMaDa494RDbQffgyai0BBIO9xhNiCDtp9OdxycKoyqorc8Qqv/sa0B6qgwHLMAJ316RMIXphxqjDx9uPL+KnfPixbubj7bqd7V60su3oE4QxUIYHsP0g24udTArpG0QTJSzTmJnE3eLAtQeJD0/kvfSsfpxSNX6363+z6+jQzjcqY5PpU+6QvH/klkDNCyWmiHKKtJDLKu1eLQ5PylmMGtpWvNY9T2Cuo96H25duXbt2p1rj8rruV4LP/foOAxNo7ww+rf5UsASP5AiLx1kSuNXbGzM5f7owuC43TaNE56NaHJrKTp8di15LrROl1Ej0xak3XPIqCoTNKDfDkuLvgEqXD1nE2CaYYP26Gsk+SghZXKTkKjIrCoE1YDdu1a/cu3u88Lr+pTWw9MIcmuA1DhUOP/8H/8xoRkqy+0HcsbT7PUlIbk8SEqhkVEU5SGCYezjM6+9ul2OUztilLO8WQGK1ZwaG6V+p7VSC7C6KfL+Wc6x3jO2UPK/EtxuWCIz2XpYVcRFXijxPlz7fuT7jfJmHzvWjMbG3OMsBkf++J9/vOmPrntpRrn7gDWTRLMsg0QPQDG8MhjpH7DTxQhXd14+YpX5Xv1+3ik0l4BqJy6XYXYY6VlJSq97G6B9BGiCeMyxZbRApixzG3T8QAYPgPbArEIkSMnTjwvdu8qPUqt3tJAra7pc0V8adY6O/t//1x9vJYPLMnVFug4Wnn6Ip3mlqongHBuORAYG7LjD9/J6XfPp3ce1jwrOs6T6CXVQHYli8ekEI/MD2wfQvhEuzQ7abgASuZARq3uZRZsZIcrUwlPk90cxqno2Sun6FHNhZCLvoKLqqHeNcdHRP//nH299PRRNix0HrdkJiUAofYkZyNYPj48NRgb70Zy0WHbiyRw890I6lQujdjxOhxFR7Dieuta8qQEo+5RdPKNhqjWhX4LWKVw9XdxI0KEaqwBRHFDWuMAPpvSylgzqLawew2YcCdChOWX0b//5n/+xOGRZ9bYftBKT15yCFWrP6EA/EUJGFVv/mH2WW/voelue7UDjEk00bEjNdjZkQw2RPgvbdbn60H6AkmYBVjxNLZBIOzZG+M66CFIXRDCZzx+ZqxCi8Tij6XjXcWulcgEKLSyHo+wVUR5FyvznW8mAsbcmJbsOlGXqCdkMUU+yUaD4HANxRBkeD/B5hN4WAr0qdtWUEMNYXHCaChxh0q3njWPdux4q7Bsx9oDbPS/41yQDc2Y0kwgm9/brURG1CuDmyUvUdUaMcqk9PT/nQdkPg80znkDjNOg+SOd8V1enwyygbGaYvDVfigyPjY1CE2AYS9jY+/OAAh0ogKNXNE2HkZ4fXe8ElBQxIXs9hkoLL/ivMpc/cmJFpcvatLHwc0RdLmmdEymGeG1ar+OA9qGINTr6FbJZj3ZVOjgUsu5j3XEYQckGl986X6ILUn9k0MR4NxYOkXb3s63JRs1hMJVCapm0gfbP46nv0wZRICXNa8pYPXEyU3G7md2l7LZy+0lCFHlpnLhk/lowF2QsctSn1X2c8oih2eHIAgkhaJe857q7DkyAnvJ5/dhAk4qN1jvpAiNnYtdknjFp93140c5inApybVs+u9Cr178LUSMDdGyMNeuNFi16njJWek/aARUnn2h1q6se2T0h6ocPUBx+qmHWpWZLo68hwDU0PRC5D4PwkSuSdHD8KU8KPodfMogKeAjEqhsfxYJ3Bqi+rib1+wPKis1U7eHatnoj86d7N6Bg21uiNFzDIO3V1l0yjH9wEsFC3kchyg1oyWwFNye3FYpjXg1aUmOsBcALB2wUF1aYobDpv/uH9H131gz+zt8e0W4aAOiYQVQghy4FqIQMUl0/DQvZw7CimdL37QC0cdS3AKr25ZonuP5ty1zfNEemKXoASk1lZK567aoXC5u8qRCU8PF0WDmecPEEooSz6PP58gxQOzgTLJXgMxKYfwiGB79UgpuvXQbHxwfEE/2cT+7BieTNjBGaeAYHTQMDY7NIgzwWtsK0bwVUJTUwSJsuie8CFHmYJYTcYGwctPHMcqK8EWfWfghM6tHJTUDVGIW7nw8EnQDrlxCivSqgNFuCrE3RkFaucDB8vbGBTkysUALtiAXAUaSeBMQBTHZoqhOjjoky7A9oY22rgPb9AkDhWRsdw1RuprIKOfx0uhCn8GR7p8Prc6d7Go+b9lEseirbFMeG2chuI/fopb/WotUFNGCXeg+KvRoI9b6ZpB+FnXiYSYHYSd/TaZoOwZoLhGMa334LoL1qS4mHKP+cN5h/HlDabkd00QDEmjAnsgRpZvh4EqD8EV2iVQ1QilEkT+40dZnM5QDn9EeN6k2D/lboXq/BH+zCqc6Dwmo4iz3LijkMQ5muj6gwDkOhyhaLhjBmjHZGkHRY3gIo/j380KZtVMVW/dq+JZSGKTqc1Ps8yyY6kvgfW0mlGwcRNk5B2o7QHpbgu9MbKO9J1Wlm4ZIY4uas5M12pVYwPFyjntKBGACF2eQ5jGlY/STanQ8wQO2koVYMQxcES342wYy7dLrehjO8flsVuE9d5jqegTYUWPt2J/G8wMw17unS6JmNekB8mKb8kUp3FktFbMSnlfnLOmg/dbcgmk6naNHbxkiiaHaId7It2rtP3qx99+bRy9XO9oORMXW1nZGllSQVxxGh1FFAOk8BCqlVCKaHhqYTiSCLQP1bgm772bm0W7rLtBnoLUNffRUcYv1jUO/I5yYcBkmnj4ocektZ7OGOs/xkkoUevp+27qP4f/TNE6B0gSOKn3bk+zff/e+39/5y48b362eQMnV0Yay247etinb4vTPJpIPUJg0a7h1BAaoUozDfzYVCGOAO6t6aV+6Fc09z2cgKIbi8Y2xpOmoh65lQAgONoO5NwweQDd/qcikHd5NvxKTk7tnGk1+ZGKFEyBAZCkUtutNvbr1+84rLuzx7Xj9zsh3MnK6u33ZUufus62Yy6WbcF0McpzwBiqHDTDGoC+ZQe8e/Omg0/jygP39t580meCihFgLDaT1ZUMKsCrUmzHgHGTFPuy64W+Ds6YkLuC0191RClACli2ncRBGK+Ox99ojghBbJp59+9tmzZ8+/Xy+f/M2FCbo0sNRJJlVLjlSMNlETyiJKphbSTamARo26nwX0Zy/tnJ2LvTiASYbwXBCAMqtFBCgUHeCmqmP0ZZEKIo0FbqVzSd1C041AdXNEvSUWob1XXr7+7uU3n974FDqDly599tl1IPqynD5Ntopdv13Z6cxN821r8tYk79fKRQA6PUbSkxlw3zED+08Dyq5ZtGtSfIaR2SIeZ+HybUmg+0Eh+lcjBajob1nh2E2Rd4oqnI0oTROi4DzdjoyPh4O5rbWfbjA4L9II040XN67fePLi+0eFePl4129XI+l+4BLiSataFDe4MiB4zc6iFhphgCbmQiG20el+Jll/G9IqoOzMRzfUzqhiQ9g+ggnsnHrY/BGi8FgDMa/gaFnutMRxNRL8Pc1jnj9pNEYwsq8ZDoTrr7+jzfNTBCeYjhgNe3GPFv9nz7Du03HNye6O7t+kaHd6cnKFnUiqf0QlTPPFygIDlC35ENmgYVnqftmjbwWUupNIHsfobA7BNRkLHuX3KFqe7NXyaIuwlu9pnvAqqg6huYfyb2Ky3r2x5jJPlALrG6+fAE+22omUBw7uN/f+cvnSjU8v43Taer1RKPwGSkSoiQi4IsV7VAsePPmwfVAhgRpFwfXOwwFFiqPTfyigen4ihWm4Lkj32KEcyEg6zsOZQz0OuiVBljP17HysPYKjZ8cmyvbRDZDIhMrq1pOnL24QnBzQS5cvXr/x9MVnL25cuvz8+TdPXj15We7s+vXxPOsTktsLHrBanQqBqdgCxIu3RJHZQz51X0B//nxv4Tf0krN0gGXj5LGWm8tRY5o1njEVOpeY0ta57+zOALVa/YKa61vTLDo5okRvFh99/+LxN180R0Av8YX/4sXTz65+8c3Tv2BrfbaV7vj1icpeWvB+X9PSyBCPLIyaKJjGsM/BxSvHAKVJjw8HlPg7VHebJu6yMQoEWR9YT7rNmFvOTeUKAk/q07tiVHSoN6eWb6Coj5T5zZMX9z69ysSH2DztF5eJSfbs+cuXn31G9m/37j0ppzp/fVoDFnwyKZmbvEFRISIN+ZxCazVYmzOi3DTNAN1xmex9jwyUtTv1nC0KTheckqOoBBo9m3NElWI16D5SFscfsS5TgO6KUELRT+cSfrYSomkr/z6l94bXT57cuHTt4lWaZ+ATypdBxL126dNXZPEIU8LHrx6lHvzKyVP3eVrwSWatyViDgrCCsEzgiU55sMUVi7mpKEzOMQ/fO8IsvDjBiQmn022eWvSsKsoLPzxDYiwSck40snYUqmt68knGLROvARKxKNY/zT30stEcjHgv9wg9ezdQ+opVEHt2b65InhxwZnj1vDHv/ez55asXiZl3De9Xrz57/gx6zTduXH4pF9p/TY0BEGsFLHiN26UShc2SW5iZ1TEkWDvREs4sYckD0IQKKNnEezxGVfdmG9DeBqDIkJgLVQID89S107OJJTBEWCqO9ntuMzo0rSiz0Bdmkzl9llylR3b07EGUkx3cgkOFtrngafU7zGsv70IaDxBevPzNq0cvXz7ZBJZAlYIWOmRXr198kvp1CaM4kdx050wK6gAw2g7+icmYzkOSDOyfakxkMhiJITU2ApTVk3WUmmr7tiNUuwNQhmdwDp6ptG3gNKd7EghIFKDEoMltYgvJRJTAEAO0z9M7Fzd7ZXdrFLqbJSdKnRrtusbX+cL3S+U74N3joWl6WK293njz8vm1T66qz7Pvt2TpV56u7T7lm/xjUuP3NQJUcINPUDEyzjbFlUcXLGaU8F8xmoXm+Qif6bbkljHGRc0H9q52mhqAkvfkEHOfRg3YzlzRiYFrZNOHRpqkyxmHAovgmoe4vpOFCDiSuDuB3174PTiXdkQoP5+soly5c+XOlSuE3pUrd0dy9fTD77YevXrxzYsXT15ubcgG4UT3r+yf4jDP/DmZnGiMBkw6/JM+c3xKO6JXbRB1oUBkwRZlgKLoRsBpp+agDRS1qGfRbkB1NHgMMniA6w9hyIsy+CE614ijE5yLov8TpWvDV+y3e7R1yQv/GWuzVu9uwZIOI6tf7LHugpvC2S0LhdXVR/Ssr9eXoG20nHr4emvrxx9/evN67QeXK/0rT4J1ZZMu7x//PD/jM6g8dgFO2uAVLZPKYh8zlTJOxYYji+OkBxTUMUBR1kD+M5agKQOLauXXyiQxQnuthjGE6bGG+FCQZHJQ+KRxEA+EBYn6EYak5fSQlqbwQPbwSoy/2IqZuzVGHdQAde85m/yy5HW5HuKRXDCjX61vrj5c23r56vFjjDRsrf36IuJtstmhmU9ONjIm3wyJe7nMFfic8RVP5ifD/dksIRolQjvm5tAFAqCAiahJ+u1GCEsBSA1nDpPGISg20XAcV23Al/GbAOgQRjbCU5TNDy5ETEOMcD8FF1rQRdz7rfg0Tz/9dAF1u3ceWys4mEQ2QQdpQxkFExfZLJvXtl7R8+i1+OtPKn7k88bn52/yEwkB+ocVzmdPk2U2Z2MFnZAVGlzMoiQE0i1n2oJzg1HXBCcoNwFldok0nTS3NEfc+qG/TjPfc6gJUxaKqMUliZTrY1GyUJs1LWSgMoK3Wtqhwrn/JkqPw9HTswvxFSuRnEVRJkjl8vHjmuSDBw/iG+La6y3E58barz9W13UT/jEaBKiKp2/GzUQSwRrUcuFkLFQMcw8PZErKNCFIa5qmPQnQMKcx6XdwyGj0eClBox+I7TE7haidUcEsVFWlvRVXhig4Yrgt1TJLmKe1EJ6traP9YtTqFt3NbdWtXpoYyRmICrTw/d3t7R1teNrbocKbWpPE0x2/BaA3NZrbDTzNEyuiOgoYn+KMZAzHD/ff7x+I2DLOAFjeeq7nj8Eg1InZwCGzKd9uhoKDV6PQRWUqF2O3V/INoNYdSIj06qCbaiJAyaZmrrYZ1NdSZsd263gfONUQ9XMIrex0QibKWPg4rzDJiCCVfPHmed7e+XFH5+mO36AcikL9hEYjNQPUsaJ+DpcPpKJEqIvZgOegLfxX3BunoWehKreQBGCA9G1aAKWcv1c3G5sbYvIhuaVYgFpprHVC5xvms6Bgie40RSg2Y7xgnuBUPWWQ6Xx/+2rnN04/dZvAauTZKuHJIMUdlAZwJGnyZjdr3nb/ptQ7VJbjcV8DUMntaKSjZnHZw+ptMI4ZtNHmB8ZMIGxCNc+CIWN2Ko2H1S4TGaoAVAu/r3NlgSGqHMcg5hKmEwkRCT3bmo3whHpBiN1baczLsy4YvI6dh7rVqlIbdjxuv5Vzb1kwt6YEgDQlSJJ05kCMxHsFh9nVuMX3qCbamMJwFXJ6KH6hhmcK56Yos6QkaAz7IbkgT2ETRQeC1/BxZDNAqW4UZDsresUgKY5DxGFqKuhBWRpfmZoaCmdMBOiAPUQ+nzTk6KlQFa5nF0IqnrsR7Ym7aarWvyt+V0B09IsgOmoOAgOn/QGRhQ18zt8BKngjQs0PV4PAMxMAY4Rl6lRrx3ssQQOKNF2JY2nOQ2UNHV3JmYeXbigcCzKGKP6DmJ31Mjlj1ILRDdRZIkQ+M00PMa0xxGcFXCTJvX1+u1vAtO4plMR7GKDu5lVJ/S1uxtCVTh6A8Y/uk6JXcjUm/9xio8bswuNd3azFaHhryMOavwQopekkKGTJkfs2eKMqHZxf4fXGBFJOGp1DpIKfSK8EOFEg36NuRRtC0JYh17lZNkN2Vz+Xd1GxcEc6REeOtfm0BiyaygCUJutaYpknW1TLkw/ErEJ73GWtOAx8zQtp1ZOcjw2YvfFMImeh8iVNp7IVjzVP+v/gbkehQh/OeXQ8C+VFpt6p5bkhmsnQhuZiATbVjTZxECJC4SBb4bpoUbEVFRoTx0hDLU0vpWx171jubjp2GnBatwv39JFmlB0Of3Pz7GEnvZ/wlE61HwAiOBjgQjZMMupMISnNBwBdAnfSBst9I1WZouyeAaqqWNC8NqXtkLKz8GkZba8aorllojpTKAYCJBcKPduAMzyNqEYVgLzQkTXAmgXO1CMjuVXZrI4mtG6ebn6QW3mYtrSU2QWUaxO4W5pLeNJgOztOIwn97QP0DFx8IDunFCgmvekU10wR6GcWpTS5Vh+50ofTPsYv5nbK7nHi4Koe9TSmj8jGh2a4RnI5HZcTC+K8CsI7JTwLRmSMCTRyY1T400yhmwTSTcHMRrzEuHv75k4dJBqVd6uA7tpE3X429904llgeigTK75U0SuC0//RvjmfnbYOf9L5jpnlckOSCwM8jv7h9NJnNhSuoOJHWEk0c2sNEeAsFYFOlFOemciTrHwK5mUrvepL6p7IHpfWhEPmfKs7xQWjlxaJUq2aXVrpzBpdQtV+X2J8v77ogUYSy1EiNT+tOSGWBzSy19paw8QslpzNhcwjnfmtJ9XMub9VuGjDZ7CT274h72YqX0jJtozSsSkJU4mafh27vTkwYh/lynzXZ4HYWC0IiDEfT8qyHz1mDjIywnE0w5uO0DSc6DYiTaFZIHcHrg/UnCqyVWj0vyA4JLmypRhuzSW1gi9q/Y7lvJ6iiV9xe8xShVj/KO6SzH45WvMLp35qxbHbDzIBSQ6e9JFr9/IwX095muy6F4tjqFPisqGKS58cQq8WPm/pJckiLrZXdl8DGnaUpDg/K9NAMwwEfHAooEBCFl+R9OH8mjA1+LulcT9U2JGwo+PvYgb2bK8IOHn/PfoDiu5MS+3azbsqWO+zU7ei1rLpu/7bTH6e8ri+husZy7QElr+GNeVfa72oAinPf5RKKvRZcvD0hpvw3okPwkdoq3TtR4qQ2O0l+kNjAkHGWZumcmCYYmh5l1odkaGoPNkZEkX16+uop2j29fmvr/cjdMpxAkO13t6d9VfDRuLeDH/sYYXClqiCxwpVpNjEVFeXfckAJSoGSlIk52TzSwMBitiKwIjO2UnWSGrJi4Dd6UcvTWhosbuREQWc/9GvH/krb5Sykbf86TRIqTLd2CIq0w05TAthGlQi5nQ7fxywzUZ+J8Uz9OOisyLR7SrRkre6ePdybRmpk3acHihKJTyKFFzebsHNMTiYVO2Z87dRBzK26HvymUm3dHWcn52kuAXj2D1azphJDMlXwGtSGnTAzgwYThv6n9BZePSa+VxialzaScNJRpTn61TRrdHCh1QDuQc4EXTbhJhvhgDoT2Ch6ecEaxeRimXTAXeLu4Gxh0je3SWuz3GRVORDozorqluBHvxsCXXBJto8lZoNLcW+84zce7Dx+e+JLEL9JAni0GlGcFREoptNcXBY3J3EGiCIh9VZIc0UdQow6aXQpxFRsdKG5WTbgYGcVESOdVk5c5kkfYBbsEwA6OGgPsoEcVPAgC7RcZjKWuG+631JecjM8Ha28xkZWSuPzuBLRQU8ZlCaLJAJ/y/gYNtB1UTjR/tsPftyeyEPa3GZC10hRisWMA9rcGw1KjuwHoA7Ek8u73julboMeaC4PEH+OTR2AoYNLPYogpLpu9CCdGkTOaeklpl2AVPPGTar6C5EZtMEKxDccOOi8/rS7Z78I5RNeTGikeVGy9jQzKJpS8TncM+KEMK+QCx4qrIuR6WhY45XAXTwItZHJlUoRVfRIdhDcMFMmjtlZlYQHVdQZhigWvZTxwMCLHgBKkuCo3ev5ADLEw/g0BurOAHQAjScLVUrQfoZtF/CmAEVftFefK6a9LgfyHK8s8vLnflVlN1vzlABYm5USHqHstziQu4rizLwNN1+SNYHP6pc1xW92+duOdR+E4aSkIKRhvrMYMdkG+yOmiEZusBolh4MB6oAnnUtezall+c11xCBTracykycRjoW/GmJCgei822yzRj6hCJ2RaKyIIArp2CDTnaVK2muQ/DQViwHut/U7rI1TqbHmt1e7Nf5HbKwoiPlm8hEQrFHwps5VKJEpi17/gVEL7z55VpAccf98VoHkamQUFrCNAOWAAlGSQfemVmtzuTt3cvVCvDLn0ZKDJ51RwTlV2w6WX0OhmD2k5+IkJNwCLs5cbXkOpkr1VRA6DS7KOzFQDPWLtwZoE1D1WCJM2fwnIjQet2K6zmvNkKwJ6xJCi3jKWJTFkwdJV6j95DmHgCHfpDJA0oFKxc37Sg4VUCBKyvL4ipzaSG+kRAnxumkZof4aeEpT1AfpZcLLOJUSQ1rSd2HKttDFjK021BVxxjESHXId1oK3vrXhwRPRRiqqVp2satovu+TFmI3b46A+CP6/J1hA+nnsIKliHOvuPHXO4XMvDJMJuWLLFqizJPm3AQWkUjPbZ4LoqUpOr+1l2jRGRpzllirRKAaHaGoeAWsJxipxNac1uyTZwQ8WkTGS917Ud+ZNDvW21KA2YMHHezD94RLX5rW/gAAAIABJREFUY8ooS5aGkaqhjjCnccmnuw+YshDC9LSwsgBfCWQ6ipLJI/cWGyue/cC6dzW79/Tuja8v5SxaLVNaNDIpO+hYekCApI3WEkzUVuMQsUqxHoBLJuVKFD6xbuma00q12X0msbxJXfNqcwkPhiaBppRaXU6QhDF5plMrRTuVwQ4hXTho7gCI0uO3kwoBisNeyWZ6zNJMC5wsSgXua0g3KPBeiKaxUWag6lRzP/BIruQ2l5fq66vltAh2jWiNp0jgxgulfzYw4+5Re8At5M9doLYC2tNc8w4Bf6W/XMfmHcr+aeG/gegoJMsVJS7HlaJGircdODXr47fzgfFRpm+pLCoanzAzsw0pR1SUXaSoBDHKFFpiLh56qXx9DqRxjyc4V8MoC3x+JZa5ewWcIVTBlKFPnYLOon//tHN3gLqbeZPoZ7cjN8CUBL+mUkN/gBqBiTw8hBZwsV3UIMEv4aqnJG8eP4CA/mm6qNCSHx1dtGm8jm1A6dPbfCcVBKh3s+S0YdJDF6q0RlMopFNMgdpg8Akkqqh2LYBOCo+Ycjj2sMD4xTK9u4pMgDItVj8RbWSv7EiWsoGghwsd4DKxHl+tLiyW5kvz81VIeIz2mzJu94GzAepcWSkGTP0QDMVLb8972S3ppgrqbQfbRunHbfYF2tCaiO54wN9jfQm1/MYBFQGo373/3Wh7DpGeWyq7hkmHCjjJCvksLhymwBQIFXqWqHmWUGLW5OH/QM4kZFZgclb9By1EMQ394HY+o1BlbjRrygjiTPOUbz4OjipDFKxH1x4wWW7EehgNtgLtiCxEm6XPW7silJU53XH3dt8N0rZsJcTzlWI4DF97XGHDHkbpZ0o6FUGerA4PshefP07F6v/4oJ1Lx46f8z9IlkAszmadgZIg+B07EHW0fLwFRGU6mHaiSXdK1mRTTx1+AjFEHY79mZ8q+8tNkLrdnAjmkGWxJ7+oOKnIGgyAO64UExbuMwLphmUHSG1VCEoRnnj9gavNVr194HZRjOt3fuS/iSPHAdmZQNYBwwN/Y8nvjNRbFKIOaTeiXoFJqlHPx6qWiDhRZvvI3hOh7L8EmPFGkELsSojn8ZKS3Sel7rNFAGoC15cBqvWEcWBqFgZIzZiHKEc0efug2fqyEfPOE2dvY2+EgWe4GBcEx4y/GZ43W/G8hQeXQMnVCqffzdB0c6pCAzIaHvb73T37RWizuhxX/3NrShDi62HUsMiAhQFK4yKKM0id514w+up52YGTHXiONgAdxU+mrHDu4LlWdCEfbe88J3nR9VJMzsW4MHFzBmHqcMzs3E4Jz1t+6L1I6slkZnsnPbf8u+6VOwqf7t0DHs2jnfqcbhGc+UxUH50jYXrgyTi9IfT7YhBmA7V/OaPxJ5MZ0+CexwbL386DqA9OKb4gKjaFPYsrwuQEE+lv2U9v0RtH1OeCIR9362FxOMPx3AmXuxVTN5Z8zy7mDb4bL8TduAqkyjUMNHiC4Tl4rIH5HJjF7OIQmCemhE4bVEpWwYEiDjvZ9yCacWjaD6iEvWOlqESUUWUUJuhZDcTRmK48e7YxpQcTOD5Q26Hpra52BKi7yZzZNznaPRnLh2KJPScJ8cqmR6vD7XVqNR+gynUglkNRCzUC20qygpvsBOCEKx4Su/49gCrOvHjyIJr/YBRsJa6gqY7LHR2vgcC6JoXzR5Ih3bsTz1vuWyRFx0Tnb9Gb2719vu8A0d04jzjze3sA3kppvIhTnW6xGPeGujLuXLp1oedPNjgHBnJTMABfrsDw1hovzMOJmSxz6GDv306abOq5lHGcPZB285imvZ3Hmmd4KpliAgIEtUpB8Pp8k3RNopXdhHQFnTJa7XwLuNVY2w39utbnVmP5N1k3VkbrxEVfLmDEiJy/LFNUvprS1lCChkhwOl7e2ipviJJvUmNTbGjPEpDMMrR/T4zaTCXp1MH0p+o+dftBKcN30QxY8Oh3oh20tJrGXd4LTLngLOITb+4VlkRSuNLuyQBdWVlhGTv9RN9Tk6UmwGk8JP9NwxupwvrySGHt+d3eu3fRFGUkNCMsUjDF8dNPP/1IQ8WP1tA8yNqLRXJfBQdIxZOHaL8aoQSoYhU7DySicEg9e9uv0eTpqSxtaknsG6B65uq4seMkZvcYlr+vuPnSv8XAdbv9KqI9NN260tgw2XyRumHSEsfUhiQLqUJ+ffMOGszasnl1xMNtlYcs2qmlwnePnrx6+hf1efrTQ3F+FP1pFVAVUjUDVTNR+vVwVTx17NjBPJhQcv7orP/ByoMH1tW61nPXApcOcGY9ldU6ySiWNShPCigj+VfY42ZB2dwY/4gfaVYU7mHjhgQ1q6wASEIyXShXMktzUyhRQ0PdY0wbUstGD1Eh0D7JPdp4/fLF06dP/954fvzBXUVF+f4OQJtYso/97F2JOzq7DiiiVHNu68Rzxp2eQweO+cLkahupTLFWg4zi5nIts6rxC5PSxIRwk9kh8ERAVCvtwHAGd3IUODDjhlMHPl7udEGThy3tcg6vDXNYwbwemOLRlMulCZE2PXYW6Nxs3ftLE8y//+Mf//hxLb4wPHyfAAUVy2ZqWfN8xTdi1FQRTh9Uf6quhs5Z9wkxnUlg9gAnExoarnK9DkiXUenVabEHrOc1cXeKCp4CD0AMCU784Q/0C8RvPI1wTJnXKvXaMowUgh6U+OH5hTE9FFABKjhkHo92aW1N9lbItG5qmUTXXjxtYsmeH38oD94fJ0AHTARpv21XhDZ+ZVLcFw6y+XRXF4P1xIpIoVUQpBTkktbWawjRpeU7tOuhszxy5c5muby8XKtDAnS9Qk+1hKdaySrhxDKSoc01CXN5rAXN9Fo9U5tzTIkRUYrLpKfvkeHNG8NaMWTMrb/Zevn06b3PP29g+Y9v//Ht4x9/2EjGSxCOwzbar8anjcUmu87btpd+sSqcOviG813tpzRxzYlzLnc2C1eLAoINzx3C5u7I3btXnz/6aet7jICEhqaCUyNX5iAW+D8YRU5Qt34Knt6eDdCgez0jjefuyB3MzzGEyeBr5Nnrhz9++93DtUf1N29e3nv6uQrnt9/+48dv//H43uNvXz986AO/uh6zmQZNpv7dO2h/83ACddjqOAz+6F3t3e0fn5ycj9myoJGky5X60mZOBefii59+vPft1vMrnqkpZOHfvKyHB/7nf/4H9lt/hQa6p1evXQJ/Nx3UAjoVVI9nub68WauvF5eW5nK5Rw+/+/bet//78OF3P977/PFjhuW33/6It8evXj7C3DvrmhoMG4rdpAz3928j2r990PNPisGMcOqQuE+3r0yUlIgpjlRUluRUGjcbeEqNjLzaennv3tNHW8+DU7nN+qOtR+sZ0/3/+X/+X2isDk1tLm9u1snPx1Am/VYPo/CBc7tZXpPkeBpD3Wj0//DDj/cQiD/+9O09ErIhLElR4OXLrUJapMlYamRBXN/gVkz2/v6Blggd7G+N0H4AGk37Ow4HoG0zf4Ap5WAWPO74ajmeoutiPL+6ClXZl69evnrzulwovH6DTHwrb8MRMh6oVfLpNVlek7xiXCOkMjiSKIhzm7X1AjWXxfpyplIuxF+/eQS9gMcYcH8JMBmU6xBkrlfESTGZ/HOSEQC9muqMz6cxmUgGvjVEbc3Unn42RXFrPd59GPDsavvDzALRIHq8PjFTVIpKppKn1lx+axXD6Y+2ChsbhfKjl4iuSmZh8es/ohSHhxjmeaUIlUdNvIyHWnkkFoDStFSJ1WJzy0u12hOmF/CSnvV6HZw1ZVAZjJQmfbe+/vP/+eMfZqDJN6FZ/D9/MAtZu4pnIyQbq17dAJxR7VwqfijWfHvXxAoRaG0l9HSrCsi0g7ABg9ePzVYsKhDCJTVcnPOZOnlXwhcQiiJKpioY5IoySswEWxXMu9u3z350gp5TcdmsIcFXG/1+PAp9sBVBh2TOl3hfnPD9R3J+/tYfaOTcN1/6egaaoXbW9Ojv375yNu707GskJZkXTh4KQDsn40SBUSJ+H8YEFPo3g20QGW0+O381yh1BewyODPsyvinG4bOtLsfuznMIdADKwOB0gO3fxj4s3PL5/jAzMzHTA2KQL1n6Gr/O25Xta2cjLFU8AagNgOpqcvxQLPl5FHzo32nL+yb9GRDoB3ehp8LZCmrEpjGkGKBAOyNwhQA1u23r8c2DQbmNKEqa/DP6W+gD7Zpox0FSCvwKf6k040OEKoONAG0c8eqKZ8kpADUG0/KhOJbAx7dR7ChZGC5V8cn90Xc/tjwmyyItgHa1FAllUe1lsABV3/hP/Knm5+FBtOLzpiSDZHVPmMnVjTU7W1a7egXlgRvA/VVb8Z4+DIBemCgxY9/IIEJUowz+DIzba1/JI9chahcBKse7d/oQ4CWisBxtROhgC5y0oygYPpqtTvjk9TSaVj465VEMZT1O23bGpIJJ+ZQtQBZCidSFg34sUUNUEKo2thkqGRH2JsrgwuDb4VxoAFoybwMqxLt3Mn1lR6a53tXYbMYpHWTORDSaSE76xM1VLjKRdfLN0rZ/hA7YwjQuoS3LZw5mobn16Zy4mVVY4EWUPEZuTWwKaQ+mC43wZD9FBqvm5pLP7gK069hHE3kbOlfNPXQbVfoNSgDS18YARhxSOeZUJ6O5zXdQm3qYtUQoGWn12+aImq6tyecPOqAYEptwKIp6XC/6zeg6LWyfyDuWeoRlSRF2tJhaAZV3Anqs/YwgYgYXDVZCdVRFFfRUJlXsDM9iLNdYA4kynoOXIrQtkZ0Ns/yoged2vqQu+QQA7dXmNoTOA45oF2SvrTYVGYSoV1p0mvZd8iqWo+xfOuDkgEb2BbS77ay3hKkxE+9Z0+8BtCRUbANvhMFJhQCvqxyEozdYkqugOQ3w47yZK/U3t1AClLvX9FUOanOpBdBzk/MKyzQpfHDQa0y4tPQPNhMm9VsqlkQvRvHSNFDle2hkP0BpNtIRg3YOLghOE39wPQCYkIINYsIZEuKINkzvwnMeynawq3DaBvpby8squ4mhiXdTkMjpvSPLgtB2sBHtQtZUVdQlDUTnIQRB83fDA2r7UWFvdJs2seYPfqDQZnJWXAB0Yf8IRcP6gVSaJoc5tOCZvAEJ2s/OfhWcYioGFgwve9YfeuseT102FGijcQK/+62BOTzQEqHOEEVoX++UxnviwAM6keWh9l/0IeP3aWIQYWKqVgMsGjmIFJX0QX2cFV8P8IzQabW4G1A8x6Xb4WiYVNdJQHeW1AyocE9S12TqA2x6p+r1nMWylDJozkjeEkJ0YDtEbSZbqWqi4KTVMtBvp3kU9KW0dYO/44AjekFQl+5/EaTIRbH+BmgsHHjSet0Gka1c9TEtTvYMRvjxvziR3FsGegDj0yC1Q6gjYuFlfYZmYyCcvNQRqXMb5vTH58w9gFA91IGgzVTUuLyaCO0UA2peTyPT2Chk8UAfS6Dn4EBW90Ieom5fATJ2amTuDkwbf8P6z6KSEoksUDa1L6Cd8sacThV2JW0dfe+uB5x6Eh7MFbwXkBXIi05bYxMdNNmqbq8j7vBrFkm7CH9bmFtleHo9edeJg73iTwoOUyMbYg4MJa+UJRjV7bLxDOyIUJMzK5iF+YVBWvb7AtqdhmCEhZuAbduy7QCUabN78t4L3R/HfRon6yrxPzs5KcfbujtOrzhW5qsK7J+mSeAd9esRbc2VPsjHEs5jwW0aHf2vRmKkIHMyxHE2D+xY7QM7ApSCBrRdYdJdUaAP/Kf9AO067RXhb04ibzq+1ncDqn4t45Xb2o7fFCNO9no5Y8U8xB3Yuu7uaj934Sa4LrY5LXNgx6BpjomDdx1kQK2mRoo0OJotQeqDboJOvuJ3P7ZmiGZEx5mzgpCsZJR9I5S8mFfJrIqJFe0HKDNk1ms3ZWgFtp31lehlcjqVvMMrnCM8ufpV+8mzNx3JyiYEyTGVf2Xkbtl7/FhX9wEGVE6yWhNNsC3M35Yk/6kLOHNp5xzg6aOpNVYbMWpSHGLnx6dSgpj805f7A3pKSi2zUWYumrlnzXNtd8tU2gURoRMTKwRnJo8X9EFnyzg3cV1OPEC7e3056Omb8oxUDOe6D/TNU9A4B3G699uJMDpx9uTHbWVvHGX6RoT223ZEKN9GcQdyC53dXZ0nVsAuEfZV6G8/61qlrFM94ltsLlXHUCaVr9dlXBdgnHdhctGJ/wOXlD7z8Y4VTZ93nvwoJQvpylJQp617xbaDDWjSidEBZTEp+ITzxyEe29EpILnniHIw+9UQtfE1zwK0GJdp6XW1Hf9Isz9LpqtTTi1Dx8iifTug5BQSFLygfJ+acOP/QDp7on2P0h3VrRGm50H/Kawu1WXX6e4DDWg8VsyU3JJPTB7n1cauuCuvbqK27VXfgii1i0waFy09Ojre5r3VgYOectDenwMU081l13lyKpqcvJns3F82sIv/PR3nMOiEvmrhQAMq+jMlv8ubPtne3Tg9OyVHxsmWvG3PocQjtFg05V3xNpW7f2xfCQtwJ1mI9v3cksepBRKuhF3zZFJDmsA/6zDZ3dF+CmIcBxxQr1uS3J3t+Nc0+mzdfm/JtPuYb8DL06ZisSrd7mhucl37E6bT5lUwnHpbTIPYfWnbsEVLO2wuTcH+VuO+XRC3FeKdXQe4t9R17ubt+K7bXHfB1ROx7Zs3qdk9xAQXBaHjnfReObVJQ0ggjvErqKXpnazjqNJQfm/FnDp+8Cvx791GPrO3290hylXbKAo+bwOUIPV732Gzh3ttylsZuQuFDWKWsMfjafiMqGFKh9ac6D3V3n3sCD9t53wokiqm/WPUxg4mZ9z8Lq1pXGy96Rw8CJp4Mkj1+hZAkVbBMcSc7mg7MojuvXZgREx0ZNC5sw28bcljzedd/nf2ILsvgEFqacWTIOVBqi55VPPAsnGdbus6yiHa7vZVafa6mc3vvn9Ch7Iiy+902cONfiNIikGhKXr3sHd80LcuefJKd93uOHaknxOSlbWMmsn9rhCFm7ridr1TVKm7Q4T5yFQwiD5SKLQdpBam70xFPVry2EVT3nNHeRPFmnfIWaqTDu4LKAUprfn4u0E47drIeaIAtBVPFqNsA9UTpojSVe+D9iMNaMcDc75IvTvbvpsoGNyQfJRuvmvfQwEOIWrJcUQbK54ilmTdqazXy3tMCFFN15FG9IRExLFROur3wdNEPMeMw3vy3WGlccVzHo7o9uEUpG5dL2m38NKex7LqSh3tNd8pSBVuoryrgMcR7afLUtz3LgosXcEdUl2LJh0wVFc7i1As+iagaC1pl1NS+UinosfOe/MRRvXYN0Sh3o1NdPLme6jFnTaXQ6GoCqmHsceD+BUbZtKrlXtcodgu2nWEQ/Sk7ObNO9uu1c5uSiwZzU5Ine+U9uzqcMg1Y5Ahqq76EGTy1Q59wzHY0rspyh1dRzhGu9oEYZE20V3Hkk3Fk90//SBsvhPQrlOQep6aAp5oziNE6R3oYs2r1suAc6TX4slLmqMdoucn87YdEepsuclzWPO+s++EoIsqAzxEGYzswaeUOTUBxQhv75IotHcdZUDPTLiJL5ex7dOlU3FFc/49ssf2c95ycIgt+ijbRofoF62A6km3aargOnWkj6VutHlse/dQtevJfnY6pDNd70Gm8EsZ3D+3Y3QIy7+xh/JdFD1NfV06f4SXPPHyfPk9gJp2Aqrxnmt/r6Q2ndNNMUBpSgyA8kPJogKKeVL4MQdTYudRRvTYGa8DIjoqoLY99CaCteo9+z6AdoqGVaORZUuAklKnYLAZoAxT5iG0Kp880oB2C1K2uLCn4mRTG8mM7iC8zxhB17FTkjRHqjhB2kZDpJBjMbYCSoiOaDfF80e75OT2lZxKaytJbShBygJv+KyopKST7zMa0ZYyrBKMQZY7ob6k5p+6HSHqiR/xNa8BhcvWwLO5e24veLp9uk51vVeIelNzwM8ToiWvIzMMyx5APZC7PHGkAT3uTRfp6FHb87btCMWgHCPKFcuuj94Dgq5jH8ddKN2DjIcEHyLuZLi6B1BQ64SPjvSS7xLFDLJ5pxqmjQxUjVGiGZtK3vdLddo7pI1c390+6LXxfGknnGQg1EetkINMs/kXnEppqWJvXpD2AVRxVn0X3jMZj0uVvrsj1IjnRDx9S7de5eNp4QRw/Civ+W6NNx9QV/wu7oiNnUooMvsc73mOgOkE8Y1tVuMeQOkGuuo94puoVAjYeIjamjyx/pYINWW973swd6VdFYjg6X8OUO26Od5xpENU8IM15txdDWUpEzuVcJt/70ynTSDWfZMquhdQlJlr8oOjDegDORuz7SzX99vUeigNZhbfP0KPdZ+T1/m1/S17KGvQ3z7agCa9pYBCIdq/6+LJkGWAXnjvImZHKh4l1j0/lfQtZ72eiT3p2al0pAFFVQNjYDsGa5rpPf+sIr3/bbG9INS1eo86YbMXUAgQesrS8SOdiXYI/iKNYQ60rHh6U3dSqMxLH71/RB13FIIUom8FlEQbTh5pSk7HbSETszn3MBspQnHaK7b8+wOK0n0SDdBedQ9tpPQ7AV33nj7SReb2uLfCRj95jPa3pqNsSkvzi+atO+XClJYH6D6A6rU45qVC+5Fe8ye8eWyi/QP9e6nh7FCK/4ISJkr3D9aWdMzrtoEoX/NM6A1wWjBFHz/alJzjkqZIodm/e9yznwVo0S//goIbUZorFmIz9vY2mPa9zU8ZoMtr6SMOqJAu2nYAalJPJAJUURwXfiEfJZ2Dt/rbAd1c2zjagLb5RaUZoeoQnVoipbQpI1/4RWdI93m5rvO8JUJBFkVmnzraeygQyDrZkc6uSA1E+QllM1WkX0TrRKFZhr+1vndfQCmzz20cbUCx6wmV2N6UXv2CsySd/mWAdoqpuVYUWz9FaU8b/R0Amo/tQ2fkW0BMg0niXxbxZ0G672MOX9o9I4tY8odF3+7Dn04M17IF3t/fUsJTN9HYLzrk2cTdaakwxeaQ9wNU/3sAVHQXVURVJLePJZtNuPCLeaeyvAlPYHWcbueDPXQqfrQBhTLgBVGJqRHagihPozLes7+wNtR97Cws7UdYB2kfQHunCkc9Qo99JGVi+0eoLVbynvvFgLI1P7IfoFQv8Rx1QCEM6M02AOVccHYicUCT4If+0uJQG3pLvWRhvxdQy+8C0BMSHfO04hv+Eib1kLI5/dIHyE/GkdtzZ9TWGWX1UPpdAIpjnu2gDFB6o2kwArQoejt/+R/ZKa2C8vD7BfSkbGXqXgRofwNRBqgpI8u//Op1rFuMe/Q/A+jxow6o4LA5mxHKACUtAnwFk1+/fLYIeUNc3ETdXvt7jdBOUVY4oP2qowwhCkAHnSVX+gP6Fd2ncVnyePS/W0Ad3owKaD8P0H5WKgGgZVfhg+4Kcpm8gfYCSon97wLQrJO5bvU3AhTnETumNC7Nh/yZ7bfTQSROuwHV/m4A9WVbI5R9YO5xNqv5TPcH2eMIy7p9AGVXz/SRB7TNYV50qlgONN4YoDQw/0F/6Ak5AxOsfQEN/g4A9ZurdvWUH2ggaiJjhIjf1Xnsw7r9eU/fWwE96mlTx1lztZE2cUVk1lOGbmrG4fqwaOp4AGmXXYD2svF5bTQttx076uUmRCgjMjHZIVa3oyAF885h/rDqevtZcZncL1sAZVIEVGDeOPLVpu7z5opTIXrYcP/oIJNRZ0rTIIo5zMc/8Dor1nX6twF6tJt0NERrXrQTSxRS18Po1zGVQbLnKFbEd6u4vKU5LVb0Fv1uQC3gjhz5CKVDyZdVFkswU65mTaT072SAUstTMGs+7E/tdJQ9vfsCOpWWjnwe6vdZyUaaHndJsdsJ0WHU7pwalyH5gS/SSjyn/d0C6vDCzps8492OSZ+/Ss4WA0hEIYRlMMc/TDKgw+2f03KWGGcwc0Cxi06lvUe/2iQzk272OOSJZMZOCunOLBz6zPG2D1G16MapBAVxpjxA75wlTsojKI64jh/5FojDSlbyPWlylPc7JmYW7SbTGI54GMoVPrRqLde0fJbOYqEZUFLDgjYOVZvMnUc8DT1rFh3YPuGL7uZe6BPCYiCM+ASe5g/1iDshk8Yg2aarvTqLhQNqKRhOH239JswRy+lyqZKt5K1+CtSemQlHtSSYJcll8LZ/MB+FBMQxlOyJwh28vpTz0IgdqLj6skHTfcRbSq7VYgxPIBxb9futPXQ2yT4fjOe9BqHtg2W2yh6KyrlKYSOVSm0U8vVcr5aouOWDLFn9L7knGdIxJ7HpTbZwsBYXe3Awmc2TMz1+2WyIfzCgYnpKZ/RkNlLudDodj29spNKrOewClrIh3n2kCbeyebVI7mewqComLLkKHJDNZhmRKnrN3s72D87FUjlddDW1EY/HCzBihhXzRiqeCU7p84Z091EuNcVd3kqRIaoo9YRFl4gbfF4BeFKAslnsrg+7LXjnohoZeBbKMApfJXdrhOlqDofSEQa0u/2E4JcKMIt24kemntus+L0+WUSi7xZcZsODj7s+yOeEphcMmbKUThc08FpnkMKIPZ5OrcNF0X2EAf0Tbpsi4lGTx79ZE08LiE7R4ceDE8lshsRQ94fJ1bWfNaRlMV6Ip9Mp7J8wtAeuWPbpstfgP7rlpu6zXod/ZoZd4yUc636H4EA+6vA7ZC/85am23vVh4mpd580wS8FxtFqfCwZzm7UKgzMNXwrDxtG9zHdLXv8tPLgixTXr9coqrDiQ4QuyZIYDr0Hs+CfuXy6X6N5YXfZo2by3TmuZq5fXZNFlMBzhuZrjLq9jhj0Oayah5ONAUxQkHPMAlFVG/glAvanUalCnZ/dP0nHSaoProiQZjvKh1Ony4s6Jd4ejp1QpsBqeLAm03GnFn+j6ZyoEcioftHh6tTqmx8qqJLnVVMp8lAFtl80uL9zKJycJU1YSlWRHykXh6ZKTbf9UyUVGkkT+IB4yCgBb1JJYL6Q1BZfhCM8mdqXNKIFruhdiAAACCUlEQVRIstcrA1EWn6Kfzg2XvHGyvf2fq2GJ6fRqvba8Obe5mfBYgkurOKPSZRSt40e4wnzc4TK4hA232xovWN2A1OHHeeSVz55s/6ecJgCoBEDThfLqamV9PbO+no+n4wxQ75EGtPuMiBqdWULu6fbjdMdx5JLF8/+0RgAAlWXgh8IIsjFxo7C1XikgiSqUe8yGIz3f3dV57qwoebGRTk5Ikiw4zn90qu0dtlzvC+hGemMjjVu8ZnW9ltMu4RZaKNAFrHCkm0rd3R2dJxrPyZPMo+efF0ruPvaRIKXoYrSeqdeXc70e/Saunm5Rhtn8ye6jXbLfY2bW9a+ZeJSkNN83sXNuWjyb5VRKkOWUJB115khXF/OB7GKXzK5/XevP60VxBG6dsiwLFQQobdHyhmgWO4/9+/mAFPeCV3Z5N9KAURaEFJDFFp1KSWZXsuPf6HxIiJ7CUYf0QUQDJMU+4CfJZXb5j/8bnQ/bmc9KLvRNXXRnoNSJlwjk9JGWu/wnAOv++dSBzBrPCRSRVGfBR1RXge3Z0//eQN/yfNz2rght7z556vwDfyqF+qo/hZr1+Y9Otv0buP3xam8rFt8nm+xu62w+/6IU92ge4WdePXn1cfvbXC73zXGPfXD1//cA6KNXT568bOOI/WzTqavl+Tdub1/JHz8BoJ3/huhf5WPLAH3y8YG/k///a8nTddi5mT8AAAAASUVORK5CYII=";

  var AVATARS = {
    disc:    { type: 'disc', name: '胶片' },
    // 初音未来（Hatsune Miku）· Cubism 2 模型
    // 模型资源已下载到本地 ./miku/ 目录，双击 html 即可离线加载，无需联网
    live2d:  { type: 'live2d', name: '初音未来',
               model: './miku/miku.model.json',
               scale: 1,
               idleGroup: 'idle',      // motions.idle  → miku_idle_01（待机呼吸）
               singGroup: 'null',      // motions["null"] → miku_sing_01~06（普通演唱）
               danceGroup: 'dance',    // motions.dance → dance_01~06（成套编排舞蹈，按顺序播放）
               danceSteps: 6 },
    // 蓝莓酱 · 桌宠立绘（单帧走 AE 引擎，唱歌/待机同图，保证离线可用）
    blueberry: { type: 'ae', name: '蓝莓酱',
               groups: {
                 sing: { fps: 1, frames: [BLUEBERRY_AVATAR] },
                 idle: { fps: 1, frames: [BLUEBERRY_AVATAR] }
               },
               sing: 'sing', idle: 'idle', scale: 1 },
    spine:   { type: 'spine', name: 'Spine',
               // 官方 spineboy（Spine 4.1）示例资源，含 idle / jump 等动画
               json: 'https://cdn.jsdelivr.net/gh/EsotericSoftware/spine-runtimes@4.1/spine-ts/spine-webgl/example/assets/spineboy-pro.json',
               atlas: 'https://cdn.jsdelivr.net/gh/EsotericSoftware/spine-runtimes@4.1/spine-ts/spine-webgl/example/assets/spineboy-pma.atlas',
               scale: 0.42, singAnim: 'jump', idleAnim: 'idle' },
    ae:      { type: 'ae', name: 'AE 序列帧',
               // 把你的 AE 导出序列帧填进来（示例结构见上）
               // groups: {
               //   sing: { fps: 24, frames: ['./seq/sing/sing_0000.png', './seq/sing/sing_0001.png'] },
               //   idle: { fps: 24, frames: ['./seq/idle/idle_0000.png', './seq/idle/idle_0001.png'] }
               // },
               groups: null, sing: 'sing', idle: 'idle', scale: 1 },
    builtin: { type: 'builtin', name: '内置歌手' }
  };

  var engineEl  = document.getElementById('avatarEngine');
  var engineTip = document.getElementById('engineTip');
  var aPanel = document.getElementById('aPanel');
  var aToggle = document.getElementById('aToggle');
  var aArrow = document.getElementById('aToggleArrow');
  var aTip = document.getElementById('aTip');
  var aLabel = document.getElementById('aLabel');
  // 每次切换形象都重新计号，丢弃过期的异步结果
  var mountSeq = 0;

  var avatarType = 'disc';       // 当前形象类型
  /* 引擎脚本：优先用本地 ./lib/ 目录（离线可用、不受 CDN 封锁影响），
   * 本地缺失时自动回退到 jsDelivr。中国大陆访问 jsdelivr 经常被阻断，
   * 这正是之前「加载失败 · script ...」的直接原因。 */
  var L2D_BASE = 'https://cdn.jsdelivr.net/npm/pixi-live2d-display@0.4.0/dist/';
  var LOCAL = './lib/';
  var SRC = {
    pixi:   { local: LOCAL + 'pixi.min.js',
              cdn:   'https://cdn.jsdelivr.net/npm/pixi.js@6.5.10/dist/browser/pixi.min.js' },
    cub2core: { local: LOCAL + 'live2d.min.js',
              cdn:   'https://cdn.jsdelivr.net/gh/dylanNew/live2d/webgl/Live2D/lib/live2d.min.js' },
    cub4core: { local: LOCAL + 'live2dcubismcore.min.js',
              cdn:   'https://cdn.jsdelivr.net/npm/live2dcubismcore@1.0.0/live2dcubismcore.min.js' },
    cub2plug: { local: LOCAL + 'cubism2.min.js',
              cdn:   L2D_BASE + 'cubism2.min.js' },
    index:  { local: LOCAL + 'index.min.js',
              cdn:   L2D_BASE + 'index.min.js' },
    spine:  { local: LOCAL + 'pixi-spine.umd.js',
              cdn:   'https://cdn.jsdelivr.net/npm/pixi-spine@3.1.2/dist/pixi-spine.umd.js' },
    // 无 WebGL 时用 legacy 版（含 Canvas2D 渲染器），让 Live2D 仍能显示
    pixiLegacy: { local: LOCAL + 'pixi-legacy.min.js',
              cdn:   'https://cdn.jsdelivr.net/npm/pixi.js-legacy@6.5.10/dist/browser/pixi-legacy.min.js' }
  };
  var engine = null;             // 当前引擎实例
  var engineState = 'idle';
  var engineLevel = 0;           // 0~1 音量能量
  var danceMode = true;          // 唱跳模式：播放时初音随节拍全身舞动

  /* ============================================================
   * 本地文件拦截：解决 file:// 下 "Network error."
   * ------------------------------------------------------------
   * Chrome 打开本地 html 时，fetch / XMLHttpRequest 读同目录文件会被
   * 安全策略拦截（status 0），而 pixi-live2d-display 内部正是用 XHR 读
   * moc / 贴图 / mtn。所以这里把模型资源以 base64 内嵌进页面，
   * 并劫持 XHR：命中 miku/ 下的资源就直接从内存返回，不发任何请求。
   * 这样双击 html 就能离线加载初音，不需要起本地服务器。
   * ============================================================ */
  var MIKU_ASSETS = window.__MIKU_ASSETS__ || {};

  function b64ToBuf(b64) {
    var bin = atob(b64), len = bin.length, u8 = new Uint8Array(len);
    for (var i = 0; i < len; i++) u8[i] = bin.charCodeAt(i);
    return u8.buffer;
  }
  /* 把任意路径归一成 MIKU_ASSETS 的键：xxx/miku/mtn/a.mtn → miku/mtn/a.mtn */
  function assetKey(url) {
    if (!url) return null;
    var s = String(url).split('?')[0].split('#')[0];
    var i = s.indexOf('miku/');
    if (i < 0) return null;
    var k = s.slice(i);
    return MIKU_ASSETS[k] ? k : null;
  }

  /* 把命中内嵌资源的 URL 换成 blob / data URL，交给原生 XHR 处理。
   * 比整体替换 XMLHttpRequest 更稳：responseType、onload/onloadend、
   * status、abort 全部由浏览器原生实现，不会破坏 SDK 的加载时序。 */
  var _blobURLCache = {};
  function localURL(url) {
    var key = assetKey(url);
    if (!key) return null;
    if (_blobURLCache[key]) return _blobURLCache[key];
    var buf = b64ToBuf(MIKU_ASSETS[key]);
    var mime = /\.png$/i.test(key) ? 'image/png'
             : /\.json$/i.test(key) ? 'application/json'
             : 'application/octet-stream';
    // 一律用 data: URL —— file:// 页面下 blob: URL 加载图片会被判跨域而失败，
    // data: URL 不受此限制，且能同时被 XHR 与 Image 使用。
    var u = 'data:' + mime + ';base64,' + MIKU_ASSETS[key];
    _blobURLCache[key] = u;
    return u;
  }

  (function patchXHR() {
    if (!Object.keys(MIKU_ASSETS).length) return;
    var origOpen = XMLHttpRequest.prototype.open;
    if (origOpen.__patched) return;
    XMLHttpRequest.prototype.open = function (method, url) {
      var local = localURL(url);
      var args = Array.prototype.slice.call(arguments);
      if (local) args[1] = local;      // 只换 URL，其余全走原生
      return origOpen.apply(this, args);
    };
    XMLHttpRequest.prototype.open.__patched = true;
  })();

  /* pixi 贴图层拦截：
   * pixi-live2d-display 用 PIXI.Texture.fromURL() 加载贴图，内部走 Image 元素，
   * 不经过 XMLHttpRequest，所以上面 patch XHR 对贴图无效。
   * 这里在 pixi 就绪后包一层，把 miku/ 下的 URL 换成 data: URL。 */
  function patchPixiTexture() {
    var P = window.PIXI;
    if (!P || !P.Texture || P.__texPatched) return;
    P.__texPatched = true;

    var origFromURL = P.Texture.fromURL;
    if (typeof origFromURL === 'function') {
      P.Texture.fromURL = function (url) {
        var local = localURL(url);
        var args = Array.prototype.slice.call(arguments);
        if (local) args[0] = local;
        return origFromURL.apply(P.Texture, args);
      };
    }
    var origFrom = P.Texture.from;
    if (typeof origFrom === 'function') {
      P.Texture.from = function (src) {
        var local = (typeof src === 'string') ? localURL(src) : null;
        var args = Array.prototype.slice.call(arguments);
        if (local) args[0] = local;
        return origFrom.apply(P.Texture, args);
      };
    }
    var origBaseFrom = P.BaseTexture && P.BaseTexture.from;
    if (typeof origBaseFrom === 'function') {
      P.BaseTexture.from = function (src) {
        var local = (typeof src === 'string') ? localURL(src) : null;
        var args = Array.prototype.slice.call(arguments);
        if (local) args[0] = local;
        return origBaseFrom.apply(P.BaseTexture, args);
      };
    }
  }

  /* fetch 同理兜底（SDK 某些路径或后续扩展可能用 fetch） */
  (function patchFetch() {
    if (!Object.keys(MIKU_ASSETS).length) return;
    var origFetch = window.fetch;
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url);
      var local = localURL(url);
      if (!local) return origFetch.apply(this, arguments);
      return origFetch.call(this, local, init);
    };
  })();

  /* 记住加载过的脚本地址，避免重复注入 */
  var loadedSrc = {};
  function loadOne(src) {
    if (loadedSrc[src]) return loadedSrc[src];
    loadedSrc[src] = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = function () { res(src); };
      s.onerror = function () { delete loadedSrc[src]; rej(new Error('script ' + src)); };
      document.head.appendChild(s);
    });
    return loadedSrc[src];
  }
  /* 本地优先，失败回退 CDN；两者都失败才算真失败 */
  function loadScript(key) {
    var item = (typeof key === 'string' && SRC[key]) ? SRC[key] : { local: key, cdn: null };
    return loadOne(item.local).catch(function (e1) {
      if (!item.cdn) throw e1;
      console.warn('[lib] 本地脚本不可用，回退 CDN：' + item.local);
      return loadOne(item.cdn).catch(function () {
        throw new Error('引擎脚本加载失败：' + item.local);
      });
    });
  }
  function withTimeout(p, ms, tag) {
    return Promise.race([p, new Promise(function (_, rej) {
      setTimeout(function () { rej(new Error('timeout:' + tag)); }, ms);
    })]);
  }
  function showTip(html) {
    engineTip.innerHTML = html;
    engineTip.style.display = 'block';
  }
  function hideTip() { engineTip.style.display = 'none'; }

  /* 实测 WebGL 可用性：spine / live2d 均依赖 WebGL。
   * 注意两点坑：
   *   ① 探测用的上下文必须主动释放（loseContext），否则浏览器有「上下文上限」，
   *      探测占掉一个名额，后面 pixi 创建真正的上下文时反而拿不到。
   *   ② 一次失败不能立刻判死：部分驱动/集显首次创建会失败，重试一次即可成功。
   * 只有连续失败才认定为「无 WebGL」。 */
  function probeWebGL() {
    try {
      var cv = document.createElement('canvas');
      var opts = { failIfMajorPerformanceCaveat: false, antialias: false, depth: false, stencil: false };
      var gl = cv.getContext('webgl2', opts) || cv.getContext('webgl', opts) ||
               cv.getContext('experimental-webgl', opts);
      if (!gl) return false;
      // 归还上下文名额（上限通常 8~16 个，探测占掉会影响 pixi 建真正的上下文）
      try {
        var ext = gl.getExtension('WEBGL_lose_context');
        if (ext) ext.loseContext();
      } catch (e) {}
      return true;
    } catch (e) { return false; }
  }
  /* 注意：不永久缓存「失败」结果。
   * file:// 打开时，页面前期 GPU 进程可能还没就绪，第一次探测常返回 false，
   * 之后就好了。缓存 false 会导致之后一律走 Canvas2D。只缓存「成功」。 */
  function webglOK() {
    if (webglOK._c === true) return true;
    webglOK._c = probeWebGL() || probeWebGL() || probeWebGL();
    return webglOK._c;
  }

  /* ---------------- ④ 内置歌手：纯 Canvas 矢量角色（零依赖兜底） ---------------- */
  function BuiltinSinger(canvas) {
    var ctx = canvas.getContext('2d');
    var W = 300, H = 300;
    canvas.width = W * 2; canvas.height = H * 2;   // 2x 高清
    ctx.scale(2, 2);
    var t = 0, singAmt = 0, mouth = 0, level = 0;

    function roundRect(c, x, y, w, h, r) {
      c.beginPath();
      c.moveTo(x + r, y);
      c.arcTo(x + w, y, x + w, y + h, r);
      c.arcTo(x + w, y + h, x, y + h, r);
      c.arcTo(x, y + h, x, y, r);
      c.arcTo(x, y, x + w, y, r);
      c.closePath();
    }

    function draw() {
      t += 0.016;
      // 状态缓动：唱歌时话筒抬起、身体律动
      var target = engineState === 'sing' ? 1 : 0;
      singAmt += (target - singAmt) * 0.08;
      level += ((engineLevel || 0) - level) * 0.25;
      mouth += ((engineState === 'sing' ? 0.25 + level * 0.85 : 0) - mouth) * 0.4;

      ctx.clearRect(0, 0, W, H);
      var cx = W / 2;
      // 呼吸/律动
      var bob = Math.sin(t * 2.2) * 1.6 + level * 2.4;
      var sway = Math.sin(t * 1.1) * 1.2 * singAmt;

      /* 腿 + 身体 */
      ctx.save();
      ctx.translate(sway * 0.4, bob * 0.25);

      // 影子
      ctx.beginPath();
      ctx.ellipse(cx, 268, 44, 8, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.fill();

      // 腿
      ctx.fillStyle = '#2a3350';
      roundRect(ctx, cx - 22, 214, 16, 46, 8); ctx.fill();
      roundRect(ctx, cx + 6, 214, 16, 46, 8); ctx.fill();
      // 鞋
      ctx.fillStyle = '#161c2c';
      roundRect(ctx, cx - 27, 252, 24, 12, 6); ctx.fill();
      roundRect(ctx, cx + 4, 252, 24, 12, 6); ctx.fill();

      // 躯干（外套）
      var g = ctx.createLinearGradient(0, 130, 0, 220);
      g.addColorStop(0, '#4a6bd6');
      g.addColorStop(1, '#2a3a76');
      ctx.fillStyle = g;
      roundRect(ctx, cx - 34, 132, 68, 90, 22);
      ctx.fill();
      // 内搭
      ctx.fillStyle = 'rgba(255,255,255,.16)';
      ctx.beginPath();
      ctx.moveTo(cx - 10, 134); ctx.lineTo(cx, 168); ctx.lineTo(cx + 10, 134);
      ctx.closePath(); ctx.fill();

      /* 左手（随节拍摆动） */
      ctx.save();
      ctx.translate(cx - 34, 148);
      ctx.rotate(-0.35 + Math.sin(t * 2.4) * 0.09 * (0.3 + singAmt));
      ctx.strokeStyle = '#4a6bd6'; ctx.lineWidth = 13; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-20, 44); ctx.stroke();
      ctx.fillStyle = '#e8c7a8';
      ctx.beginPath(); ctx.arc(-22, 50, 7.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      /* 右手 + 话筒（sing 时抬到嘴边） */
      ctx.save();
      var armAng = -0.35 + singAmt * (-1.95);        // 抬起角度
      ctx.translate(cx + 34, 148);
      ctx.rotate(armAng);
      ctx.strokeStyle = '#4a6bd6'; ctx.lineWidth = 13; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(18, 44); ctx.stroke();
      // 话筒
      ctx.save();
      ctx.translate(18, 44);
      ctx.rotate(-armAng * 0.9);
      ctx.globalAlpha = 0.35 + singAmt * 0.65;
      // 麦柄
      ctx.fillStyle = '#20263a';
      roundRect(ctx, -3.5, -4, 7, 34, 3.5); ctx.fill();
      // 麦头
      var mg = ctx.createRadialGradient(-2, -12, 1, 0, -10, 12);
      mg.addColorStop(0, '#cfd8e8'); mg.addColorStop(1, '#5b6579');
      ctx.fillStyle = mg;
      ctx.beginPath(); ctx.arc(0, -11, 9.5, 0, Math.PI * 2); ctx.fill();
      // 麦头网纹
      ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1;
      for (var mi = -6; mi <= 6; mi += 4) {
        ctx.beginPath(); ctx.moveTo(mi, -20); ctx.lineTo(mi, -2); ctx.stroke();
      }
      // 手中
      ctx.fillStyle = '#e8c7a8';
      ctx.beginPath(); ctx.arc(0, 8, 7, 0, Math.PI * 2); ctx.fill();
      // 歌唱光效：麦头脉冲
      if (engineState === 'sing') {
        ctx.shadowColor = 'rgba(120,190,255,.95)';
        ctx.shadowBlur = 10 + level * 22;
        ctx.strokeStyle = 'rgba(150,205,255,' + (0.25 + level * 0.55) + ')';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, -11, 13 + level * 6, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
      ctx.restore();

      /* 头 */
      ctx.save();
      ctx.translate(cx + sway * 0.8, 96 + bob * 0.5);
      ctx.rotate(Math.sin(t * 1.7) * 0.035 * (0.4 + singAmt));
      // 脖子
      ctx.fillStyle = '#e8c7a8';
      roundRect(ctx, -7, 28, 14, 14, 5); ctx.fill();
      // 脸
      var fg = ctx.createRadialGradient(-8, -8, 4, 0, 0, 34);
      fg.addColorStop(0, '#fbe0c6'); fg.addColorStop(1, '#e8c7a8');
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.arc(0, 0, 30, 0, Math.PI * 2); ctx.fill();
      // 头发
      ctx.fillStyle = '#26202c';
      ctx.beginPath();
      ctx.arc(0, -3, 31, Math.PI * 0.98, Math.PI * 2.02);
      ctx.lineTo(24, 4); ctx.quadraticCurveTo(10, -14, -24, 4);
      ctx.closePath(); ctx.fill();
      // 刘海
      ctx.beginPath();
      ctx.moveTo(-28, -2); ctx.quadraticCurveTo(-16, -26, 6, -26);
      ctx.quadraticCurveTo(22, -26, 28, -4);
      ctx.quadraticCurveTo(14, -16, -2, -12);
      ctx.quadraticCurveTo(-16, -10, -28, -2);
      ctx.fill();

      // 眼睛（唱歌时微闭 + 眨眼）
      var blink = (Math.sin(t * 0.9) > 0.985) ? 0.12 : 1;
      var eyeY = -1;
      ctx.fillStyle = '#1d2433';
      ctx.beginPath(); ctx.ellipse(-11, eyeY, 4.2, 5.4 * blink, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(11, eyeY, 4.2, 5.4 * blink, 0, 0, Math.PI * 2); ctx.fill();
      // 高光
      if (blink > 0.5) {
        ctx.fillStyle = 'rgba(255,255,255,.9)';
        ctx.beginPath(); ctx.arc(-12.2, eyeY - 1.8, 1.5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(9.8, eyeY - 1.8, 1.5, 0, Math.PI * 2); ctx.fill();
      }
      // 腮红（唱歌时更明显）
      ctx.fillStyle = 'rgba(240,130,150,' + (0.18 + singAmt * 0.3) + ')';
      ctx.beginPath(); ctx.ellipse(-17, 10, 6, 3.6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(17, 10, 6, 3.6, 0, 0, Math.PI * 2); ctx.fill();
      // 嘴：口型由音量驱动
      var mo = Math.max(0.06, mouth);
      ctx.fillStyle = '#7c2b3c';
      ctx.beginPath();
      ctx.ellipse(0, 15, 5.2, 1.2 + mo * 6.5, 0, 0, Math.PI * 2);
      ctx.fill();
      if (mo > 0.35) {                       // 张口时露齿
        ctx.fillStyle = 'rgba(255,255,255,.75)';
        ctx.beginPath();
        ctx.ellipse(0, 15 - mo * 2.6, 3.4, 0.9, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      /* 唱歌时飘出的音符 */
      if (singAmt > 0.15) {
        for (var k = 0; k < 3; k++) {
          var pr = ((t * 0.5 + k * 0.34) % 1);
          var alpha = Math.sin(pr * Math.PI) * singAmt;
          var nx = cx + 52 + pr * 42 + Math.sin(pr * 6 + k) * 5;
          var ny = 120 - pr * 66;
          ctx.globalAlpha = alpha * 0.9;
          ctx.fillStyle = '#7fb2ff';
          ctx.font = 'bold ' + (12 + k * 2) + 'px system-ui';
          ctx.fillText(k % 2 ? '♪' : '♫', nx, ny);
          ctx.globalAlpha = 1;
        }
      }
      ctx.restore();

      requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
    return { setState: function (s) { engineState = s; }, tick: function (l) { engineLevel = l; }, destroy: function () {} };
  }

  /* ---------------- ③ AE 序列帧：逐帧绘制（支持多组动作） ---------------- */
  function AESequence(canvas, cfg) {
    var ctx = canvas.getContext('2d');
    var W = 300, H = 300;
    canvas.width = W * 2; canvas.height = H * 2;
    ctx.scale(2, 2);
    var cache = {};                 // url → Image
    var groups = cfg.groups || {};
    var cur = cfg.idle || 'idle';
    var fi = 0, lastT = 0, state = 'idle', level = 0;

    function img(src) {
      if (!cache[src]) {
        var im = new Image();
        im.crossOrigin = 'anonymous';
        im.src = src;
        cache[src] = im;
      }
      return cache[src];
    }
    function hasGroup(g) {
      return groups[g] && groups[g].frames && groups[g].frames.length;
    }
    function draw(ts) {
      requestAnimationFrame(draw);
      var g = groups[cur];
      if (!g || !g.frames.length) {
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = '#7fb2ff';
        ctx.font = '12px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('未配置序列帧', W / 2, H / 2);
        return;
      }
      var fps = g.fps || 24;
      if (ts - lastT > 1000 / fps) {
        lastT = ts;
        fi = (fi + 1) % g.frames.length;
        // 唱歌时口型可叠加音量的轻微缩放
        cur = (state === 'sing' && hasGroup(cfg.sing)) ? cfg.sing : cfg.idle;
      }
      var im = img(g.frames[fi]);
      ctx.clearRect(0, 0, W, H);
      if (im.complete && im.naturalWidth) {
        var s = Math.min(W / im.naturalWidth, H / im.naturalHeight) * (cfg.scale || 1);
        var dw = im.naturalWidth * s, dh = im.naturalHeight * s;
        ctx.drawImage(im, (W - dw) / 2, H - dh, dw, dh);
      }
    }
    requestAnimationFrame(draw);
    return {
      setState: function (s) {
        if (s === state) return;
        state = s;
        cur = (s === 'sing' && hasGroup(cfg.sing)) ? cfg.sing : cfg.idle;
        fi = 0;
      },
      tick: function (l) { level = l; },
      destroy: function () { cache = {}; }
    };
  }

  /* ---------------- ② Spine：pixi + pixi-spine ---------------- */
  function SpineAvatar(container, cfg) {
    var app = null, spine = null;
    var state = 'idle';

    function build() {
      var PIXI = window.PIXI;
      if (!PIXI || !PIXI.spine) throw new Error('pixi-spine 未就绪');
      app = new PIXI.Application({
        width: 300, height: 300,
        backgroundAlpha: 0, antialias: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        autoDensity: true
      });
      container.appendChild(app.view);
      app.view.style.width = '100%';
      app.view.style.height = '100%';
      return new Promise(function (res, rej) {
        // pixi-spine 3.x + pixi6：用 app.loader，解析结果在 resources.spineData.spineData
        app.loader
          .add('spineData', cfg.json)
          .load(function (loaderObj, resources) {
          try {
            var data = resources.spineData.spineData;
            spine = new PIXI.spine.Spine(data);
            var sp = cfg.scale || 0.4;
            spine.scale.set(sp);
            // 居中：spineboy 原点在脚底
            spine.x = 150;
            spine.y = 288;
            app.stage.addChild(spine);
            if (spine.state && spine.state.hasAnimation && spine.state.hasAnimation(cfg.idle || 'idle')) {
              spine.state.setAnimation(0, cfg.idle || 'idle', true);
            }
            res();
          } catch (e) { rej(e); }
          }, function () { rej(new Error('spine load')); });
      });
    }

    return {
      load: build,
      setState: function (s) {
        if (!spine || !spine.state || s === state) return;
        state = s;
        var anim = s === 'sing' ? (cfg.singAnim || 'jump') : (cfg.idleAnim || 'idle');
        try {
          if (spine.state.hasAnimation && spine.state.hasAnimation(anim)) {
            spine.state.setAnimation(0, anim, true);
          }
        } catch (e) {}
      },
      tick: function (l) { if (spine) { spine.scale.y = (cfg.scale) * (1 + l * 0.05); } },
      destroy: function () { if (app) { try { app.destroy(true, { children: true }); } catch (e) {} app = null; } spine = null; }
    };
  }

  /* ---------------- ① Live2D：真实 cubism2 引擎链路 ----------------
   * 依赖链（严格按 pixi-live2d-display@0.4.0 的 peerDependencies ^6 适配）：
   *   pixi.js@6.5.10  →  live2d.min.js（Cubism 2 Core）  →  cubism2.min.js  →  index.min.js
   * 顺序不可调换：cubism2.min.js 是挂到 PIXI.live2d 上的插件，必须在 pixi 之后；
   * 且 cubism2.min.js 内部会检测 window.Live2D，所以 Core 必须先于插件加载。
   * ------------------------------------------------------------ */
  function Live2DAvatar(container, cfg) {
    var app = null, model = null, state = 'idle';
    var baseScale = 1, baseX = 0, baseY = 0;

    function build() {
      var PIXI = window.PIXI;
      if (!PIXI) throw new Error('pixi 未就绪');
      var L2D = PIXI.live2d;
      if (!L2D || !L2D.Live2DModel) throw new Error('PIXI.live2d 未注册');
      // Cubism 2 模型必须有 Core 运行时，缺失时给出可诊断的错误而非静默失败
      var isCubism2 = cfg.model.indexOf('model3.json') < 0;
      if (isCubism2 && !window.Live2D) throw new Error('Cubism2 Core(live2d.min.js) 未加载');

      // pixi 渲染器。优先 WebGL；WebGL 不可用（未开硬件加速）时回退 Canvas2D，
      // 这样即使没有 GPU 也能看到初音，只是帧率与特效略降。
      // autoStart:true 让 pixi 自带 ticker 持续渲染——这是画面能上屏的关键，
      // 只调 model.update() 而不 render 是不出图的。
      var appOpts = {
        width: 300, height: 300,
        backgroundAlpha: 0,
        antialias: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        autoDensity: true,
        // 关掉 pixi 自带 ticker，改由 rAF 统一驱动 update + render，
        // 避免「只 render 不 update」导致画面全空（SDK 会报 update() before draw()）。
        autoStart: false
      };
      var hasGL = false;
      try {
        var testCv = document.createElement('canvas');
        hasGL = !!(testCv.getContext('webgl2') || testCv.getContext('webgl'));
      } catch (e0) { hasGL = false; }

      if (hasGL) {
        try {
          app = new PIXI.Application(Object.assign({}, appOpts, { powerPreference: 'high-performance' }));
        } catch (eGL) { app = null; }
      }
      if (!app) {
        // 走 Canvas2D：pixi-legacy 才有 CanvasRenderer
        if (!PIXI.CanvasRenderer) throw new Error('WebGL 不可用且缺少 Canvas2D 渲染器');
        app = new PIXI.Application(Object.assign({}, appOpts, { forceCanvas: true }));
        console.info('[live2d] WebGL 不可用，已切换到 Canvas2D 渲染');
      }
      container.appendChild(app.view);
      app.view.style.width = '100%';
      app.view.style.height = '100%';
      app.view.style.display = 'block';

      return L2D.Live2DModel.from(cfg.model, {
        autoInteract: false,
        // 关键：必须关掉 autoUpdate，改由我们自己每帧调 model.update(dt)。
        // 开 autoUpdate 时 SDK 内部依赖它的 ticker，而我们的 rAF 独立驱动 render，
        // 会出现 "call update() before draw()" 且画面全空。
        autoUpdate: false
      }).then(function (m) {
        model = m;
        app.stage.addChild(model);

        // 以模型原始包围盒自适应容器：脚底贴容器底部，头顶留 4% 余量
        var bw = m.width, bh = m.height;
        var s = Math.min(300 / bw, 300 / bh) * (cfg.scale || 1) * 0.92;
        baseScale = s;
        baseX = (300 - bw * s) / 2;
        baseY = 300 - bh * s;
        m.scale.set(s);
        m.x = baseX;
        m.y = baseY;

        // 把渲染器自身的 view 尺寸同步给 pixi（autoDensity 下按 CSS 像素）
        try { app.renderer.resize(300, 300); } catch (e) {}

        // 待机动作分组名（cubism2 的 mtn 组名由 model.json 的 motions 键决定）
        try {
          var mm = m.internalModel.motionManager;
          if (mm.groups) mm.groups.idle = cfg.idleGroup || 'idle';
          if (cfg.idleGroup) m.motion(cfg.idleGroup);
        } catch (e) {}

        // 眨眼 / 呼吸由 SDK 自动接管；这里只把「口型」参数接管过来做音量驱动
        try {
          if (m.internalModel.coreModel && m.internalModel.coreModel.setParamFloat) {
            m.internalModel.coreModel.setParamFloat('PARAM_MOUTH_OPEN_Y', 0);
          }
        } catch (e) {}

        return m;
      }).then(function (m) {
        // 首帧：先 update 再 render，顺序不能反
        try { m.update(1 / 60); } catch (e) {}
        try { app.render(); } catch (e) {}
        return m;
      });
    }

    /* 播放/暂停 → 切动作。miku.model.json 的 motions 键（已实测）：
     *   "idle" : miku_idle_01.mtn                          → 待机呼吸
     *   "null" : miku_sing_01..06 + miku_shake_01              → 演唱/摆动动作
     * 注意 "null" 是字符串键，不是 JS 的 null，必须原样传入。 */
    function playGroup(group) {
      if (!model) return false;
      try {
        var mm = model.internalModel.motionManager;
        var defs = mm.definitions || (mm.motionManager && mm.motionManager.definitions);
        var available = Object.keys(defs || {});
        var target = null;
        for (var i = 0; i < available.length; i++) {
          if (available[i] === group) { target = group; break; }
        }
        if (target === null) {
          // 精确匹配失败时按关键字回退（例如其它模型的 "talk"/"sing" 组）
          for (var j = 0; j < available.length; j++) {
            if (available[j].toLowerCase().indexOf(String(group).toLowerCase()) >= 0) { target = available[j]; break; }
          }
        }
        if (target !== null) {
          var r = model.motion(target, 0, 3);      // 优先级 3 = FORCE，确保立刻切换
          return !!r;
        }
      } catch (e) {}
      return false;
    }

    return {
      load: build,
      setState: function (s) {
        if (!model || s === state) return;
        state = s;
        this._danceIdx = 0;             // 每次进状态都从头起舞
        this._nextSwap = 0;
        if (s === 'sing') {
          // 演唱：唱跳开 → 成套编排舞蹈（顺序播放）；关 → 普通演唱动作
          var ok = playGroup(danceMode ? (cfg.danceGroup || 'dance') : (cfg.singGroup === undefined || cfg.singGroup === null ? 'null' : cfg.singGroup));
          if (!ok) playGroup(cfg.idleGroup || 'idle');
        } else {
          playGroup(cfg.idleGroup || 'idle');
        }
      },
      tick: function (l) {
        if (!model || !app) return;
        // 核心：必须 update() 之后再 render()。
        // 只 render 不 update，SDK 会报 "call update() before draw()" 且画面全空。
        var dt = PIXI.Ticker.shared ? PIXI.Ticker.shared.deltaMS / 1000 : 1 / 60;
        try { model.update(dt); } catch (e) {}
        try { app.render(); } catch (e) {}
        var core = model.internalModel && model.internalModel.coreModel;
        if (!core || !core.setParamFloat) return;
        // 口型保持音量驱动（写在动作之后，实时贴合歌声）
        try {
          core.setParamFloat('PARAM_MOUTH_OPEN_Y', 0.08 + l * 0.85);
        } catch (e) {
          try { core.setParamFloat('ParamMouthOpenY', 0.08 + l * 0.85); } catch (e2) {}
        }

        /* ===== 成套编排舞蹈的顺序调度 =====
         * dance_01 起手亮相 → 02 左右律动 → 03 双臂大摆 → 04 转体扭腰
         * → 05 应援挥手 → 06 收势定格，按顺序循环。
         * 每段 8 拍（约 112 BPM，4.3s），舞步全部由关键帧编排：
         * 头/身体三轴、双臂、眼球、笑眼、脸颊红晕都有独立设计的姿势。 */
        if (state === 'sing') {
          var now = Date.now();
          var group = danceMode ? (cfg.danceGroup || 'dance') : (cfg.singGroup || 'null');
          if (!this._nextSwap) this._nextSwap = now + 4400;
          if (now > this._nextSwap) {
            this._nextSwap = now + 4400;              // 与每段 8 拍时长对齐
            this._danceIdx = ((this._danceIdx || 0) + 1) % (cfg.danceSteps || 6);
            try { model.motion(group, this._danceIdx, 1); } catch (e) {}
          }
          // 唱跳时补一点节拍弹跳感（幅度小，只叠加在呼吸通道上不破坏舞步）
          if (danceMode) {
            var bt = (audio.currentTime || 0) * (112 / 60) * Math.PI * 2;
            try { core.addToParamFloat('PARAM_BREATH', Math.abs(Math.sin(bt)) * 0.25 * (0.5 + l)); } catch (e) {}
          }
        }
      },
      destroy: function () {
        try { if (model) model.destroy(); } catch (e) {}
        model = null;
        if (app) { try { app.destroy(true, { children: true, texture: false }); } catch (e) {} app = null; }
      }
    };
  }

  /* ---------------- 引擎调度 ---------------- */
  function clearStage() {
    if (engine && engine.destroy) { try { engine.destroy(); } catch (e) {} }
    engine = null;
    // 移除除 tip 与 glow 之外的子节点
    Array.prototype.slice.call(engineEl.children).forEach(function (c) {
      if (c !== engineTip && !c.classList.contains('avatar-glow')) c.remove();
    });
  }

  function mountAvatar(type) {
    var mySeq = ++mountSeq;          // 本次切换的序号
    avatarType = type;
    var def = AVATARS[type];
    // 切换 UI 选中态
    Array.prototype.slice.call(aPanel.querySelectorAll('.a-row')).forEach(function (r) {
      r.classList.toggle('on', r.dataset.avatar === type);
    });
    aLabel.textContent = '整体形象：' + (def ? def.name : '胶片');
    engineState = audio.paused ? 'idle' : 'sing';

    widget.classList.toggle('mode-avatar', type !== 'disc');
    widget.classList.toggle('can-sing', type !== 'disc');
    clearStage();
    // 切换后菜单重新贴合新包围盒
    if (menu.style.display === 'block') setTimeout(positionMenu, 60);

    if (type === 'disc') {
      // 只清理画布，保留 tip / glow 节点（engineEl.innerHTML 会连提示元素一起删掉）
      Array.prototype.slice.call(engineEl.querySelectorAll('canvas')).forEach(function (c) { c.remove(); });
      hideTip();
      aTip.textContent = '已切回胶片模式';
      return;
    }

    // 只有内置歌手 / AE 需要预建 canvas；Live2D 与 Spine 由 pixi 自己创建。
    // 之前无条件预建会导致舞台上多出一个空 canvas 挡住形象。
    if (type === 'builtin' || type === 'ae') {
      var canvas = document.createElement('canvas');
      canvas.width = 300; canvas.height = 300;
      engineEl.appendChild(canvas);

      if (type === 'builtin') {
        hideTip();
        engine = BuiltinSinger(canvas);
        aTip.textContent = '内置歌手已就位（零依赖，立即可用）';
        return;
      }

      engine = AESequence(canvas, def);
      if (!def.groups) {
        showTip('<b>AE 序列帧</b><br>请在源码 <b>AVATARS.ae.groups</b> 中<br>填入你的 PNG 序列帧地址');
        aTip.textContent = 'AE 序列帧待配置';
      } else { hideTip(); aTip.textContent = 'AE 序列帧已加载'; }
      return;
    }
    // Live2D / Spine 需要外部库 + WebGL。
    // 策略：不用 getContext 预检一票否决（预检易误判，还会占掉一个上下文名额）。
    // 直接让 pixi 去真实创建 renderer，成功了就是最好的证明；
    // 真失败则走下面的 catch 统一降级，并给出可点击重试的提示。
    var glProbeOk = webglOK();   // 仅用于失败时区分「无 WebGL」还是「资源/网络问题」
    showTip('<b>' + def.name + '</b><br>正在加载引擎…');
    var chain;
    if (type === 'spine') {
      chain = loadScript('pixi')
        .then(function () { return loadScript('spine'); })
        .then(function () {
          var sp = SpineAvatar(engineEl, def);
          engine = sp;
          return sp.load();
        });
    } else {
      // 官方推荐加载顺序：pixi → live2d 核心运行时 → pixi-live2d-display
      // 加载顺序（已用 jsdom 实测逐条验证，顺序不可调换）：
      //   pixi6 → Cubism2 Core(初音用) → Cubism4 Core(仅为主库的硬检测) → cubism2 插件 → 主库
      // 无 WebGL 时加载 pixi-legacy（带 Canvas2D 渲染器），保证形象仍可见
      var pixiKey = webglOK() ? 'pixi' : 'pixiLegacy';
      chain = loadScript(pixiKey)
        .then(function () {
          // pixi 一就绪就装上贴图 URL 拦截，必须早于模型创建
          patchPixiTexture();
          return loadScript('cub2core');
        })
        .then(function () { return loadScript('cub4core'); })
        .then(function () { return loadScript('cub2plug'); })
        .then(function () { return loadScript('index'); })
        .then(function () {
          if (!window.PIXI) throw new Error('pixi 未就绪');
          if (!window.PIXI.live2d) throw new Error('PIXI.live2d 未注册');
          if (!window.Live2D) throw new Error('Cubism2 Core 未加载');
          patchPixiTexture();               // 主库加载后再保险一次
          var l2 = Live2DAvatar(engineEl, def);
          engine = l2;
          return l2.load();
        });
    }
    withTimeout(chain, 15000, type).then(function () {
      if (mySeq !== mountSeq) return;      // 已切到别的形象，丢弃本次结果
      hideTip();
      aTip.textContent = def.name + ' 形象已加载';
      if (engine && engine.setState) engine.setState(audio.paused ? 'idle' : 'sing');
    }).catch(function (err) {
      if (mySeq !== mountSeq) return;      // 过期结果不再改写舞台
      // 失败降级：自动切到内置歌手，保证「形象一定看得见」，并给出可点击重试入口
      var msg = String((err && err.message) || err || 'unknown');
      var noGL = /webgl|context|renderer/i.test(msg) || !glProbeOk;
      clearStage();
      var cv = document.createElement('canvas');
      cv.width = 300; cv.height = 300;
      engineEl.appendChild(cv);
      engine = BuiltinSinger(cv);
      showTip(
        '<b>' + def.name + (noGL ? ' 需要 WebGL' : ' 加载失败') + '</b><br>' +
        (noGL
          ? '当前浏览器未启用 WebGL / 硬件加速<br>' +
            '请在 chrome://settings 打开「使用硬件加速」后重启浏览器'
          : '已降级为内置歌手<br><span style="font-size:11px;opacity:.7">' + msg.slice(0, 70) + '</span>') +
        '<br><span class="retry-btn" data-retry="1">点此重试加载形象</span>'
      );
      aTip.textContent = def.name + (noGL ? ' 需 WebGL，已降级' : ' 不可用，已降级');
      console.warn('[avatar] load failed:', msg);
    });
  }

  /* 播放状态 / 音量 → 形象动作 */
  function syncAvatarState() {
    engineState = audio.paused ? 'idle' : 'sing';
    widget.classList.toggle('avatar-playing', !audio.paused);
    // 状态直接显示在右键菜单的「整体形象」标题上，不额外遮挡形象
    if (avatarType !== 'disc') {
      aLabel.textContent = '整体形象：' + AVATARS[avatarType].name +
        (audio.paused ? ' · 待机' : ' · 演唱中');
    }
    if (engine && engine.setState) engine.setState(engineState);
  }
  function pumpAvatar() {
    requestAnimationFrame(pumpAvatar);
    if (!engine || avatarType === 'disc') return;
    // 用低频 + 中频能量合成「口型能量」
    var lv = 0;
    if (analyser && freqData && !audio.paused) {
      analyser.getByteFrequencyData(freqData);
      var s = 0;
      for (var k = 2; k < 28; k++) s += freqData[k];
      lv = Math.min(s / 26 / 255 * 1.9, 1);
    } else if (!audio.paused) {
      lv = Math.abs(Math.sin(Date.now() / 220)) * 0.55;
    }
    if (engine.tick) engine.tick(lv);
  }

  /* 形象面板交互 */
  aToggle.addEventListener('click', function (e) {
    e.stopPropagation();
    var open = aPanel.style.display !== 'none';
    aPanel.style.display = open ? 'none' : 'block';
    aArrow.style.transform = open ? 'rotate(-90 12 12)' : '';
  });
  aPanel.addEventListener('click', function (e) {
    e.stopPropagation();
    var row = e.target.closest('.a-row');
    if (!row) return;
    mountAvatar(row.dataset.avatar);
  });
  /* 唱跳模式开关：只影响 Live2D 形象的舞蹈叠加层 */
  (function bindDance() {
    var btn = document.getElementById('danceToggle');
    var lab = document.getElementById('danceLabel');
    if (!btn || !lab) return;
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      danceMode = !danceMode;
      lab.textContent = '唱跳模式：' + (danceMode ? '开' : '关');
      btn.classList.toggle('off', !danceMode);
      // 演唱中立即切换舞组：强制重新进入 sing 状态
      if (!audio.paused && engine && engine.setState) {
        engineState = 'idle';
        engine.setState('idle');
        engineState = 'sing';
        engine.setState('sing');
      }
      aTip.textContent = danceMode ? '唱跳模式：成套编舞（6 段循环）' : '唱跳模式已关闭';
      setTimeout(function () {
        if (avatarType !== 'disc') aTip.textContent =
          AVATARS[avatarType].name + (audio.paused ? ' · 待机' : ' · 演唱中');
      }, 1600);
    });
  })();
  /* 降级提示里的「重试加载形象」：重置 WebGL 预检缓存后重新挂载 */
  engineTip.addEventListener('click', function (e) {
    if (!e.target.closest('.retry-btn')) return;
    e.stopPropagation();
    webglOK._c = undefined;
    mountAvatar(avatarType === 'disc' ? 'live2d' : avatarType);
  });
  pumpAvatar();

  /* ================= 拖拽 ================= */
  var dragging = false, sx, sy, ox, oy;
  widget.addEventListener('pointerdown', function (e) {
    dragging = true; moved = false;
    sx = e.clientX; sy = e.clientY;
    var r = widget.getBoundingClientRect();
    ox = r.left; oy = r.top;
    widget.classList.add('dragging');
    widget.setPointerCapture(e.pointerId);
  });
  widget.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    var dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
    widget.style.right = 'auto'; widget.style.bottom = 'auto';
    widget.style.left = Math.min(Math.max(ox + dx, 0), window.innerWidth - widget.offsetWidth) + 'px';
    widget.style.top = Math.min(Math.max(oy + dy, 0), window.innerHeight - widget.offsetHeight) + 'px';
    if (menu.style.display === 'block') positionMenu();   // 菜单跟随胶片移动
  });
  widget.addEventListener('pointerup', function () {
    dragging = false;
    widget.classList.remove('dragging');
    setTimeout(function () { moved = false; }, 50);
  });

  /* ================= 启动 ================= */
  widget.classList.add('loading');
  mTip.textContent = '曲库加载中…';
  fetchLibrary().then(function (list) {
    tracks = list;
    widget.classList.remove('loading');
    mTitle.textContent = '曲库就绪（' + list.length + ' 首）';
    mArtist.textContent = '左键胶片开始播放';
    mTip.textContent = '已接入 ' + list.length + ' 首，点击胶片或按播放';
    // 预取第一首的播放地址（不自动播放，遵守浏览器自动播放策略）
    load(0, false);
  }).catch(function () {
    widget.classList.remove('loading');
    tracks = fallbackLibrary();
    mTip.textContent = '网络曲库不可用，已切换内置曲目';
    load(0, false);
  });

  /* 默认形象：初音未来（Live2D）。
   * 页面一打开就挂载，不必手动右键切换；无 WebGL 时 mountAvatar 内部会自动降级。
   * 延迟 1.2s：给 GPU 进程留出初始化时间，避免 file:// 首次探测拿不到 WebGL。
   * 宿主可通过 options.avatar 指定初始形象；也可随时调用 setAvatar(type)。 */
  var initialAvatar = (opts && opts.avatar) || 'live2d';
  if (!AVATARS[initialAvatar]) initialAvatar = 'live2d';
  var initialTimer = setTimeout(function () { mountAvatar(initialAvatar); }, 1200);

  /* 对外暴露形象控制接口：
   *   widget.__setAvatar(type)  切换形象（disc | live2d | blueberry | spine | ae | builtin）
   *   widget.__avatars          全部可用形象定义
   *   widget.__getAvatar()      当前形象标识
   * 其他页面 / 插件工程无需知道内部实现，拿到 MikuPlayer.init() 返回的实例即可调用。 */
  widget.__setAvatar = function (type) {
    clearTimeout(initialTimer);
    if (!AVATARS[type]) return false;
    mountAvatar(type);
    return true;
  };
  widget.__avatars = AVATARS;
  widget.__getAvatar = function () { return avatarType; };
})();
  }

  /**
   * 初始化播放器。
   * @param {string|Element} [container] 容器选择器或元素，默认 body
   * @param {Object} [options]
   * @param {boolean} [options.autoPlay=false]  是否自动播放（受浏览器自动播放策略限制）
   * @param {string}  [options.avatar='live2d'] 默认形象：disc | live2d | blueberry | spine | ae | builtin
   * @param {string}  [options.position]        覆盖默认位置，如 'right:36px;bottom:130px'
   * @returns {{ play:Function, pause:Function, toggle:Function, destroy:Function, el:HTMLElement }}
   */
  function init(container, options) {
    options = options || {};
    injectStyle();

    // 设置全局资源表（主程序通过 window.__MIKU_ASSETS__ 读取）
    global.__MIKU_ASSETS__ = MIKU_ASSETS;

    var host = resolveContainer(container);
    var wrap = document.createElement('div');
    wrap.className = 'miku-player-host';
    wrap.innerHTML = WIDGET_HTML;
    host.appendChild(wrap);

    // 可选：覆盖位置
    if (options.position) {
      var w = wrap.querySelector('#vinyl-widget');
      if (w) w.setAttribute('style', options.position);
    }

    // 执行主程序（会通过 getElementById 绑定刚注入的元素）
    runApp(options);

    var widget = wrap.querySelector('#vinyl-widget');
    var audio = wrap.querySelector('#audio');

    var api = {
      el: wrap,
      widget: widget,
      audio: audio,
      play: function () { if (audio) audio.play(); },
      pause: function () { if (audio) audio.pause(); },
      toggle: function () { if (audio) { if (audio.paused) audio.play(); else audio.pause(); } },
      /* 形象切换接口（供其他页面 / 工程复用）
       *   setAvatar('blueberry') → 切换为蓝莓酱桌宠形象
       *   avatarList()           → 可用形象列表 [{ id, name, type }]
       *   getAvatar()            → 当前形象 id */
      setAvatar: function (type) {
        return widget && widget.__setAvatar ? widget.__setAvatar(type) : false;
      },
      getAvatar: function () {
        return widget && widget.__getAvatar ? widget.__getAvatar() : null;
      },
      avatarList: function () {
        var defs = (widget && widget.__avatars) || {};
        return Object.keys(defs).map(function (id) {
          return { id: id, name: defs[id].name, type: defs[id].type };
        });
      },
      destroy: function () {
        if (wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap);
        var idx = instances.indexOf(api);
        if (idx >= 0) instances.splice(idx, 1);
      }
    };
    instances.push(api);
    return api;
  }

  global.MikuPlayer = { init: init, instances: instances };

  // 自动初始化：若页面存在 [data-miku-player] 容器则自动挂载
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }
  function autoInit() {
    var nodes = document.querySelectorAll('[data-miku-player]');
    nodes.forEach(function (n) { init(n); });
  }
})(typeof window !== 'undefined' ? window : this);

