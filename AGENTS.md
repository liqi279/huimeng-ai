# 交付规则（每次改动都必须遵守）

每次完成任何代码/需求/bug 修复后，**必须自动执行以下全部步骤，不要等用户提醒**：

1. 语法检查：`node --check frontend/app.js`（以及本次改动的其它 js）
2. 构建产物：`npm run build`（生成 `deploy/index.html` 与根目录 `绘梦AI动漫创作平台.html`）
3. 提交：`git add` 本次改动涉及的前端源码 + 两个构建产物，提交信息写清"改了什么/为什么"
4. 推送：`git push origin main`（已配置 SSH Deploy Key，无需 token）
5. 等待约 60–90 秒后验证 GitHub Pages 已更新：`curl -s --compressed "https://liqi279.github.io/huimeng-ai/?cb=<时间戳>"`，用关键字校验本次改动确实在线上
6. 在回复末尾固定给出三行信息：
   - GitHub 仓库：https://github.com/liqi279/huimeng-ai
   - 本次 commit：<短 hash + 标题>（已推送到 main）
   - 前端页面：https://liqi279.github.io/huimeng-ai/

## 环境限制（已知）

- Trae 云端部署（一键部署插件）需要 `TRAE_PROJECT_ID`，当前沙箱环境不存在该变量，
  CLI 会返回 `MISSING_RUNTIME_CONTEXT`。此步骤只能在 Trae IDE 内触发；
  在沙箱内无法完成时要明确说明"该项被环境限制阻塞"，不能静默跳过。
- 前端线上产物以 GitHub Pages 为准；后端为 Render（https://huimeng-ai-backend.onrender.com/api）。

## 项目结构要点

- `frontend/` 是源码（index.html + app.js + ui.js + desk.js + styles.css ...）
- `deploy/index.html` 是构建出的单文件产物，GitHub Pages 部署它
- 修改 `frontend/` 后**必须** `npm run build` 并提交 `deploy/`，否则线上不会更新
