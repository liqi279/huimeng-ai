/*!
 * HMCanvas — 绘梦「无限节点画布」
 *
 * 参考 Work Rally 类节点画布：
 *  - 无限平移 / 缩放（滚轮以指针为锚），点阵背景随相机移动
 *  - 节点：文本 / 图片（上传·粘贴·拖入）/ 生成图片 / 生成视频 / 生成音频
 *  - 连线：从输出端口拖到输入端口，类型匹配才可连接；生成节点按连线收集输入
 *  - 右键菜单在任意位置创建节点；Ctrl+V 直接粘贴图片或文本为节点
 *  - 底部左下角缩放控件（- / 百分比 / + / 适应全部）
 *  - 生成调用现有 HM.api.generate（image / video / audio），结果可继续作为下游参考图
 *  - 画布内容持久化到 localStorage（按登录用户隔离）
 *
 * 暴露：window.HMCanvas = { enter, leave, refresh }
 */
(function () {
  'use strict';

  var LS_KEY_BASE = 'anidream.nodeCanvas.v1';

  var NODE_DEFS = {
    text: {
      name: '文本', icon: 'T', w: 250,
      ins: [],
      outs: [{ id: 'prompt', label: '文本', kind: 'text' }]
    },
    image: {
      name: '图片', icon: '🖼', w: 250,
      ins: [],
      outs: [{ id: 'image', label: '图片', kind: 'image' }]
    },
    genImage: {
      name: '生成图片', icon: '✦', w: 300,
      ins: [
        { id: 'prompt', label: '提示词', kind: 'text', required: true },
        { id: 'ref', label: '参考图', kind: 'image' }
      ],
      outs: [{ id: 'image', label: '图片', kind: 'image' }]
    },
    genVideo: {
      name: '生成视频', icon: '▶', w: 300,
      ins: [
        { id: 'prompt', label: '提示词', kind: 'text', required: true },
        { id: 'ref', label: '参考图', kind: 'image' }
      ],
      outs: [{ id: 'video', label: '视频', kind: 'video' }]
    },
    genAudio: {
      name: '生成音频', icon: '♪', w: 280,
      ins: [{ id: 'text', label: '文本', kind: 'text', required: true }],
      outs: [{ id: 'audio', label: '音频', kind: 'audio' }]
    }
  };

  /* 端口类型兼容表：out.kind → 可接入的 in.kind */
  var KIND_MATCH = {
    text: ['text', 'prompt'],
    prompt: ['text', 'prompt'],
    image: ['image', 'ref'],
    ref: ['image', 'ref'],
    video: ['video'],
    audio: ['audio']
  };

  var state = {
    cam: { x: 0, y: 0, z: 1 },
    nodes: {},          // id -> node
    order: [],          // 渲染顺序（后面的在上层）
    edges: [],          // {id, from, fromPort, to, toPort, kind}
    seq: 1,
    selection: { nodes: {}, edgeId: null },
    panning: null,      // {startX, startY, camX, camY, moved}
    nodeDrag: null,     // {items:[{id,dx,dy}], moved}
    linking: null,      // {from, fromPort, kind, x, y}  世界坐标终点
    spaceDown: false
  };

  var els = {};         // viewport, grid, world, svg, menu, zoomLabel
  var bound = false;
  var saveTimer = null;

  function $(id) { return document.getElementById(id); }
  function app() { return window.HMApp || {}; }
  function api() { return window.HM && window.HM.api; }
  function toast(msg, type) { if (app().toast) app().toast(msg, type); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uid() { return 'n' + (state.seq++) + '_' + Math.random().toString(36).slice(2, 7); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function lsKey() {
    var uid2 = (app().user && app().user.id) || 'guest';
    return LS_KEY_BASE + '.' + uid2;
  }

  /* ---------------- 持久化 ---------------- */
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        var data = {
          cam: state.cam,
          seq: state.seq,
          order: state.order,
          nodes: state.order.map(function (id) {
            var n = state.nodes[id];
            return { id: n.id, type: n.type, x: n.x, y: n.y, w: n.w, data: n.data };
          }),
          edges: state.edges
        };
        localStorage.setItem(lsKey(), JSON.stringify(data));
      } catch (e) { /* localStorage 满或不可用 */ }
    }, 300);
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(lsKey()); } catch (e) {}
    if (!raw) return false;
    try {
      var data = JSON.parse(raw);
      if (!data || !Array.isArray(data.nodes)) return false;
      state.cam = data.cam && typeof data.cam.z === 'number' ? data.cam : { x: 0, y: 0, z: 1 };
      state.seq = data.seq || 1;
      state.nodes = {};
      state.order = [];
      data.nodes.forEach(function (n) {
        if (!n || !NODE_DEFS[n.type]) return;
        state.nodes[n.id] = {
          id: n.id, type: n.type,
          x: Number(n.x) || 0, y: Number(n.y) || 0,
          w: Number(n.w) || NODE_DEFS[n.type].w,
          data: n.data || {}
        };
        state.order.push(n.id);
      });
      state.edges = (data.edges || []).filter(function (e) {
        return e && state.nodes[e.from] && state.nodes[e.to];
      });
      return true;
    } catch (e) { return false; }
  }

  /* ---------------- 相机 ---------------- */
  function applyCam() {
    var z = state.cam.z;
    if (els.grid) {
      var size = 26 * z;
      els.grid.style.backgroundSize = size + 'px ' + size + 'px';
      els.grid.style.backgroundPosition = state.cam.x + 'px ' + state.cam.y + 'px';
    }
    if (els.world) {
      els.world.style.transform = 'translate(' + state.cam.x + 'px,' + state.cam.y + 'px) scale(' + z + ')';
    }
    if (els.svgG) {
      els.svgG.setAttribute('transform', 'translate(' + state.cam.x + ',' + state.cam.y + ') scale(' + z + ')');
    }
    if (els.zoomLabel) els.zoomLabel.textContent = Math.round(z * 100) + '%';
  }

  function zoomAt(factor, cx, cy) {
    var rect = els.viewport.getBoundingClientRect();
    var px = (cx == null ? rect.width / 2 : cx - rect.left);
    var py = (cy == null ? rect.height / 2 : cy - rect.top);
    var prev = state.cam.z;
    var next = clamp(prev * factor, 0.12, 2.5);
    if (next === prev) return;
    // 保持指针下的世界点不动
    state.cam.x = px - (px - state.cam.x) * (next / prev);
    state.cam.y = py - (py - state.cam.y) * (next / prev);
    state.cam.z = next;
    applyCam();
    renderEdges();
    save();
  }

  function fitToContent() {
    var ids = state.order;
    var rect = els.viewport.getBoundingClientRect();
    if (!ids.length) {
      state.cam = { x: rect.width / 2, y: rect.height / 2, z: 1 };
      applyCam(); renderEdges(); save();
      return;
    }
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    ids.forEach(function (id) {
      var n = state.nodes[id];
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.w); maxY = Math.max(maxY, n.y + nodeHeight(n));
    });
    var w = Math.max(80, maxX - minX), h = Math.max(80, maxY - minY);
    var z = clamp(Math.min((rect.width - 120) / w, (rect.height - 120) / h), 0.12, 1.5);
    state.cam.z = z;
    state.cam.x = rect.width / 2 - (minX + w / 2) * z;
    state.cam.y = rect.height / 2 - (minY + h / 2) * z;
    applyCam(); renderEdges(); save();
  }

  /* 屏幕坐标 → 世界坐标 */
  function toWorld(clientX, clientY) {
    var rect = els.viewport.getBoundingClientRect();
    return {
      x: (clientX - rect.left - state.cam.x) / state.cam.z,
      y: (clientY - rect.top - state.cam.y) / state.cam.z
    };
  }

  /* ---------------- 节点模型 ---------------- */
  function nodeHeight(n) {
    var el = els.world && els.world.querySelector('[data-node="' + n.id + '"]');
    return el ? el.offsetHeight / state.cam.z : 150;
  }

  function addNode(type, x, y, data) {
    var def = NODE_DEFS[type];
    if (!def) return null;
    var id = uid();
    var node = {
      id: id, type: type,
      x: x, y: y, w: def.w,
      data: data || {}
    };
    state.nodes[id] = node;
    state.order.push(id);
    mountNode(node);
    renderEdges();
    save();
    return node;
  }

  function removeNode(id) {
    var node = state.nodes[id];
    if (!node) return;
    state.edges = state.edges.filter(function (e) { return e.from !== id && e.to !== id; });
    delete state.nodes[id];
    state.order = state.order.filter(function (x) { return x !== id; });
    delete state.selection.nodes[id];
    var el = els.world && els.world.querySelector('[data-node="' + id + '"]');
    if (el) el.remove();
    renderEdges();
    save();
  }

  function bringToFront(id) {
    state.order = state.order.filter(function (x) { return x !== id; });
    state.order.push(id);
    var el = els.world && els.world.querySelector('[data-node="' + id + '"]');
    if (el) els.world.appendChild(el);
  }

  /* 收集某输入端口的来源值 */
  function inputsOf(nodeId, portId) {
    var out = [];
    state.edges.forEach(function (e) {
      if (e.to === nodeId && e.toPort === portId) {
        var src = state.nodes[e.from];
        if (src) out.push({ node: src, kind: e.kind });
      }
    });
    return out;
  }

  function collectPrompt(node) {
    var parts = [];
    // 生成节点自身也可带补充提示词
    inputsOf(node.id, 'prompt').concat(inputsOf(node.id, 'text')).forEach(function (it) {
      var t = it.node.type === 'text' ? (it.node.data.text || '') : '';
      t = String(t).trim();
      if (t) parts.push(t);
    });
    var own = String(node.data.text || '').trim();
    if (own) parts.push(own);
    return parts.join('\n');
  }

  function collectRefs(node) {
    var urls = [];
    inputsOf(node.id, 'ref').forEach(function (it) {
      var d = it.node.data;
      if (d && d.url) urls.push(d.url);
    });
    return urls;
  }

  /* ---------------- 节点 DOM ---------------- */
  function portHtml(node, port, dir) {
    return '<div class="hm-nc-port-row ' + dir + '" data-port="' + port.id + '" data-dir="' + dir + '">' +
      (dir === 'in' ? '<span class="hm-nc-port in kind-' + port.kind + '" data-node="' + node.id + '" data-port="' + port.id + '" data-kind="' + port.kind + '" title="' + esc(port.label) + '"></span><span class="hm-nc-port-label">' + esc(port.label) + '</span>'
                    : '<span class="hm-nc-port-label">' + esc(port.label) + '</span><span class="hm-nc-port out kind-' + port.kind + '" data-node="' + node.id + '" data-port="' + port.id + '" data-kind="' + port.kind + '" title="' + esc(port.label) + '"></span>') +
      '</div>';
  }

  function nodeBodyHtml(node) {
    var d = node.data || {};
    if (node.type === 'text') {
      return '<textarea class="hm-nc-text" placeholder="输入提示词 / 描述…" rows="4">' + esc(d.text || '') + '</textarea>';
    }
    if (node.type === 'image') {
      if (d.url) {
        return '<div class="hm-nc-media"><img src="' + esc(d.url) + '" alt="" draggable="false">' +
          '<div class="hm-nc-media-ops"><button type="button" data-act="view">查看</button><button type="button" data-act="replace">替换</button><button type="button" data-act="download">下载</button></div></div>';
      }
      return '<button type="button" class="hm-nc-upload" data-act="upload">＋ 上传图片<small>或 Ctrl+V 粘贴 / 拖入</small></button>';
    }
    if (node.type === 'genImage' || node.type === 'genVideo' || node.type === 'genAudio') {
      var busy = node.status === 'running';
      var html = '';
      html += '<textarea class="hm-nc-text hm-nc-extra" placeholder="补充提示词（可选，会与连线文本合并）" rows="2">' + esc(d.text || '') + '</textarea>';
      if (node.type === 'genImage') {
        html += '<div class="hm-nc-row"><label>比例</label><select class="hm-nc-ratio">' +
          [['1:1', '1:1'], ['16:9', '16:9'], ['9:16', '9:16'], ['4:3', '4:3'], ['3:4', '3:4']].map(function (r) {
            return '<option value="' + r[0] + '"' + ((d.ratio || '1:1') === r[0] ? ' selected' : '') + '>' + r[1] + '</option>';
          }).join('') + '</select></div>';
      }
      if (node.type === 'genVideo') {
        html += '<div class="hm-nc-row"><label>时长</label><select class="hm-nc-duration">' +
          [4, 5, 8, 10, 15].map(function (s) {
            return '<option value="' + s + '"' + ((d.duration || 5) === s ? ' selected' : '') + '>' + s + ' 秒</option>';
          }).join('') + '</select></div>';
      }
      html += '<button type="button" class="hm-nc-run' + (busy ? ' is-busy' : '') + '" data-act="run"' + (busy ? ' disabled' : '') + '>' +
        (busy ? '生成中…' : '▶ 生成') + '</button>';
      if (node.status === 'running') html += '<div class="hm-nc-status">' + esc(node.statusText || '排队生成中…') + '</div>';
      if (node.error) html += '<div class="hm-nc-error">' + esc(node.error) + '</div>';
      if (d.url && node.type === 'genImage') {
        html += '<div class="hm-nc-media"><img src="' + esc(d.url) + '" alt="" draggable="false">' +
          '<div class="hm-nc-media-ops"><button type="button" data-act="view">查看</button><button type="button" data-act="download">下载</button></div></div>';
      }
      if (d.url && node.type === 'genVideo') {
        html += '<div class="hm-nc-media"><video src="' + esc(d.url) + '" controls playsinline preload="metadata"></video>' +
          '<div class="hm-nc-media-ops"><button type="button" data-act="view">查看</button><button type="button" data-act="download">下载</button></div></div>';
      }
      if (d.url && node.type === 'genAudio') {
        html += '<div class="hm-nc-media hm-nc-audio"><audio src="' + esc(d.url) + '" controls preload="metadata"></audio></div>';
      }
      return html;
    }
    return '';
  }

  function mountNode(node) {
    var def = NODE_DEFS[node.type];
    var el = document.createElement('div');
    el.className = 'hm-nc-node hm-nc-' + node.type;
    el.setAttribute('data-node', node.id);
    el.style.left = node.x + 'px';
    el.style.top = node.y + 'px';
    el.style.width = node.w + 'px';

    var headHtml = '<div class="hm-nc-head">' +
      '<span class="hm-nc-icon">' + def.icon + '</span>' +
      '<span class="hm-nc-title">' + def.name + '</span>' +
      '<button type="button" class="hm-nc-del" data-act="del" title="删除节点">×</button>' +
      '</div>';

    var portsHtml = '<div class="hm-nc-ports">' +
      '<div class="hm-nc-ins">' + def.ins.map(function (p) { return portHtml(node, p, 'in'); }).join('') + '</div>' +
      '<div class="hm-nc-outs">' + def.outs.map(function (p) { return portHtml(node, p, 'out'); }).join('') + '</div>' +
      '</div>';

    el.innerHTML = headHtml + portsHtml + '<div class="hm-nc-body">' + nodeBodyHtml(node) + '</div>';
    if (state.selection.nodes[node.id]) el.classList.add('is-selected');
    if (node.status === 'running') el.classList.add('is-running');
    els.world.appendChild(el);
  }

  /* 重新渲染单个节点（数据/状态变化后） */
  function refreshNode(node) {
    var el = els.world && els.world.querySelector('[data-node="' + node.id + '"]');
    if (!el) return;
    el.querySelector('.hm-nc-body').innerHTML = nodeBodyHtml(node);
    el.classList.toggle('is-running', node.status === 'running');
    renderEdges();
  }

  /* ---------------- 连线 ---------------- */
  function portWorldPos(nodeId, portId, dir) {
    var port = els.viewport.querySelector(
      '.hm-nc-port.' + (dir === 'in' ? 'in' : 'out') + '[data-node="' + nodeId + '"][data-port="' + portId + '"]'
    );
    if (!port) return null;
    var rect = port.getBoundingClientRect();
    var vp = els.viewport.getBoundingClientRect();
    return {
      x: (rect.left + rect.width / 2 - vp.left - state.cam.x) / state.cam.z,
      y: (rect.top + rect.height / 2 - vp.top - state.cam.y) / state.cam.z
    };
  }

  function edgePath(p1, p2) {
    var dx = Math.max(40, Math.abs(p2.x - p1.x) * 0.5);
    return 'M' + p1.x + ',' + p1.y +
      ' C' + (p1.x + dx) + ',' + p1.y + ' ' + (p2.x - dx) + ',' + p2.y + ' ' + p2.x + ',' + p2.y;
  }

  function renderEdges() {
    if (!els.svgG) return;
    var html = '';
    state.edges.forEach(function (e) {
      var p1 = portWorldPos(e.from, e.fromPort, 'out');
      var p2 = portWorldPos(e.to, e.toPort, 'in');
      if (!p1 || !p2) return;
      var sel = state.selection.edgeId === e.id;
      html += '<path class="hm-nc-edge' + (sel ? ' is-selected' : '') + ' kind-' + e.kind + '" data-edge="' + e.id + '" d="' + edgePath(p1, p2) + '"/>';
    });
    if (state.linking) {
      var a = portWorldPos(state.linking.from, state.linking.fromPort, 'out');
      if (a) {
        html += '<path class="hm-nc-edge hm-nc-edge-draft" d="' + edgePath(a, { x: state.linking.x, y: state.linking.y }) + '"/>';
      }
    }
    els.svgG.innerHTML = html;
  }

  function kindsCompatible(outKind, inKind) {
    var list = KIND_MATCH[outKind] || [outKind];
    return list.indexOf(inKind) >= 0;
  }

  function tryConnect(fromId, fromPort, kind, target) {
    var inPort = target && target.closest ? target.closest('.hm-nc-port.in') : null;
    if (!inPort) return false;
    var toId = inPort.getAttribute('data-node');
    var toPort = inPort.getAttribute('data-port');
    var inKind = inPort.getAttribute('data-kind');
    if (!toId || toId === fromId) { toast('不能连接到自身', 'info'); return false; }
    if (!kindsCompatible(kind, inKind)) {
      toast('端口类型不匹配：' + kind + ' → ' + inKind, 'info');
      return false;
    }
    // 一个输入端口只保留一条连线
    state.edges = state.edges.filter(function (e) {
      return !(e.to === toId && e.toPort === toPort);
    });
    state.edges.push({
      id: uid(), from: fromId, fromPort: fromPort,
      to: toId, toPort: toPort, kind: kind
    });
    renderEdges();
    save();
    return true;
  }

  function removeEdge(id) {
    state.edges = state.edges.filter(function (e) { return e.id !== id; });
    if (state.selection.edgeId === id) state.selection.edgeId = null;
    renderEdges();
    save();
  }

  /* ---------------- 生成 ---------------- */
  function setRunning(node, running, text) {
    node.status = running ? 'running' : '';
    node.statusText = text || '';
    if (!running) node.error = '';
    refreshNode(node);
  }

  function ensureOnline() {
    var a = api();
    if (!a || !a.online) {
      toast('后端离线，无法生成。请先登录并确认后端在线。', 'error');
      return false;
    }
    return true;
  }

  function runNode(node) {
    if (node.status === 'running') return;
    var prompt = collectPrompt(node);
    if ((node.type === 'genImage' || node.type === 'genVideo') && !prompt) {
      toast('请先连接文本节点或填写提示词', 'info');
      return;
    }
    if (node.type === 'genAudio' && !prompt) {
      toast('请先连接文本节点', 'info');
      return;
    }
    if (!ensureOnline()) return;

    var refs = collectRefs(node);
    var appState = app().state || {};
    var payload;
    var timeoutMs = 180000;

    if (node.type === 'genImage') {
      payload = {
        mode: 'image',
        engine: appState.engine || 'banana',
        prompt: prompt,
        ratio: node.data.ratio || '1:1',
        scale: '1k',
        count: 1,
        steps: 8,
        seed: Math.floor(Math.random() * 1e9),
        refImages: refs,
        rayin: appState.api,
        style: appState.lora || ''
      };
      if (appState.channelModel) payload.model = appState.channelModel;
    } else if (node.type === 'genVideo') {
      timeoutMs = 300000;
      payload = {
        mode: 'video',
        model: node.data.model || 'vidu-q4',
        prompt: prompt,
        ratio: '16:9',
        resolution: '720p',
        duration: node.data.duration || 5,
        seed: Math.floor(Math.random() * 1e9),
        rayin: appState.api
      };
    } else {
      timeoutMs = 90000;
      payload = {
        mode: 'audio',
        model: 'edgetts',
        text: prompt,
        voice: node.data.voice || '',
        format: 'mp3',
        sampleRate: 24000,
        rayin: appState.api
      };
    }

    setRunning(node, true, node.type === 'genVideo' ? '视频生成中，请稍候…' : '生成中…');

    api().generate(payload, timeoutMs).then(function (data) {
      var item = data && data.items && data.items[0];
      if (!item || !item.url) throw new Error('后端未返回媒体地址');
      var url = api().mediaUrl ? api().mediaUrl(item.url) : item.url;
      node.data.url = url;
      node.status = '';
      node.statusText = '';
      node.error = '';
      refreshNode(node);
      save();
      registerWork(node, url, prompt);
      toast(node.type === 'genVideo' ? '视频生成完成' : node.type === 'genAudio' ? '音频生成完成' : '图片生成完成', 'success');
    }).catch(function (err) {
      node.status = '';
      node.error = (err && err.message) || '生成失败';
      refreshNode(node);
      toast('生成失败：' + node.error, 'error');
    });
  }

  /* 生成结果同步到桌面作品墙（与主流程一致） */
  function registerWork(node, url, prompt) {
    try {
      var A = app();
      if (!A.state || !A.saveWorks || !A.renderWorks) return;
      var work = {
        id: 'cv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        type: node.type === 'genVideo' ? 'video' : node.type === 'genAudio' ? 'audio' : 'image',
        url: url,
        thumb: url,
        prompt: prompt || '',
        modelName: '画布节点',
        createdAt: Date.now()
      };
      A.state.works.unshift(work);
      A.saveWorks();
      A.renderWorks();
      if (window.HMDesk && window.HMDesk.onWorkCreated) {
        try { window.HMDesk.onWorkCreated(work); } catch (e) {}
      }
    } catch (e) { /* 不影响画布本体 */ }
  }

  /* ---------------- 交互：平移 / 拖动 / 连线 ---------------- */
  function onPointerDown(e) {
    if (!els.viewport) return;

    // 端口连线（优先）
    var outPort = e.target.closest && e.target.closest('.hm-nc-port.out');
    if (outPort && e.button === 0) {
      var p = toWorld(e.clientX, e.clientY);
      state.linking = {
        from: outPort.getAttribute('data-node'),
        fromPort: outPort.getAttribute('data-port'),
        kind: outPort.getAttribute('data-kind'),
        x: p.x, y: p.y
      };
      e.preventDefault();
      e.stopPropagation();
      renderEdges();
      return;
    }

    // 连线选中
    var edgePathEl = e.target.closest && e.target.closest('.hm-nc-edge');
    if (edgePathEl && e.button === 0) {
      state.selection.edgeId = edgePathEl.getAttribute('data-edge');
      renderEdges();
      return;
    }

    // 节点拖动（标题栏或节点空白区域）
    var nodeEl = e.target.closest && e.target.closest('.hm-nc-node');
    if (nodeEl && e.button === 0) {
      var id = nodeEl.getAttribute('data-node');
      var interactive = e.target.closest('textarea, input, select, button, video, audio, .hm-nc-port');
      if (interactive) return; // 表单元素自己处理
      selectNode(id, e.shiftKey);
      bringToFront(id);
      var ids = Object.keys(state.selection.nodes);
      if (ids.indexOf(id) < 0) ids = [id];
      var items = ids.map(function (nid) {
        var n = state.nodes[nid];
        var w = toWorld(e.clientX, e.clientY);
        return { id: nid, dx: n.x - w.x, dy: n.y - w.y };
      });
      state.nodeDrag = { items: items, moved: false };
      e.preventDefault();
      return;
    }

    // 空白平移（左键 / 中键 / 空格 + 左键）
    if (e.button === 1 || e.button === 0) {
      state.panning = {
        startX: e.clientX, startY: e.clientY,
        camX: state.cam.x, camY: state.cam.y,
        moved: false
      };
      clearSelection();
      e.preventDefault();
    }
  }

  function onPointerMove(e) {
    if (state.linking) {
      var p = toWorld(e.clientX, e.clientY);
      state.linking.x = p.x;
      state.linking.y = p.y;
      // 高亮可接入端口
      var hit = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(e.clientX, e.clientY) : null;
      var inPort = hit && hit.closest ? hit.closest('.hm-nc-port.in') : null;
      els.viewport.querySelectorAll('.hm-nc-port.in.is-hot').forEach(function (el) { el.classList.remove('is-hot'); });
      if (inPort && kindsCompatible(state.linking.kind, inPort.getAttribute('data-kind'))) {
        inPort.classList.add('is-hot');
      }
      renderEdges();
      return;
    }
    if (state.nodeDrag) {
      var w = toWorld(e.clientX, e.clientY);
      state.nodeDrag.moved = true;
      state.nodeDrag.items.forEach(function (it) {
        var n = state.nodes[it.id];
        if (!n) return;
        n.x = Math.round(w.x + it.dx);
        n.y = Math.round(w.y + it.dy);
        var el = els.world.querySelector('[data-node="' + n.id + '"]');
        if (el) { el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; }
      });
      renderEdges();
      return;
    }
    if (state.panning) {
      var dx = e.clientX - state.panning.startX;
      var dy = e.clientY - state.panning.startY;
      if (Math.abs(dx) + Math.abs(dy) > 2) state.panning.moved = true;
      state.cam.x = state.panning.camX + dx;
      state.cam.y = state.panning.camY + dy;
      applyCam();
      return;
    }
  }

  function onPointerUp(e) {
    if (state.linking) {
      var lk = state.linking;
      state.linking = null;
      els.viewport.querySelectorAll('.hm-nc-port.in.is-hot').forEach(function (el) { el.classList.remove('is-hot'); });
      var hit = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(e.clientX, e.clientY) : null;
      if (hit) tryConnect(lk.from, lk.fromPort, lk.kind, hit);
      renderEdges();
      return;
    }
    if (state.nodeDrag) {
      if (state.nodeDrag.moved) save();
      state.nodeDrag = null;
      return;
    }
    if (state.panning) {
      if (state.panning.moved) save();
      state.panning = null;
    }
  }

  function onWheel(e) {
    e.preventDefault();
    var factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    zoomAt(factor, e.clientX, e.clientY);
  }

  /* ---------------- 选择 ---------------- */
  function selectNode(id, additive) {
    if (!additive) {
      state.selection.nodes = {};
      state.selection.edgeId = null;
    }
    if (state.nodes[id]) state.selection.nodes[id] = true;
    syncSelectionUI();
  }

  function clearSelection() {
    state.selection.nodes = {};
    state.selection.edgeId = null;
    syncSelectionUI();
    renderEdges();
  }

  function syncSelectionUI() {
    if (!els.world) return;
    els.world.querySelectorAll('.hm-nc-node.is-selected').forEach(function (el) { el.classList.remove('is-selected'); });
    Object.keys(state.selection.nodes).forEach(function (id) {
      var el = els.world.querySelector('[data-node="' + id + '"]');
      if (el) el.classList.add('is-selected');
    });
  }

  function deleteSelection() {
    if (state.selection.edgeId) {
      removeEdge(state.selection.edgeId);
      return;
    }
    var ids = Object.keys(state.selection.nodes);
    if (!ids.length) return;
    ids.forEach(removeNode);
    toast('已删除 ' + ids.length + ' 个节点', 'info');
  }

  /* ---------------- 右键菜单 ---------------- */
  var MENU_ITEMS = [
    { id: 'paste', label: '粘贴', hint: 'Ctrl+V' },
    { id: 'upload', label: '本地上传', hint: '' },
    { id: 'sep1', sep: true },
    { id: 'text', label: '文本', hint: 'T' },
    { id: 'image', label: '图片', hint: '' },
    { id: 'sep2', sep: true },
    { id: 'genImage', label: '生成图片', hint: 'A' },
    { id: 'genVideo', label: '生成视频', hint: 'V' },
    { id: 'genAudio', label: '生成音频', hint: 'S' },
    { id: 'sep3', sep: true },
    { id: 'fit', label: '适应全部节点', hint: 'F' },
    { id: 'tidy', label: '整理布局', hint: '' },
    { id: 'clear', label: '清空画布', hint: '', danger: true }
  ];
  var menuWorldPos = { x: 0, y: 0 };

  function showMenu(x, y) {
    if (!els.menu) return;
    menuWorldPos = toWorld(x, y);
    els.menu.innerHTML = MENU_ITEMS.map(function (it) {
      if (it.sep) return '<div class="hm-nc-sep"></div>';
      return '<button type="button" class="hm-nc-menu-item' + (it.danger ? ' is-danger' : '') + '" data-menu="' + it.id + '">' +
        '<span>' + esc(it.label) + '</span>' + (it.hint ? '<kbd>' + esc(it.hint) + '</kbd>' : '') + '</button>';
    }).join('');
    els.menu.hidden = false;
    var vp = els.viewport.getBoundingClientRect();
    var mw = 200, mh = MENU_ITEMS.length * 34;
    var left = clamp(x - vp.left, 8, Math.max(8, vp.width - mw - 8));
    var top = clamp(y - vp.top, 8, Math.max(8, vp.height - mh - 8));
    els.menu.style.left = left + 'px';
    els.menu.style.top = top + 'px';
  }

  function hideMenu() { if (els.menu) els.menu.hidden = true; }

  function onMenuClick(e) {
    var btn = e.target.closest('[data-menu]');
    if (!btn) return;
    var act = btn.getAttribute('data-menu');
    hideMenu();
    var p = menuWorldPos;
    if (act === 'paste') { doPaste(p); return; }
    if (act === 'upload') { pickImageFile(function (url) { addNode('image', p.x, p.y, { url: url }); }); return; }
    if (act === 'text') { addNode('text', p.x, p.y, { text: '' }); return; }
    if (act === 'image') { pickImageFile(function (url) { addNode('image', p.x, p.y, { url: url }); }); return; }
    if (act === 'genImage') { addNode('genImage', p.x, p.y, { text: '', ratio: '1:1' }); return; }
    if (act === 'genVideo') { addNode('genVideo', p.x, p.y, { text: '', duration: 5 }); return; }
    if (act === 'genAudio') { addNode('genAudio', p.x, p.y, {}); return; }
    if (act === 'fit') { fitToContent(); return; }
    if (act === 'tidy') { tidyLayout(); return; }
    if (act === 'clear') { clearCanvas(); return; }
  }

  function tidyLayout() {
    var cols = Math.max(1, Math.round(Math.sqrt(state.order.length)));
    var x0 = 0, y0 = 0, gapX = 340, gapY = 260;
    state.order.forEach(function (id, i) {
      var n = state.nodes[id];
      n.x = x0 + (i % cols) * gapX;
      n.y = y0 + Math.floor(i / cols) * gapY;
      var el = els.world.querySelector('[data-node="' + id + '"]');
      if (el) { el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; }
    });
    renderEdges();
    fitToContent();
  }

  function clearCanvas() {
    if (!state.order.length) return;
    if (!window.confirm('清空整个画布？节点与连线都会被删除。')) return;
    state.nodes = {};
    state.order = [];
    state.edges = [];
    state.selection.nodes = {};
    state.selection.edgeId = null;
    if (els.world) els.world.innerHTML = '';
    renderEdges();
    save();
    toast('画布已清空', 'info');
  }

  /* ---------------- 粘贴 / 上传 ---------------- */
  function pickImageFile(cb) {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = function () {
      var file = input.files && input.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () { cb(String(reader.result)); };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  function doPaste(worldPos) {
    if (!navigator.clipboard || !navigator.clipboard.read) {
      // 退回文本粘贴
      if (navigator.clipboard && navigator.clipboard.readText) {
        navigator.clipboard.readText().then(function (text) {
          if (text && text.trim()) addNode('text', worldPos.x, worldPos.y, { text: text.trim() });
          else toast('剪贴板没有可用内容', 'info');
        }).catch(function () { toast('无法读取剪贴板', 'info'); });
      } else {
        toast('浏览器不支持直接读取剪贴板，请用 Ctrl+V', 'info');
      }
      return;
    }
    navigator.clipboard.read().then(function (items) {
      for (var i = 0; i < items.length; i++) {
        var types = items[i].types || [];
        for (var j = 0; j < types.length; j++) {
          if (types[j].indexOf('image/') === 0) {
            items[i].getType(types[j]).then(function (blob) {
              var reader = new FileReader();
              reader.onload = function () { addNode('image', worldPos.x, worldPos.y, { url: String(reader.result) }); };
              reader.readAsDataURL(blob);
            });
            return;
          }
        }
      }
      if (navigator.clipboard.readText) {
        navigator.clipboard.readText().then(function (text) {
          if (text && text.trim()) addNode('text', worldPos.x, worldPos.y, { text: text.trim() });
          else toast('剪贴板没有可用内容', 'info');
        });
      }
    }).catch(function () { toast('无法读取剪贴板，请用 Ctrl+V', 'info'); });
  }

  function onPaste(e) {
    if (!isActive()) return;
    var tag = (e.target && e.target.tagName || '').toLowerCase();
    if (tag === 'textarea' || tag === 'input') return;
    var p = { x: state.cam.x ? (els.viewport.clientWidth / 2 - state.cam.x) / state.cam.z : 0, y: 0 };
    var center = toWorld(
      els.viewport.getBoundingClientRect().left + els.viewport.clientWidth / 2,
      els.viewport.getBoundingClientRect().top + els.viewport.clientHeight / 2
    );
    p = center;
    var items = (e.clipboardData && e.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].type && items[i].type.indexOf('image/') === 0) {
        var blob = items[i].getAsFile();
        if (blob) {
          var reader = new FileReader();
          reader.onload = function () { addNode('image', p.x, p.y, { url: String(reader.result) }); };
          reader.readAsDataURL(blob);
          e.preventDefault();
          return;
        }
      }
    }
    var text = e.clipboardData ? e.clipboardData.getData('text') : '';
    if (text && text.trim()) {
      addNode('text', p.x, p.y, { text: text.trim() });
      e.preventDefault();
    }
  }

  /* ---------------- 节点内按钮 / 输入 ---------------- */
  function onWorldClick(e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var nodeEl = e.target.closest('.hm-nc-node');
    if (!nodeEl) return;
    var node = state.nodes[nodeEl.getAttribute('data-node')];
    if (!node) return;
    var act = btn.getAttribute('data-act');

    if (act === 'del') { removeNode(node.id); return; }
    if (act === 'run') { runNode(node); return; }
    if (act === 'upload' || act === 'replace') {
      pickImageFile(function (url) {
        node.data.url = url;
        refreshNode(node);
        save();
      });
      return;
    }
    if (act === 'view') {
      if (node.data.url && app().openLightbox) {
        app().openLightbox({
          type: node.type === 'genVideo' ? 'video' : 'image',
          url: node.data.url,
          prompt: collectPrompt(node) || node.data.text || ''
        });
      }
      return;
    }
    if (act === 'download') {
      if (node.data.url && app().downloadImage) {
        app().downloadImage(node.data.url, 'huimeng-canvas-' + node.id);
      }
      return;
    }
  }

  function onWorldInput(e) {
    var nodeEl = e.target.closest('.hm-nc-node');
    if (!nodeEl) return;
    var node = state.nodes[nodeEl.getAttribute('data-node')];
    if (!node) return;
    if (e.target.classList.contains('hm-nc-text')) {
      node.data.text = e.target.value;
      save();
    } else if (e.target.classList.contains('hm-nc-ratio')) {
      node.data.ratio = e.target.value;
      save();
    } else if (e.target.classList.contains('hm-nc-duration')) {
      node.data.duration = Number(e.target.value) || 5;
      save();
    }
  }

  function onWorldDblClick(e) {
    // 双击连线删除
    var edge = e.target.closest && e.target.closest('.hm-nc-edge');
    if (edge) {
      removeEdge(edge.getAttribute('data-edge'));
      toast('已删除连线', 'info');
      return;
    }
    // 双击空白新建文本节点
    if (!e.target.closest('.hm-nc-node')) {
      var p = toWorld(e.clientX, e.clientY);
      addNode('text', p.x, p.y, { text: '' });
    }
  }

  function onKeyDown(e) {
    if (!isActive()) return;
    var tag = (e.target && e.target.tagName || '').toLowerCase();
    if (tag === 'textarea' || tag === 'input' || tag === 'select') return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      deleteSelection();
      e.preventDefault();
      return;
    }
    if (e.key === 'Escape') {
      if (els.menu && !els.menu.hidden) { hideMenu(); return; }
      clearSelection();
      return;
    }
    var k = e.key.toLowerCase();
    if (k === 'f') { fitToContent(); }
  }

  function onContextMenu(e) {
    if (!isActive()) return;
    if (e.target.closest('.hm-nc-node')) return; // 节点上保留浏览器默认
    e.preventDefault();
    showMenu(e.clientX, e.clientY);
  }

  /* ---------------- 拖放文件 ---------------- */
  function onDrop(e) {
    if (!isActive()) return;
    var files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) return;
    e.preventDefault();
    var p = toWorld(e.clientX, e.clientY);
    var added = 0;
    Array.prototype.forEach.call(files, function (file, i) {
      if (!/^image\//.test(file.type)) return;
      var reader = new FileReader();
      reader.onload = function () {
        addNode('image', p.x + i * 24, p.y + i * 24, { url: String(reader.result) });
      };
      reader.readAsDataURL(file);
      added++;
    });
    if (added) toast('已添加 ' + added + ' 张图片到画布', 'success');
  }

  function onDragOver(e) {
    if (!isActive()) return;
    if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.indexOf('Files') >= 0) {
      e.preventDefault();
    }
  }

  /* ---------------- 生命周期 ---------------- */
  function isActive() {
    return document.body.dataset.view === 'canvas';
  }

  function bind() {
    if (bound) return;
    bound = true;

    els.viewport.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    els.viewport.addEventListener('wheel', onWheel, { passive: false });
    els.viewport.addEventListener('contextmenu', onContextMenu);
    els.viewport.addEventListener('dblclick', onWorldDblClick);
    els.viewport.addEventListener('drop', onDrop);
    els.viewport.addEventListener('dragover', onDragOver);
    els.world.addEventListener('click', onWorldClick);
    els.world.addEventListener('input', onWorldInput);
    if (els.menu) els.menu.addEventListener('click', onMenuClick);
    document.addEventListener('click', function (e) {
      if (els.menu && !els.menu.hidden && !e.target.closest('#ncMenu')) hideMenu();
    });
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('paste', onPaste);
    if (els.svg) {
      // SVG 连线的点击需要转发到 viewport 的 pointerdown 逻辑
      els.svg.addEventListener('pointerdown', onPointerDown);
      els.svg.addEventListener('dblclick', onWorldDblClick);
    }

    // 工具栏
    bindTool('ncZoomOut', function () { zoomAt(1 / 1.2); });
    bindTool('ncZoomIn', function () { zoomAt(1.2); });
    bindTool('ncFit', fitToContent);
    bindTool('ncAddText', function () { addAtCenter('text', { text: '' }); });
    bindTool('ncAddImage', function () { pickImageFile(function (url) { addAtCenter('image', { url: url }); }); });
    bindTool('ncAddGenImage', function () { addAtCenter('genImage', { text: '', ratio: '1:1' }); });
    bindTool('ncAddGenVideo', function () { addAtCenter('genVideo', { text: '', duration: 5 }); });
    bindTool('ncAddGenAudio', function () { addAtCenter('genAudio', {}); });
    bindTool('ncTidy', tidyLayout);
    bindTool('ncClear', clearCanvas);

    window.addEventListener('resize', function () {
      if (isActive()) { applyCam(); renderEdges(); }
    });
  }

  function bindTool(id, fn) {
    var el = $(id);
    if (el) el.addEventListener('click', fn);
  }

  function addAtCenter(type, data) {
    var rect = els.viewport.getBoundingClientRect();
    var p = toWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
    addNode(type, Math.round(p.x - 120), Math.round(p.y - 70), data);
  }

  function seedDemo() {
    // 首次进入：给一组连好的示例，帮助理解连线玩法
    var cx = 0, cy = 0;
    var t = addNode('text', cx - 360, cy - 40, { text: '蓝发女仆，坐在窗边喝下午茶，柔和阳光，赛璐璐风格' });
    var g = addNode('genImage', cx + 40, cy - 80, { text: '', ratio: '1:1' });
    state.edges.push({
      id: uid(), from: t.id, fromPort: 'prompt',
      to: g.id, toPort: 'prompt', kind: 'text'
    });
    renderEdges();
    save();
  }

  function enter() {
    els.viewport = $('ncViewport');
    els.grid = $('ncGrid');
    els.world = $('ncWorld');
    els.svg = $('ncSvg');
    els.svgG = $('ncSvgG');
    els.menu = $('ncMenu');
    els.zoomLabel = $('ncZoomLabel');
    if (!els.viewport) return;

    bind();

    var restored = load();
    if (restored && state.order.length) {
      // 重新挂载持久化节点
      els.world.innerHTML = '';
      state.order.forEach(function (id) { mountNode(state.nodes[id]); });
    } else if (!state.order.length && !restored) {
      seedDemo();
    } else {
      els.world.innerHTML = '';
      state.order.forEach(function (id) { mountNode(state.nodes[id]); });
    }

    if (!restored && state.order.length) {
      // 首次：把示例放到视口中心
      var rect = els.viewport.getBoundingClientRect();
      state.cam.x = rect.width / 2;
      state.cam.y = rect.height / 2;
      state.cam.z = 1;
    }

    applyCam();
    // 等字体/图片渲染后再量端口位置
    requestAnimationFrame(function () { renderEdges(); });
  }

  function leave() {
    save();
    hideMenu();
  }

  window.HMCanvas = {
    enter: enter,
    leave: leave,
    refresh: function () { renderEdges(); }
  };
})();
