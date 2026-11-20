# 绘梦 AI · Cloudflare Workers 后端

把 `../server`（Express）完整移植到 Cloudflare Workers（Hono + D1，可选 R2）。
**API 路径与请求/响应格式与 Express 版一致**，前端 `frontend/api.js` 只需把 `?api=` 或
`<meta name="hm-api-base">` 指向本 Worker 的 `/api` 即可。

## 目录

```
workers/
├── package.json
├── wrangler.toml      # D1 绑定 DB；R2 绑定 ASSETS（默认注释，可选）
├── schema.sql         # D1 建表语句
└── src/
    ├── index.js       # Hono 入口 + CORS + 404/错误处理
    ├── config.js      # 环境变量与默认值
    ├── security.js    # PBKDF2 密码 / HMAC-SHA256 token（纯 Web Crypto）
    ├── db.js          # D1 数据访问
    ├── storage.js     # R2 优先，未绑定时落 D1 blobs
    ├── auth.js        # 鉴权中间件
    ├── catalog.js / presets.js
    └── routes/        # health/auth/works/desk/assets/presets/catalog/translate/rayin/generate/admin
```

## 部署步骤

```bash
cd workers
npm i

# 0) 登录 Cloudflare（或设置 CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID）
npx wrangler login

# 1) 创建 D1 数据库，把输出的 database_id 填到 wrangler.toml 的 [[d1_databases]]
npx wrangler d1 create huimeng-ai

# 2) 建表（远程）
npx wrangler d1 execute DB --remote --file=schema.sql

# 3) （可选）创建 R2 存储桶，然后取消 wrangler.toml 中 [[r2_buckets]] 的注释
#    不创建也可以：图片/音频自动存 D1 的 blobs 表，通过 /api/blob/:key 访问
npx wrangler r2 bucket create huimeng-ai-assets

# 4) 设置 token 签名密钥（重要：不设则用内置默认值）
npx wrangler secret put TOKEN_SECRET

# 5) 部署
npx wrangler deploy
```

部署后地址形如 `https://huimeng-ai-api.<你的子域>.workers.dev`，前端指向：

- URL 参数：`?api=https://huimeng-ai-api.xxx.workers.dev/api`
- 或 `<meta name="hm-api-base" content="https://huimeng-ai-api.xxx.workers.dev/api">`

## 初始化管理员（二选一）

**方案 A：一次性接口（推荐）**

部署完成后（users 表为空时）执行：

```bash
curl -X POST https://huimeng-ai-api.xxx.workers.dev/api/admin/seed
# => {"ok":true,"user":{"id":"u_...","username":"admin","role":"admin","createdAt":...}}
```

默认创建 `admin / admin123`。可用 vars `ADMIN_USER` / `ADMIN_PASS` 覆盖。
一旦表里有任意用户，该接口返回 409，防止被滥用。

**方案 B：先本地 seed 再导出到线上**（不推荐，D1 导入较麻烦）

```bash
npx wrangler dev --local --port 8787
curl -X POST http://127.0.0.1:8787/api/admin/seed
```

登录后请尽快用 `/api/auth/users/:id/password` 修改管理员密码。

## 本地开发与验证

```bash
cd workers
npm i
npm run db:init          # = wrangler d1 execute DB --local --file=schema.sql（本地 D1 建表）
npx wrangler dev --local --port 8787
```

注意：本地 D1 数据默认在 `.wrangler/state` 下；每次重启 `wrangler dev` 会保留，
删除该目录即可重置。R2 未绑定时走 D1 blobs，本地开箱即用。

## 环境变量 / Secrets

| 名称 | 位置 | 说明 |
| --- | --- | --- |
| `DB` | wrangler.toml | D1 绑定（必填） |
| `ASSETS` | wrangler.toml（注释） | R2 绑定（可选） |
| `TOKEN_SECRET` | secret | token 签名密钥 |
| `RAYIN_KEY` | secret（可选） | 服务端 RayinAPI Key |
| `RAYIN_BASE` / `GPT_MODEL` / `BANANA_MODEL` / `VIDEO_MODEL` / `AUDIO_MODEL` | vars | 上游模型配置 |
| `RAYIN_VIDEO_PATH` / `RAYIN_VIDEO_STATUS_PATH` | vars | 视频接口路径 |
| `CORS_ORIGIN` | vars | 默认 `*`，可填逗号分隔白名单 |

## API 覆盖

`GET /api/health`、`GET /api/config`、`POST /api/auth/register|login`、`GET /api/auth/me`、
`POST /api/auth/logout`、`GET|POST /api/auth/users`、`PATCH /api/auth/users/:id/role|password`、
`DELETE /api/auth/users/:id`、`POST /api/translate`、`GET|POST|DELETE /api/works`、
`DELETE /api/works/:id`、`GET|PUT /api/desk`、`GET|POST /api/assets`、`DELETE /api/assets/:id`、
`GET /api/blob/:key`、`GET /api/presets`、`GET /api/catalog`、`POST /api/rayin/models`、
`POST /api/generate`（image/video/audio）、`POST /api/admin/seed`。

## 与 Express 版的差异 / 注意事项

1. **密码哈希迭代次数**从 100000 降到 10000（仍为 PBKDF2-SHA256），
   因为 Cloudflare 免费层单请求 CPU 上限 10ms，100k 次会超限（Error 1102）。
   若使用付费计划可自行调高 `src/security.js` 的 `ITERATIONS`。
2. 旧 Express 签发的 token 不兼容（secret/算法实现相同但格式不同），需要重新登录。
3. 无 R2 时图片以 base64 存 D1：D1 单行有大小限制，**建议单图 ≤ 2MB**；
   素材上传接口本身限制 8MB，大文件请启用 R2。
4. 视频生成/状态轮询最长 90s。免费层 subrequest 上限 50，轮询约 30 次，
   通常够用；如频繁超限请升级或缩短轮询。
5. `/api/generate` 依赖公网上游（Pollinations / Rayin / 硅基流动等），本地仅能验证参数校验与错误路径。
