# ToonCrafter 推理服务（真实推理）

把官方 `Image2Video` 包成 HTTP 接口，供绘梦前端「工具 → ToonCrafter 首尾帧补间」调用。

## 1. 环境要求

| 项 | 要求 |
|---|---|
| 显卡 | NVIDIA，显存 ≥12G（256）/ ≥24G（512，推荐）/ ≥40G（1024） |
| Python | 3.10 |
| 系统 | Linux / WSL2 / Windows（Windows 建议 WSL2） |
| 磁盘 | 权重约 5–10G，另加环境 8G |

## 2. 安装

```bash
cd 插件/09-ToonCrafter首尾帧补间/服务
bash install.sh          # 建 .venv、装 torch + 官方依赖 + flask
```

## 3. 启动

```bash
source .venv/bin/activate
python server.py --port 7861 --warmup 320_512
```

首次启动会自动从 HuggingFace 下载 `Doubiiu/ToonCrafter` 权重（约 5G）。
看到 `Running on http://127.0.0.1:7861` 即成。

## 4. 接口

### `GET /api/health`

```json
{ "ok": true, "device": "cuda", "gpu": "NVIDIA RTX 4090", "vram_gb": 24.0,
  "resolutions": ["256_256","320_512","576_1024"],
  "checkpoints": { "320_512": true }, "busy": false, "loaded": ["320_512"] }
```

### `POST /api/interpolate`（multipart/form-data）

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| first | file | 必填 | 首帧图片 |
| last | file | 必填 | 尾帧图片 |
| prompt | text | `an anime scene` | 画面描述 |
| steps | int | 50 | DDIM 采样步数 1–60 |
| cfg | float | 7.5 | CFG 引导 1–15 |
| eta | float | 1.0 | 采样随机性 0–1 |
| fs | int | 10 | 帧率 5–30 |
| seed | int | 123 | 随机种子 |
| resolution | text | `320_512` | `256_256` / `320_512` / `576_1024` |

返回：

```json
{ "ok": true, "video": "/results/toon_ab12cd34.mp4", "elapsed": 26.4,
  "resolution": "320_512", "steps": 50, "fps": 10, "seed": 123 }
```

视频地址：`GET /results/<name>`。

## 5. 前端连接

打开绘梦 → 工具 → ToonCrafter 首尾帧补间：
1. 右侧「推理服务」填 `http://127.0.0.1:7861` → 点「连接测试」，徽标变「已连接」
2. 上传首帧、尾帧，调参数
3. 点「生成补间（真实推理）」→ 页面显示上传进度与推理计时，完成后直接播放、可下载视频 / 导出帧序列

若网页部署在 GitHub Pages（https），浏览器会拦截 http 本地请求，此时请：
- 打开本地单文件版 `绘梦AI动漫创作平台.html`，或
- 用 Chrome 启动参数 `--unsafely-treat-insecure-origin-as-secure=http://127.0.0.1:7861`，或
- 用 `python -m http.server` 在本机打开部署目录

## 6. 常见问题

| 现象 | 处理 |
|---|---|
| `checkpoint Not Found` | 权重没下完，重跑启动或手动 `huggingface-cli download` |
| CUDA out of memory | 换 `256_256`，或降低 steps |
| 5090/新卡不支持 | 需更新 torch 至该卡支持版本，再重装官方依赖 |
| 生成 1–3 分钟 | 正常，512 / 50 步在 4090 约 25–40s，首次含模型加载更慢 |
