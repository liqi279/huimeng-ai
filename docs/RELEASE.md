# 发布说明（唯一权威）

## 规则

同一份前端改动必须同时落到两处，两处内容完全一致（字节数与 md5 相同）：

1. **GitHub Pages**：提交 `deploy/` 目录产物到 `main`，Pages 工作流直接把 `deploy/` 打包发布，**不运行 `npm run build`**。
2. **CloudBase 静态托管**：把同一份 `deploy/` 文件同步到托管站点根目录。

## 禁止事项

- 不要只改 `frontend/` 就指望线上生效。`frontend/` 与 `scripts/build-deploy.js` 只是源码与本地预览工具，**不是发布链路的权威来源**。
- 不要在发布后运行构建脚本覆盖 `deploy/`；它会把 `frontend/` 的旧逻辑重新写入产物，导致线上修复回退。
- 不要只同步一处。Pages 与 CloudBase 必须同时更新。

## 发布步骤

1. 修改 `deploy/` 下的实际产物文件（如 `deploy/index.html`、`deploy/assets/hm-sNN-<hash>.js`）。
2. 提交并推送 `main`，等待 `Deploy to GitHub Pages` 工作流完成。
3. 同步同名文件到 CloudBase，核对两处的字节数与 md5。
4. 回读线上页面，确认引用的资源文件名与本次产物一致。
