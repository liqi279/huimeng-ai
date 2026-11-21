/* ============================================================
 * 模型训练 HMTOOLTRAINING
 * 在【工具】模块下提供「模型训练」卡片：Checkpoint 训练 + LoRA 训练
 * 参数规范参考 AUTOMATIC1111 web-ui Train 标签页与 sd-scripts 训练器
 * 纯前端：配置参数 → 预览/导出 JSON 配置 / 命令行 → 模拟训练进度
 * 无后端 GPU，仅用于生成可落地到本地 web-ui 的训练配置
 * ============================================================ */
window.HMToolTraining = (function () {
  'use strict';

  var LS_PREFIX = 'anidream.train.';

  /* ---------- 字段 Schema ---------- */
  // type: text | number | select | checkbox
  var FIELDS = {
    checkpoint: [
      { sec: '基础设置', items: [
        { key: 'pretrained_model', label: '基础模型 (pretrained_model_name_or_path)', type: 'select', default: 'sd-v1-5', options: [
          { v: 'sd-v1-5', t: 'Stable Diffusion v1.5' },
          { v: 'sd-v2-1', t: 'Stable Diffusion v2.1' },
          { v: 'sdxl-base-1.0', t: 'SDXL Base 1.0' },
          { v: 'anything-v5', t: 'Anything V5 (动漫)' },
          { v: 'counterfeit-v3', t: 'Counterfeit V3 (动漫)' },
          { v: 'custom', t: '自定义路径…' }
        ]},
        { key: 'custom_model_path', label: '自定义模型路径', type: 'text', default: '', hint: '基础模型选「自定义」时填写本地 ckpt/safetensors 路径' },
        { key: 'train_data_dir', label: '训练图片目录 (train_data_dir)', type: 'text', default: './train/imgs', hint: 'web-ui 本机绝对路径，如 D:\\datasets\\mychar' },
        { key: 'output_dir', label: '输出目录 (output_dir)', type: 'text', default: './train/output' },
        { key: 'output_name', label: '输出模型名 (output_name)', type: 'text', default: 'my_model' }
      ]},
      { sec: '数据集 (Dataset)', items: [
        { key: 'instance_prompt', label: '实例提示词 (instance_prompt)', type: 'text', default: 'a photo of sks dog', hint: '触发词，描述训练主体' },
        { key: 'class_prompt', label: '类别提示词 (class_prompt)', type: 'text', default: 'a photo of dog', hint: '用于正则化的通用类别描述' },
        { key: 'num_class_images', label: '类别图片数量 (num_class_images)', type: 'number', default: 100, min: 0, step: 1 },
        { key: 'resolution', label: '分辨率 (resolution)', type: 'number', default: 512, min: 64, step: 64 },
        { key: 'center_crop', label: '中心裁剪 (center_crop)', type: 'checkbox', default: false },
        { key: 'shuffle', label: '随机打乱 (shuffle)', type: 'checkbox', default: true }
      ]},
      { sec: '训练参数 (Training)', items: [
        { key: 'learning_rate', label: '学习率 (learning_rate)', type: 'number', default: 0.000002, step: 0.0000001, min: 0, hint: 'DreamBooth 常用 1e-6 ~ 5e-6' },
        { key: 'train_batch_size', label: 'Train batch size', type: 'number', default: 1, min: 1, step: 1 },
        { key: 'gradient_accumulation_steps', label: '梯度累积步数 (gradient_accumulation_steps)', type: 'number', default: 1, min: 1, step: 1 },
        { key: 'num_train_epochs', label: '训练轮数 (num_train_epochs)', type: 'number', default: 1, min: 1, step: 1 },
        { key: 'max_train_steps', label: '最大训练步数 (max_train_steps)', type: 'number', default: 0, min: 0, step: 1, hint: '0 表示由 epoch 决定' },
        { key: 'save_steps', label: '保存周期 (save_steps)', type: 'number', default: 500, min: 0, step: 50 },
        { key: 'lr_scheduler', label: '学习率调度器 (lr_scheduler)', type: 'select', default: 'constant', options: [
          { v: 'constant', t: 'constant' },
          { v: 'constant_with_warmup', t: 'constant_with_warmup' },
          { v: 'cosine', t: 'cosine' },
          { v: 'cosine_with_restarts', t: 'cosine_with_restarts' },
          { v: 'linear', t: 'linear' },
          { v: 'polynomial', t: 'polynomial' }
        ]},
        { key: 'lr_warmup_steps', label: '预热步数 (lr_warmup_steps)', type: 'number', default: 0, min: 0, step: 1 },
        { key: 'optimizer', label: '优化器 (optimizer)', type: 'select', default: 'AdamW', options: [
          { v: 'AdamW', t: 'AdamW' },
          { v: 'AdamW8bit', t: 'AdamW8bit (8-bit)' },
          { v: 'Lion', t: 'Lion' }
        ]},
        { key: 'mixed_precision', label: '混合精度 (mixed_precision)', type: 'select', default: 'fp16', options: [
          { v: 'no', t: 'no (fp32)' },
          { v: 'fp16', t: 'fp16' },
          { v: 'bf16', t: 'bf16' }
        ]},
        { key: 'seed', label: '随机种子 (seed)', type: 'number', default: 42, min: 0, step: 1 }
      ]},
      { sec: '高级 (Advanced)', items: [
        { key: 'gradient_checkpointing', label: '梯度检查点 (gradient_checkpointing)', type: 'checkbox', default: true, hint: '节省显存，训练略慢' },
        { key: 'use_8bit_adam', label: '8bit Adam (use_8bit_adam)', type: 'checkbox', default: false, hint: '需安装 bitsandbytes' },
        { key: 'enable_xformers', label: 'Xformers 内存优化 (enable_xformers_memory_efficient_attention)', type: 'checkbox', default: true },
        { key: 'cache_latents', label: '缓存潜变量 (cache_latents)', type: 'checkbox', default: true },
        { key: 'prior_loss_weight', label: '先验损失权重 (prior_loss_weight)', type: 'number', default: 1.0, min: 0, step: 0.1 }
      ]}
    ],

    lora: [
      { sec: '基础设置', items: [
        { key: 'pretrained_model', label: '基础模型 (pretrained_model_name_or_path)', type: 'select', default: 'sd-v1-5', options: [
          { v: 'sd-v1-5', t: 'Stable Diffusion v1.5' },
          { v: 'sd-v2-1', t: 'Stable Diffusion v2.1' },
          { v: 'sdxl-base-1.0', t: 'SDXL Base 1.0' },
          { v: 'anything-v5', t: 'Anything V5 (动漫)' },
          { v: 'counterfeit-v3', t: 'Counterfeit V3 (动漫)' },
          { v: 'custom', t: '自定义路径…' }
        ]},
        { key: 'custom_model_path', label: '自定义模型路径', type: 'text', default: '', hint: '基础模型选「自定义」时填写本地 ckpt/safetensors 路径' },
        { key: 'train_data_dir', label: '训练图片目录 (train_data_dir)', type: 'text', default: './train/imgs', hint: 'web-ui 本机绝对路径' },
        { key: 'output_dir', label: '输出目录 (output_dir)', type: 'text', default: './train/output' },
        { key: 'output_name', label: '输出 LoRA 名 (output_name)', type: 'text', default: 'my_lora' }
      ]},
      { sec: 'LoRA 网络 (Network)', items: [
        { key: 'network_module', label: '网络类型 (network_module)', type: 'select', default: 'networks.lora', options: [
          { v: 'networks.lora', t: 'Standard LoRA (networks.lora)' },
          { v: 'networks.lora_con', t: 'LoCon (networks.lora_con)' },
          { v: 'networks.dylora', t: 'DyLoRA (networks.dylora)' }
        ]},
        { key: 'network_dim', label: '网络维度 / 秩 (network_dim)', type: 'number', default: 16, min: 1, step: 1, hint: '常用 8~64，越大拟合越强' },
        { key: 'network_alpha', label: '网络 Alpha (network_alpha)', type: 'number', default: 16, min: 1, step: 1, hint: '一般设为与 dim 相同' },
        { key: 'network_dropout', label: '网络 Dropout (network_dropout)', type: 'number', default: 0, min: 0, max: 1, step: 0.05 }
      ]},
      { sec: '训练参数 (Training)', items: [
        { key: 'unet_lr', label: 'UNet 学习率 (unet_lr)', type: 'number', default: 0.0001, step: 0.00001, min: 0, hint: '常用 1e-4 ~ 2e-4' },
        { key: 'text_encoder_lr', label: '文本编码器学习率 (text_encoder_lr)', type: 'number', default: 0.00005, step: 0.00001, min: 0, hint: '常用 5e-5 ~ 1e-4' },
        { key: 'lr_scheduler', label: '学习率调度器 (lr_scheduler)', type: 'select', default: 'cosine', options: [
          { v: 'constant', t: 'constant' },
          { v: 'constant_with_warmup', t: 'constant_with_warmup' },
          { v: 'cosine', t: 'cosine' },
          { v: 'cosine_with_restarts', t: 'cosine_with_restarts' },
          { v: 'linear', t: 'linear' },
          { v: 'polynomial', t: 'polynomial' }
        ]},
        { key: 'lr_warmup_steps', label: '预热步数 (lr_warmup_steps)', type: 'number', default: 0, min: 0, step: 1 },
        { key: 'train_batch_size', label: 'Batch size (train_batch_size)', type: 'number', default: 1, min: 1, step: 1 },
        { key: 'gradient_accumulation_steps', label: '梯度累积步数', type: 'number', default: 1, min: 1, step: 1 },
        { key: 'epoch', label: '训练轮数 (epoch)', type: 'number', default: 10, min: 1, step: 1 },
        { key: 'save_every_n_epochs', label: '保存周期 (save_every_n_epochs)', type: 'number', default: 1, min: 1, step: 1 },
        { key: 'max_train_steps', label: '最大训练步数 (max_train_steps)', type: 'number', default: 0, min: 0, step: 1, hint: '0 表示由 epoch 决定' },
        { key: 'resolution', label: '分辨率 (resolution)', type: 'number', default: 512, min: 64, step: 64 },
        { key: 'clip_skip', label: 'Clip skip (clip_skip)', type: 'number', default: 2, min: 1, step: 1 },
        { key: 'optimizer_type', label: '优化器 (optimizer_type)', type: 'select', default: 'AdamW', options: [
          { v: 'AdamW', t: 'AdamW' },
          { v: 'AdamW8bit', t: 'AdamW8bit (8-bit)' },
          { v: 'Lion', t: 'Lion' },
          { v: 'AdaFactor', t: 'AdaFactor' }
        ]},
        { key: 'mixed_precision', label: '混合精度 (mixed_precision)', type: 'select', default: 'fp16', options: [
          { v: 'no', t: 'no (fp32)' },
          { v: 'fp16', t: 'fp16' },
          { v: 'bf16', t: 'bf16' }
        ]},
        { key: 'seed', label: '随机种子 (seed)', type: 'number', default: 42, min: 0, step: 1 }
      ]},
      { sec: '高级 (Advanced)', items: [
        { key: 'cache_latents', label: '缓存潜变量 (cache_latents)', type: 'checkbox', default: true },
        { key: 'cache_latents_to_disk', label: '缓存到磁盘 (cache_latents_to_disk)', type: 'checkbox', default: true },
        { key: 'enable_bucket', label: '启用 Buckets (enable_bucket)', type: 'checkbox', default: true, hint: '支持不同宽高比图片' },
        { key: 'min_bucket_reso', label: 'Min bucket reso', type: 'number', default: 256, min: 64, step: 64 },
        { key: 'max_bucket_reso', label: 'Max bucket reso', type: 'number', default: 1024, min: 64, step: 64 },
        { key: 'noise_offset', label: '噪声偏移 (noise_offset)', type: 'number', default: 0, min: 0, step: 0.01, hint: '改善明暗对比，常用 0.1' },
        { key: 'adaptive_noise_scale', label: '自适应噪声 (adaptive_noise_scale)', type: 'number', default: 0, min: 0, step: 0.01 },
        { key: 'min_snr_gamma', label: 'Min SNR gamma (min_snr_gamma)', type: 'number', default: 0, min: 0, step: 0.5, hint: '5 可提升训练质量' },
        { key: 'gradient_checkpointing', label: '梯度检查点 (gradient_checkpointing)', type: 'checkbox', default: true },
        { key: 'xformers', label: 'Xformers 内存优化 (xformers)', type: 'checkbox', default: true },
        { key: 'shuffle_caption', label: '打乱提示词 (shuffle_caption)', type: 'checkbox', default: false }
      ]}
    ]
  };

  var state = {
    tab: 'lora',
    values: { checkpoint: {}, lora: {} },
    training: false,
    progress: 0,
    trainTimer: null
  };

  var el = {};
  var inited = false;

  function $(id) { return document.getElementById(id); }
  function toast(msg, type) { if (window.HMApp && window.HMApp.toast) window.HMApp.toast(msg, type); }

  /* ---------- 默认值加载 ---------- */
  function defaults(tab) {
    var d = {};
    FIELDS[tab].forEach(function (sec) {
      sec.items.forEach(function (f) { d[f.key] = f.default; });
    });
    return d;
  }

  function loadState(tab) {
    try {
      var raw = localStorage.getItem(LS_PREFIX + tab);
      if (raw) return Object.assign(defaults(tab), JSON.parse(raw));
    } catch (e) {}
    return defaults(tab);
  }
  function saveState(tab) {
    try { localStorage.setItem(LS_PREFIX + tab, JSON.stringify(state.values[tab])); } catch (e) {}
  }

  /* ---------- 渲染 ---------- */
  function renderTabs() {
    var html = '';
    ['lora', 'checkpoint'].forEach(function (t) {
      var active = state.tab === t;
      html += '<button class="hm-tr-tab' + (active ? ' is-active' : '') + '" data-tab="' + t + '">' +
        (t === 'lora' ? 'LoRA 模型训练' : 'Checkpoint 模型训练') + '</button>';
    });
    el.tabs.innerHTML = html;
  }

  function fieldInput(f, val) {
    var name = 'tr-' + f.key;
    if (f.type === 'checkbox') {
      return '<label class="hm-tr-check"><input type="checkbox" data-key="' + f.key + '"' + (val ? ' checked' : '') + '><span>' + (val ? '开启' : '关闭') + '</span></label>';
    }
    if (f.type === 'select') {
      var opts = f.options.map(function (o) {
        return '<option value="' + o.v + '"' + (o.v === val ? ' selected' : '') + '>' + o.t + '</option>';
      }).join('');
      return '<select data-key="' + f.key + '">' + opts + '</select>';
    }
    if (f.type === 'number') {
      var attrs = ' type="number"';
      if (f.min !== undefined) attrs += ' min="' + f.min + '"';
      if (f.max !== undefined) attrs += ' max="' + f.max + '"';
      if (f.step !== undefined) attrs += ' step="' + f.step + '"';
      return '<input' + attrs + ' data-key="' + f.key + '" value="' + val + '">';
    }
    return '<input type="text" data-key="' + f.key + '" value="' + (val == null ? '' : String(val).replace(/"/g, '&quot;')) + '">';
  }

  function renderForm() {
    var tab = state.tab;
    var vals = state.values[tab];
    var html = '';
    FIELDS[tab].forEach(function (sec) {
      html += '<div class="hm-tr-sec"><div class="hm-tr-sec-title">' + sec.sec + '</div><div class="hm-tr-grid">';
      sec.items.forEach(function (f) {
        var v = vals[f.key];
        if (v === undefined) v = f.default;
        html += '<div class="hm-tr-field">';
        html += '<label class="hm-tr-label">' + f.label + '</label>';
        html += fieldInput(f, v);
        if (f.hint) html += '<div class="hm-tr-hint">' + f.hint + '</div>';
        html += '</div>';
      });
      html += '</div></div>';
    });
    el.form.innerHTML = html;
  }

  function collectForm() {
    var tab = state.tab;
    var vals = state.values[tab];
    var nodes = el.form.querySelectorAll('[data-key]');
    nodes.forEach(function (n) {
      var k = n.getAttribute('data-key');
      if (n.type === 'checkbox') {
        vals[k] = n.checked;
        var span = n.parentElement.querySelector('span');
        if (span) span.textContent = n.checked ? '开启' : '关闭';
      } else if (n.type === 'number') {
        vals[k] = n.value === '' ? 0 : parseFloat(n.value);
      } else {
        vals[k] = n.value;
      }
    });
    saveState(tab);
  }

  /* ---------- 配置导出 ---------- */
  function buildConfig() {
    collectForm();
    var tab = state.tab;
    var v = state.values[tab];
    var cfg = {};
    FIELDS[tab].forEach(function (sec) {
      sec.items.forEach(function (f) {
        var val = v[f.key];
        // 自定义模型路径处理
        if (f.key === 'pretrained_model') {
          cfg.pretrained_model_name_or_path = val === 'custom' ? (v.custom_model_path || '') : val;
        } else if (f.key === 'custom_model_path') {
          // 已并入上面，跳过
        } else {
          cfg[f.key] = val;
        }
      });
    });
    cfg.training_type = tab;
    return cfg;
  }

  function exportJSON() {
    var cfg = buildConfig();
    var json = JSON.stringify(cfg, null, 2);
    el.preview.textContent = json;
    toast('已生成 ' + (tabLabel(state.tab)) + ' 配置', 'success');
  }

  function tabLabel(t) { return t === 'lora' ? 'LoRA' : 'Checkpoint'; }

  function downloadJSON() {
    var cfg = buildConfig();
    var blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = (cfg.output_name || 'train') + '_' + state.tab + '_config.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('配置 JSON 已下载', 'success');
  }

  function downloadCmd() {
    var cfg = buildConfig();
    var isLora = state.tab === 'lora';
    var script = isLora ? 'train_network.py' : 'dreambooth.py';
    var lines = ['accelerate launch ' + script + ' \\'];
    Object.keys(cfg).forEach(function (k) {
      if (k === 'training_type') return;
      var val = cfg[k];
      if (val === true) lines.push('  --' + k + ' \\');
      else if (val === false || val === '' || val == null) { /* skip */ }
      else lines.push('  --' + k + '=' + JSON.stringify(val) + ' \\');
    });
    // 去掉最后一个反斜杠
    var last = lines[lines.length - 1];
    lines[lines.length - 1] = last.replace(/ \\$/, '');
    var cmd = lines.join('\n');
    el.preview.textContent = '# ' + tabLabel(state.tab) + ' 训练命令 (sd-scripts)\n' + cmd;
    toast('已生成命令行', 'success');
  }

  function copyPreview() {
    var text = el.preview.textContent;
    if (!text) { toast('请先生成配置', 'error'); return; }
    navigator.clipboard.writeText(text).then(function () {
      toast('已复制到剪贴板', 'success');
    }).catch(function () {
      toast('复制失败，请手动选择文本', 'error');
    });
  }

  /* ---------- 模拟训练 ---------- */
  function startTraining() {
    if (state.training) return;
    collectForm();
    var v = state.values[state.tab];
    if (!v.output_name) { toast('请填写输出名称', 'error'); return; }
    state.training = true;
    state.progress = 0;
    el.progressBar.style.width = '0%';
    el.progressText.textContent = '准备中…';
    el.trainBtn.textContent = '训练中…';
    el.trainBtn.disabled = true;
    el.log.innerHTML = '';
    log('▶ 开始 ' + tabLabel(state.tab) + ' 训练：' + v.output_name);
    log('  基础模型：' + (v.pretrained_model === 'custom' ? v.custom_model_path : v.pretrained_model));
    log('  训练目录：' + v.train_data_dir);
    log('  分辨率：' + v.resolution + ' · Batch：' + v.train_batch_size);
    state.trainTimer = setInterval(tick, 220);
  }

  function tick() {
    state.progress += Math.random() * 2.2 + 0.6;
    if (state.progress >= 100) {
      state.progress = 100;
      clearInterval(state.trainTimer);
      state.trainTimer = null;
      state.training = false;
      el.progressBar.style.width = '100%';
      el.progressText.textContent = '100% · 完成';
      el.trainBtn.textContent = '开始训练';
      el.trainBtn.disabled = false;
      log('✔ 训练完成，模型已保存至：' + (state.values[state.tab].output_dir || './') + '/' + state.values[state.tab].output_name);
      toast(tabLabel(state.tab) + ' 训练完成（演示）', 'success');
      return;
    }
    el.progressBar.style.width = state.progress.toFixed(1) + '%';
    el.progressText.textContent = state.progress.toFixed(1) + '%';
    if (Math.random() < 0.18) {
      var step = Math.floor(state.progress * 5);
      log('  step ' + step + ' | loss=' + (Math.random() * 0.4 + 0.05).toFixed(4) + ' | lr=' + (state.values[state.tab].unet_lr || state.values[state.tab].learning_rate));
    }
  }

  function stopTraining() {
    if (!state.training) return;
    if (state.trainTimer) clearInterval(state.trainTimer);
    state.trainTimer = null;
    state.training = false;
    el.trainBtn.textContent = '开始训练';
    el.trainBtn.disabled = false;
    el.progressText.textContent = '已停止';
    log('■ 训练已手动停止');
  }

  function log(msg) {
    var line = document.createElement('div');
    line.className = 'hm-tr-log-line';
    line.textContent = msg;
    el.log.appendChild(line);
    el.log.scrollTop = el.log.scrollHeight;
  }

  function resetDefaults() {
    if (!confirm('确定恢复当前标签的全部默认参数？')) return;
    state.values[state.tab] = defaults(state.tab);
    saveState(state.tab);
    renderForm();
    toast('已恢复默认参数', 'info');
  }

  /* ---------- 绑定 ---------- */
  function bind() {
    el.back.addEventListener('click', function () {
      if (window.HMApp && window.HMApp.switchView) window.HMApp.switchView('tools');
    });
    el.tabs.addEventListener('click', function (e) {
      var b = e.target.closest('[data-tab]');
      if (!b) return;
      collectForm();
      state.tab = b.getAttribute('data-tab');
      renderTabs();
      renderForm();
    });
    el.form.addEventListener('change', collectForm);
    el.form.addEventListener('input', function (e) {
      if (e.target.matches('input[type="number"]')) collectForm();
    });
    el.btnJSON.addEventListener('click', exportJSON);
    el.btnCmd.addEventListener('click', downloadCmd);
    el.btnCopy.addEventListener('click', copyPreview);
    el.btnDownload.addEventListener('click', downloadJSON);
    el.btnReset.addEventListener('click', resetDefaults);
    el.trainBtn.addEventListener('click', function () {
      if (state.training) stopTraining(); else startTraining();
    });
  }

  /* ---------- 初始化 ---------- */
  function init() {
    if (inited) return;
    inited = true;
    el.back = $('trBack');
    el.tabs = $('trTabs');
    el.form = $('trForm');
    el.preview = $('trPreview');
    el.btnJSON = $('trBtnJSON');
    el.btnCmd = $('trBtnCmd');
    el.btnCopy = $('trBtnCopy');
    el.btnDownload = $('trBtnDownload');
    el.btnReset = $('trBtnReset');
    el.trainBtn = $('trTrainBtn');
    el.progressBar = $('trProgressBar');
    el.progressText = $('trProgressText');
    el.log = $('trLog');

    state.values.checkpoint = loadState('checkpoint');
    state.values.lora = loadState('lora');

    renderTabs();
    renderForm();
    bind();
  }

  function enter() { init(); }
  function leave() {
    if (state.trainTimer) { clearInterval(state.trainTimer); state.trainTimer = null; }
    state.training = false;
  }

  return { enter: enter, leave: leave };
})();
