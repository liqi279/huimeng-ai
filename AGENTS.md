# 交付规则（每次改动都必须遵守）

每次完成任何代码/需求/bug 修复后，**必须自动把改动送到线上，不要等用户提醒**。
推送 `main` 就是发布，仓库里已有两条 GitHub Actions 流水线接管后续动作。

## 标准动作

1. **语法检查**：`node --check frontend/app.js`（以及本次改动的其它 js）
2. **构建**：`node scripts/build-deploy.js`
   （等价于 `npm run build`，生成 `deploy/index.html` 与根目录 `绘梦AI动漫创作平台.html`）
3. **提交**：`git add` 本次改动的前端源码 + 两个构建产物，提交信息写清"改了什么/为什么"
4. **推送**：`git push origin main`
5. **等待 CI 跑完并核对结论**（见下方"推送之后"）
6. 在回复末尾固定给出三行信息：
   - GitHub 仓库：https://github.com/liqi279/huimeng-ai
   - 本次 commit：<短 hash + 标题>（已推送到 main）
   - 前端页面：https://liqi279.github.io/huimeng-ai/

一条命令完成上述 1–5：

```powershell
pwsh -File scripts/publish.ps1 "feat: 改了什么/为什么"
```

它会自动判断改动范围（只有动了 `frontend/` 才重建、动了 `server/` 才等后端流水线），
在本地落后远程、语法检查失败、构建失败时直接中止，**不会**做任何强制覆盖。
推送后由 `scripts/verify-live.js` 做线上自检（CI 结论 + 后端 health + 数据库 books + 前端 Pages）。

## 推送之后：三条线各自怎么上线

| 目标 | 触发 | 机制 | 验证 |
| --- | --- | --- | --- |
| 前端 | 任意 push 到 `main` | `.github/workflows/deploy-pages.yml` 把 `deploy/` 目录作为 Pages 产物发布 | CI 结论 + 打开 https://liqi279.github.io/huimeng-ai/ |
| 后端 | push 到 `main` 且改动命中 `server/**` | `.github/workflows/deploy-scf.yml` 调 `server/scripts/scf-deploy.js`：快照 → 打包 → 上传 COS → `UpdateFunctionCode` → 五步自检 | SCF 云端 `/api/health` 返回 `storage="mysql"`、`persistent=true` |
| 数据库 | 后端部署时隐式完成 | TiDB 建表与加列在函数启动时执行（`CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN`，幂等）；数据本身由 `MYSQL_URL` 指向的 TiDB 持久化 | 同上；发布脚本还会 GET `/api/library/books` 校验 `store.mode="mysql"` 且书目非空 |

**数据库没有独立的"推送"步骤**：schema 变更写成代码里的幂等 DDL 即可随后端部署生效。
需要改数据本身（导入/修正），用 `server/scripts/db-export.js` 或直接连 TiDB 执行，不要靠改仓库文件。

## 密钥与鉴权（当前环境实测）

- 本机 git 走 HTTPS + PAT：token 存在 `.git/config` 的 `http.https://github.com/.extraHeader`（base64），
  **不在仓库文件里、不会随提交外泄**。不要把它换成明文写在脚本或 workflow 里。
- Actions 侧只需要两个仓库 Secret：`COS_SECRET_ID`、`COS_SECRET_KEY`。
  `COS_BUCKET` / `SCF_FUNCTION` 等有代码内置默认值，仓库没有配 Variables 也能跑通。
- 生产环境变量（`MYSQL_URL`、`ADMIN_PASS`、`CORS_ORIGINS`、`COS_*`）在**腾讯云 SCF 控制台**配置，
  清单见 `server/ENV.md`。仓库中不得出现连接串与密钥。

## 环境限制（已知）

- Trae 云端部署（一键部署插件）需要 `TRAE_PROJECT_ID`，当前沙箱环境不存在该变量，
  CLI 会返回 `MISSING_RUNTIME_CONTEXT`。此步骤只能在 Trae IDE 内触发；
  在沙箱内无法完成时要明确说明"该项被环境限制阻塞"，不能静默跳过。
- 生产后端是**腾讯云 SCF**：`https://1527498271-1pw3yw7nzz.ap-guangzhou.tencentscf.com/api`。
  `render.yaml` 是历史遗留的备用方案，`huimeng-ai-backend.onrender.com` 已不是线上地址。
- 本机沙箱限制：git 调凭据助手会走 `sh -c`，而 cygwin 建不了管道，**GCM / credential-store 全部失效**，
  所以认证用 `http.extraHeader`；PowerShell 的 `Invoke-WebRequest` 走 schannel 也会失败，
  探活请用 `node scripts/verify-live.js` 或 `scripts/publish.ps1`。`node` 不在 PATH 时用
  `C:\Users\30453\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`。

## 项目结构要点

- `frontend/` 是源码（index.html + app.js + ui.js + desk.js + styles.css ...）
- `deploy/index.html` 是构建出的单文件产物，GitHub Pages 部署它
- 修改 `frontend/` 后**必须**重新构建并提交 `deploy/`，否则线上不会更新
- `server/` 是后端源码，改动会触发 SCF 自动发布；纯前端改动不会碰后端
