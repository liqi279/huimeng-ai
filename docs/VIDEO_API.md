# 绘梦AI 视频生成 · 则灵平台接入文档

## 概述

绘梦AI平台视频生成本体走则灵（RayinAPI / Zeling）代理通道，后端部署于 Render，前端部署于 GitHub Pages。

- 后端地址：`https://huimeng-ai-backend.onrender.com/api`
- 前端页面：`https://liqi279.github.io/huimeng-ai/`
- 后端入口：`server/src/routes/generate.js`
- 视频模型定义：`server/src/routes/generate.js VIDEO_MODELS`（按次/按秒/分辨率/fps/积分/参考提示）

---

## 1. 模型目录接口

### GET /api/media-models

前端启动时自动拉取，用于动态渲染：模型列表、时长滑块、分辨率选项、参考主体限制、积分提示。

**请求**

```bash
curl "${BACKEND}/api/media-models"
```

**响应（关键字段）**

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 模型 ID，提交生成时使用 |
| `name` | string | 显示名称 |
| `minDuration` / `maxDuration` | number | 时长范围（秒） |
| `resolutions` | string[] | 支持的分辨率：`720p` / `1080p` / `2k` |
| `fps` | number | 帧率（当前全部 24，可灵 25） |
| `billingType` | string | `perTask`（按次）或 `perSecond`（按秒） |
| `credits` | number | 按次计费的单次积分 |
| `creditsPerSec` | number | 按秒计费的每秒积分 |
| `desc` | string | 一行描述 |
| `refHint` | string | 模型专属参考主体提示语 |
| `refLimits` | object | 图片 / 视频 / 音频各自的数量和大小限制 |

### 当前 6 个模型

| 模型 ID | 名称 | 计费 | 积分 | 时长 | 分辨率 | fps | 参考提示 |
|---|---|---|---|---|---|---|---|
| `sora-2` | Sora 2 | 按次 | 1920 积分 / 次 | 5–15s | 720p/1080p/2k | 24 | 图片/视频/音频参考，主体居中清晰 |
| `sora-2-pro` | Sora 2 Pro | 按次 | 3200 积分 / 次 | 5–15s | 720p/1080p/2k | 24 | Pro 版，建议 1–3 张关键帧 |
| `veo-3` | Veo 3 | 按秒 | 10 积分 / 秒 | 5–30s | 720p/1080p | 24 | 图片参考，长镜头叙事 |
| `seedance-1` | Seedance 1.0 | 按次 | 1280 积分 / 次 | 5–15s | 720p/1080p | 24 | 首帧参考，风格迁移推荐 |
| `wan-2` | Wan 2.1 | 按秒 | 8 积分 / 秒 | 5–30s | 720p/1080p | 24 | 图片参考，动作一致性好 |
| `kling-1.6` | Kling 1.6 | 按次 | 960 积分 / 次 | 5–10s | 720p/1080p | 25 | 首尾帧参考，镜头运动精准 |

---

## 2. 视频生成接口

### POST /api/generate

生成请求统一入口，`mode` 指定为 `video`。

**请求体**

```json
{
  "mode": "video",
  "model": "sora-2",
  "prompt": "夕阳下的城市赛博朋克夜景，主角在屋顶奔跑",
  "ratio": "16:9",
  "resolution": "1080p",
  "duration": 10,
  "seed": 123456,
  "refImages": ["data:image/jpeg;base64,..."],
  "refVideos": [],
  "refAudios": [],
  "rayin": { "key": "sk-xxx" }
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `mode` | ✅ | 固定 `video` |
| `model` | ✅ | 上表的模型 ID |
| `prompt` | ✅ | 生成描述（最多 1800 字） |
| `ratio` | ❌ | `16:9` / `9:16` / `1:1` / `4:3` / `3:4`，默认 `16:9` |
| `resolution` | ❌ | `720p` / `1080p` / `2k`，必须在该模型的 `resolutions` 列表内 |
| `duration` | ✅ | 秒数，5 的倍数，在模型 `minDuration`~`maxDuration` 范围内 |
| `seed` | ❌ | 固定种子可复现，不传则随机 |
| `refImages` | ❌ | data URL 数组（图片 ≤10MB × 最多 10 张） |
| `refVideos` | ❌ | data URL 数组（视频 ≤50MB × 最多 3 个） |
| `refAudios` | ❌ | data URL 数组（音频 ≤10MB × 最多 3 个） |
| `rayin.key` | ✅ | RayinAPI / 则灵平台 API Key，也可在服务端环境变量 `RAYIN_KEY` 预设 |

**响应**

```json
{
  "items": [
    {
      "url": "/uploads/media/179356xxx.mp4",
      "duration": 10,
      "seed": 123456,
      "model": "sora-2",
      "engine": "rayin"
    }
  ],
  "elapsed": 42310
}
```

视频为异步任务，后端内部向 RayinAPI 创建任务后自动轮询状态，最多等待 90 秒。

**错误格式**

```json
{ "error": { "message": "...", "hint": "..." } }
```

| HTTP | 常见错误 | 说明 |
|---|---|---|
| 400 | `视频时长 xx 秒超出范围` | 当前模型不支持该时长 |
| 400 | `请上传参考图` | 参考图需 data URL |
| 401 | `未配置 RayinAPI Key` | 请在前端或环境变量配置 Key |
| 403 | `INSUFFICIENT_BALANCE` | 账号余额不足，需在 RayinAPI 充值 |
| 502 | `视频模型接口不可用` | 则灵平台或其上游异常 |

---

## 3. 服务端配置

Render 环境变量（全部可选，不传使用仓库内默认）：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `RAYIN_BASE` | `https://www.rayinai.com/v1` | 则灵 API Base |
| `RAYIN_KEY` | sk-e77e... | API Key（默认已写入源码，生产建议覆盖） |
| `RAYIN_VIDEO_PATH` | `/videos/generations` | 创建任务的路径 |
| `RAYIN_VIDEO_STATUS_PATH` | `/videos/generations` | 状态查询路径（RayinAPI 同一路径 POST 创建 / GET 查询） |
| `VIDEO_MODEL` | `sora-2` | 默认模型 |

---

## 4. 扩展新模型（后端改动 3 行）

编辑 `server/src/routes/generate.js` 的 `VIDEO_MODELS` 数组，追加：

```js
{
  id: 'new-model-id',
  name: 'New Model Name',
  minDuration: 5, maxDuration: 15,
  resolutions: ['720p', '1080p'],
  fps: 24,
  billingType: 'perTask', credits: 1200,
  // billingType: 'perSecond', creditsPerSec: 15,
  refHint: '模型专属参考说明，显示在参考主体区域',
  desc: '一句话简介',
  free: false,
},
```

前端无需改动——模型切换 / 积分 tooltip / 分辨率选项 / 参考提示 全部由后端元数据自动驱动。
