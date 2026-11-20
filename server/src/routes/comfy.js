'use strict';

/**
 * ComfyUI 代理路由
 * 连接本地 ComfyUI（localhost:8188），提交 Wan2.1 工作流并返回视频结果。
 *
 * ComfyUI API:
 *   GET  /system_stats              系统状态
 *   POST /prompt                    提交 workflow → { prompt_id, number }
 *   GET  /history/{prompt_id}       获取运行结果 → 输出文件路径
 *   GET  /view?filename=..&type=..  下载输出文件
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;

const config = require('../config');
const { fetchJson, fetchWithTimeout, jsonError, sleep, assert } = require('../http');

const COMFY_BASE = process.env.COMFY_BASE || 'http://127.0.0.1:8188';
const COMFY_TIMEOUT = 15000;          // 单次 HTTP 超时
const POLL_INTERVAL = 10000;          // 轮询间隔 10s
const POLL_MAX = 60;                  // 最多轮询 60 次 = 10 分钟

const MEDIA_DIR = path.join(config.DATA_DIR, 'media');

/** 获取本地 Wan2.1 T2V workflow 模板（来自 docs/comfyui/） */
function loadWorkflowTemplate() {
  // 优先用用户上传过的，否则用内置模板
  const searchPaths = [
    path.join(__dirname, '../../../../docs/comfyui/wan2.1_t2v_1.3B.json'),
    path.join(__dirname, '../../../docs/comfyui/wan2.1_t2v_1.3B.json'),
  ];
  for (const p of searchPaths) {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  // 硬编码一个最小 Wan2.1 T2V 1.3B workflow
  return {
    id: 'wan21-t2v-inline',
    revision: 1,
    last_node_id: 8,
    last_link_id: 7,
    nodes: [
      { id: 1, type: 'CLIPLoader', pos: [50, 50], size: [315, 60], widgets_values: ['umt5_xxl_fp8_e4m3fn_scaled.safetensors'] },
      { id: 2, type: 'UNETLoader', pos: [50, 150], size: [315, 82], widgets_values: ['wan2.1_t2v_1.3B_fp16.safetensors'] },
      { id: 3, type: 'CLIPTextEncode', pos: [400, 50], size: [420, 170], widgets_values: ['a cat running'] },
      { id: 4, type: 'CLIPTextEncode', pos: [400, 250], size: [420, 170], widgets_values: ['low quality, blurry'] },
      { id: 5, type: 'EmptyHunyuanLatentVideo', pos: [870, 50], size: [315, 140], widgets_values: [1344, 768, 49, 82, 1] },
      { id: 6, type: 'KSampler', pos: [1220, 50], size: [315, 262], widgets_values: [30, 7.0, 'randomize', 1, 8000, 'euler', 1.0] },
      { id: 7, type: 'VAELoader', pos: [50, 300], size: [315, 60], widgets_values: ['wan_2.1_vae.safetensors'] },
      { id: 8, type: 'VAEDecodeVideo', pos: [1570, 50], size: [315, 160] },
      { id: 9, type: 'SaveVideo', pos: [1920, 50], size: [315, 170], widgets_values: ['wan21_output'] },
    ],
    links: [
      [1, 0, 3, 1], [1, 0, 4, 1], [2, 0, 6, 4], [3, 0, 6, 0], [4, 0, 6, 3],
      [5, 0, 6, 5], [6, 0, 8, 0], [7, 0, 8, 1], [8, 0, 9, 0],
    ],
    groups: [],
    config: {},
    extra: {},
    version: 0.4,
  };
}

/** 把 ComfyUI 工作流前端格式转成 API 提交格式 */
function graphToPrompt(graph) {
  const nodes = {};
  for (const node of graph.nodes) {
    const inputs = {};
    const widgetValues = node.widgets_values || [];
    const links = {};
    // links[i]: [from_node_id, from_slot, to_node_id, to_slot, type]
    for (const link of graph.links || []) {
      if (link[2] === node.id) {
        links[link[3]] = { node_id: link[0], socket: link[1] };
      }
    }
    // 按照 ComfyUI API 约定，先填 inputs（来自 links），再填缺失的（来自 widgets_values）
    const classType = node.type;
    // inputs 先设 links 提供的，其余由下面通用逻辑处理
    nodes[node.id] = {
      class_type: classType,
      inputs: { ...inputs },
    };
    // 这个转换比较复杂——简化方案：用官方 ComfyUI 自带的转换
    // 但我们直接构造一个已知 API 格式的 prompt
  }
  return nodes;
}

/** 直接构造 Wan2.1 T2V 1.3B API prompt（不依赖前端 graph 格式转换） */
function buildWanT2VPrompt({ prompt, negative, width = 1344, height = 768, length = 49, steps = 30, cfg = 7.0, seed = null }) {
  return {
    '3': {
      class_type: 'CLIPTextEncode',
      inputs: { text: prompt, clip: ['1', 0] },
    },
    '4': {
      class_type: 'CLIPTextEncode',
      inputs: { text: negative || '', clip: ['1', 0] },
    },
    '1': {
      class_type: 'CLIPLoader',
      inputs: { clip_name: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors', type: 'wan' },
    },
    '2': {
      class_type: 'UNETLoader',
      inputs: { unet_name: 'wan2.1_t2v_1.3B_fp16.safetensors', weight_dtype: 'default' },
    },
    '5': {
      class_type: 'EmptyHunyuanLatentVideo',
      inputs: { width, height, length, batch_size: 1 },
    },
    '6': {
      class_type: 'KSampler',
      inputs: {
        seed: seed ?? Math.floor(Math.random() * 1000000000),
        steps,
        cfg,
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1.0,
        model: ['2', 0],
        positive: ['3', 0],
        negative: ['4', 0],
        latent_image: ['5', 0],
      },
    },
    '7': {
      class_type: 'VAELoader',
      inputs: { vae_name: 'wan_2.1_vae.safetensors' },
    },
    '8': {
      class_type: 'VAEDecodeVideo',
      inputs: { samples: ['6', 0], vae: ['7', 0] },
    },
    '9': {
      class_type: 'SaveVideo',
      inputs: {
        filename_prefix: 'wan21_t2v',
        format: 'video/h264-mp4',
        pix_fmt: 'yuv420p',
        crf: 19,
        save_metadata: true,
        trim_to_audio: false,
        pingpong: false,
        save_output: true,
        images: ['8', 0],
      },
    },
  };
}

/** GET /api/comfy/health —— 健康检查 */
router.get('/health', async (req, res) => {
  try {
    const stats = await fetchJson(`${COMFY_BASE}/system_stats`, { timeout: COMFY_TIMEOUT });
    res.json({
      ok: true,
      comfy: COMFY_BASE,
      system: stats.system || {},
      devices: (stats.devices || []).map((d) => ({
        name: d.name,
        vram: d.vram_total,
        free: d.vram_free,
      })),
    });
  } catch (err) {
    res.json({ ok: false, comfy: COMFY_BASE, error: err.message, hint: 'ComfyUI 未启动或地址不对。需要在本地 run_nvidia_gpu.bat / main.py 启动' });
  }
});

/** GET /api/comfy/models —— 列已加载模型 */
router.get('/models', async (req, res) => {
  try {
    const [unet, clip, vae] = await Promise.all([
      fetchJson(`${COMFY_BASE}/object_info/UNETLoader`, { timeout: COMFY_TIMEOUT }).catch(() => ({})),
      fetchJson(`${COMFY_BASE}/object_info/CLIPLoader`, { timeout: COMFY_TIMEOUT }).catch(() => ({})),
      fetchJson(`${COMFY_BASE}/object_info/VAELoader`, { timeout: COMFY_TIMEOUT }).catch(() => ({})),
    ]);
    res.json({ ok: true, unet, clip, vae });
  } catch (err) {
    jsonError(res, 502, 'ComfyUI 连接失败', err.message);
  }
});

/** POST /api/comfy/run —— 提交 Wan2.1 T2V 工作流 */
router.post('/run', async (req, res) => {
  try {
    const { prompt, negative, width, height, length, steps, cfg, seed } = req.body || {};
    assert(prompt && prompt.trim(), 400, '请输入提示词', 'prompt 不能为空');
    assert(prompt.length <= 800, 400, '提示词过长', 'prompt 最多 800 字符');

    // 尺寸限制
    const w = Number(width) || 1344;
    const h = Number(height) || 768;
    assert([832, 1280, 1344, 1536, 1920].includes(w) && [480, 720, 768, 1024, 1080].includes(h),
      400, '分辨率不支持', 'Wan2.1 仅支持特定分辨率');
    const len = Number(length) || 49;
    assert([17, 49, 81].includes(len), 400, '视频帧数不支持', 'Wan2.1 支持 17/49/81 帧');

    const apiPrompt = buildWanT2VPrompt({
      prompt: prompt.trim(),
      negative: (negative || 'low quality, blurry, distorted').trim(),
      width: w, height: h, length: len,
      steps: Number(steps) || 30,
      cfg: Number(cfg) || 7.0,
      seed: seed != null ? Number(seed) : null,
    });

    // 提交到 ComfyUI
    let submitRes;
    try {
      submitRes = await fetchWithTimeout(`${COMFY_BASE}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: apiPrompt, client_id: 'huimeng-backend' }),
        timeout: COMFY_TIMEOUT,
      });
    } catch (err) {
      return jsonError(res, 502, 'ComfyUI 连接失败', `无法连接到 ${COMFY_BASE} —— 请先启动 ComfyUI (main.py)`);
    }
    if (!submitRes.ok) {
      const text = await submitRes.text();
      return jsonError(res, 502, 'ComfyUI 提交失败', text.slice(0, 400));
    }
    const submitData = await submitRes.json();
    const promptId = submitData.prompt_id;
    assert(promptId, 502, 'ComfyUI 返回异常', '缺少 prompt_id');

    // 异步轮询 —— 先返回 promptId，让客户端轮询
    res.json({ ok: true, prompt_id: promptId, comfy_base: COMFY_BASE, message: '已提交到 ComfyUI，轮询 /api/comfy/status/' + promptId });
  } catch (err) {
    jsonError(res, err.status || 500, err.message || 'ComfyUI 提交异常', err.hint || err.stack?.slice(0, 300));
  }
});

/** GET /api/comfy/status/:promptId —— 轮询运行状态 */
router.get('/status/:promptId', async (req, res) => {
  const { promptId } = req.params;
  try {
    const hist = await fetchJson(`${COMFY_BASE}/history/${promptId}`, { timeout: COMFY_TIMEOUT });
    const entry = hist[promptId];
    if (!entry) {
      return res.json({ ok: true, status: 'pending', queue_position: -1 });
    }
    const output = entry.outputs || {};
    // 找 SaveVideo 节点的输出
    let videoFile = null;
    for (const nodeId of Object.keys(output)) {
      const nodeOut = output[nodeId];
      if (nodeOut.videos && nodeOut.videos.length > 0) {
        videoFile = nodeOut.videos[0];
        break;
      }
    }
    const status = entry.status?.completed ? (entry.status.errors?.length ? 'error' : 'success') : 'running';
    if (status === 'error') {
      return jsonError(res, 502, 'ComfyUI 运行出错', JSON.stringify(entry.status.errors).slice(0, 400));
    }
    if (status !== 'success' || !videoFile) {
      return res.json({ ok: true, status, progress: entry.status?.messages?.slice(-3) || [] });
    }

    // 下载视频到本地 media 目录
    const viewUrl = `${COMFY_BASE}/view?filename=${encodeURIComponent(videoFile.filename)}&subfolder=${encodeURIComponent(videoFile.subfolder || '')}&type=output`;
    const dlRes = await fetch(viewUrl);
    if (!dlRes.ok) throw new Error(`下载失败: ${dlRes.status}`);
    const buf = Buffer.from(await dlRes.arrayBuffer());
    await fsp.mkdir(MEDIA_DIR, { recursive: true });
    const localName = `comfyui_${promptId}_${Date.now()}.mp4`;
    const localPath = path.join(MEDIA_DIR, localName);
    await fsp.writeFile(localPath, buf);

    res.json({
      ok: true,
      status: 'success',
      prompt_id: promptId,
      local_file: localName,
      url: `/api/media/${localName}`,
      comfy_filename: videoFile.filename,
      size: buf.length,
    });
  } catch (err) {
    jsonError(res, 502, 'ComfyUI 状态查询失败', err.message);
  }
});

/** POST /api/comfy/poll —— 同步版：提交 + 轮询 + 返回视频（30秒超时适合短测试，实际视频生成都异步） */
router.post('/poll', async (req, res) => {
  try {
    const { prompt, width, height, length } = req.body || {};
    assert(prompt && prompt.trim(), 400, '请输入提示词');

    const apiPrompt = buildWanT2VPrompt({
      prompt: prompt.trim(),
      width: Number(width) || 1344, height: Number(height) || 768,
      length: Number(length) || 49,
    });

    const submitRes = await fetchWithTimeout(`${COMFY_BASE}/prompt`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: apiPrompt, client_id: 'huimeng-backend' }),
      timeout: COMFY_TIMEOUT,
    });
    if (!submitRes.ok) {
      const text = await submitRes.text();
      return jsonError(res, 502, 'ComfyUI 提交失败', text.slice(0, 400));
    }
    const { prompt_id } = await submitRes.json();

    // 轮询
    for (let i = 0; i < POLL_MAX; i++) {
      await sleep(POLL_INTERVAL);
      const hist = await fetchJson(`${COMFY_BASE}/history/${prompt_id}`, { timeout: COMFY_TIMEOUT }).catch(() => ({}));
      const entry = hist[prompt_id];
      if (!entry) continue;
      if (entry.status?.errors?.length) {
        return jsonError(res, 502, 'ComfyUI 运行出错', JSON.stringify(entry.status.errors).slice(0, 400));
      }
      if (entry.status?.completed) {
        const outputs = Object.values(entry.outputs || {});
        const video = outputs.flatMap((o) => o.videos || [])[0];
        if (!video) return jsonError(res, 502, 'ComfyUI 无视频输出', 'outputs 里没有 videos');
        // 下载
        const viewUrl = `${COMFY_BASE}/view?filename=${encodeURIComponent(video.filename)}&subfolder=${encodeURIComponent(video.subfolder || '')}&type=output`;
        const dlRes = await fetch(viewUrl);
        const buf = Buffer.from(await dlRes.arrayBuffer());
        await fsp.mkdir(MEDIA_DIR, { recursive: true });
        const localName = `comfyui_${prompt_id}_${Date.now()}.mp4`;
        await fsp.writeFile(path.join(MEDIA_DIR, localName), buf);
        return res.json({ ok: true, url: `/api/media/${localName}`, size: buf.length });
      }
    }
    jsonError(res, 504, 'ComfyUI 运行超时', `已轮询 ${POLL_MAX * POLL_INTERVAL / 1000}s，仍未完成`);
  } catch (err) {
    jsonError(res, err.status || 500, err.message || 'ComfyUI 异常', err.hint);
  }
});

module.exports = router;
module.exports.COMFY_BASE = COMFY_BASE;
module.exports.buildWanT2VPrompt = buildWanT2VPrompt;
