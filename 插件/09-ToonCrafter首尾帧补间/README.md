# 09 · ToonCrafter 首尾帧补间插件

> 上游仓库：https://github.com/ToonCrafter/ToonCrafter
> 集成位置：绘梦平台 → 侧边栏【工具】→ 卡片【ToonCrafter首尾帧补间】

## 目录

```
插件/09-ToonCrafter首尾帧补间/
├─ 09_ToonCrafter首尾帧补间.zip   # 原始发布包（含源码压缩包）
├─ 源码/ToonCrafter-main/          # 已解压的官方源码（PyTorch）
├─ 说明.txt                       # 原始说明
├─ 使用说明.md                     # 原始使用说明
└─ README.md                       # 本文件（集成说明）
```

## 功能定位

给两张关键帧（首帧 + 尾帧），生成中间过渡帧序列，赛璐璐 / 线稿风格友好，是漫剧补帧的核心环节：

```
关键帧作画 → ToonCrafter 补间 → RIFE 插帧 → 上色
```

## 平台内的可视化实现

前端 `frontend/toon.js` + `#view-tooltoon` 视图，提供双通道：

### 1. 浏览器预演（默认，无需后端）
- 拖入 / 选择首帧、尾帧，实时显示
- 参数：中间帧数 2–16、DDIM 步数 10–50、播放帧率 6–24、画幅（512×320 / 320×512 / 512×512）、运动缓动（缓入缓出 / 匀速 / 推镜）
- 点击「生成补间」按缓动曲线重建中间帧，输出时间轴缩略图
- 播放 / 暂停（空格）、← → 逐帧、导出当前帧 PNG、导出整段帧序列 ZIP
- 用途：分镜预演、节奏确认、导出给真实推理做参考，不消耗算力

### 2. 本地 ToonCrafter 推理（真实生成）
- 面板填写本地服务地址（默认 `http://127.0.0.1:7860`），点「连接测试」探测
- 「复制推理命令」按当前参数生成官方 CLI 命令，粘贴到本地仓库执行

## 本地部署官方推理

```bash
# 1. 环境
conda create -n tooncrafter python=3.8.5 -y && conda activate tooncrafter
cd 插件/09-ToonCrafter首尾帧补间/源码/ToonCrafter-main
pip install -r requirements.txt

# 2. 权重（HF 需登录接受协议）
#    https://huggingface.co/Doubiiu/ToonCrafter
#    下载 model.ckpt 放到 checkpoints/

# 3. 推理（512 分辨率 · 16 帧以内）
python scripts/infer.py -i 首帧.png 尾帧.png -o ./results \
  --frame_num 8 --ddim_steps 50

# 4. 或启动 Web 服务，供平台「连接测试」探测
python gradio_app.py
```

硬件参考（官方）：A100 · 512×320 · DDIM 50 步约 24s，显存约 24G。

## 接口约定（供二次开发）

- 前端探测：`GET {base}` 可访问即视为服务在线
- 若自建推理服务，建议暴露：`POST {base}/interpolate`
  - body：`multipart/form-data`（字段 `first`、`last`、`frame_num`、`ddim_steps`、`resolution`）
  - 返回：`{ frames: ["data:image/png;base64,...", ...] }`

## 注意

- GitHub Pages 为纯静态托管，无法运行 PyTorch，因此默认走浏览器预演；真实扩散补间必须本地或自建 GPU 服务。
- 权重文件体积大且需登录授权，未随插件打包。
