# server（绘梦后端）

## 发布 / 回滚脚本：`scripts/scf-deploy.js`

一键发布（取快照 → 打包 → 上传 COS → 更新 SCF 函数 → 五步自检）：

```bash
node server/scripts/scf-deploy.js
```

只预览、不动线上（安全开关默认都是「不执行」）：

```bash
node server/scripts/scf-deploy.js --prune-only      # 只打印将被清理的历史快照，不删除、不发布
node server/scripts/scf-deploy.js --prune-dry-run   # 正常发布，但快照清理只打印、不删除
node server/scripts/scf-deploy.js --check-only      # 只跑线上五步自检，不发布
node server/scripts/scf-deploy.js --skip-pack       # 复用 dist/huimeng-scf.zip，不重新打包
```

回滚（默认最近一份快照）：

```bash
node server/scripts/scf-deploy.js --rollback
node server/scripts/scf-deploy.js --rollback scf/releases/20261111-011500.zip
```

### 环境变量

脚本只从环境变量读取配置，不读任何硬编码密钥；**必需的密钥缺失时会直接报错退出**，不打印、不写盘。

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `COS_SECRET_ID` / `COS_SECRET_KEY`（或 `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`） | 是 | 腾讯云 API 密钥；缺失时启动即报错 |
| `COS_BUCKET` / `COS_REGION` | 否 | 默认 `huimeng-1527498271` / `ap-guangzhou` |
| `SCF_FUNCTION` / `SCF_NAMESPACE` | 否 | 默认 `huimeng-api` / `default` |
| `SCF_CODE_KEY` | 否 | 函数代码包在 COS 的 key，默认 `scf/huimeng-scf.zip` |
| `SCF_KEEP_RELEASES` | 否 | 历史快照保留份数，默认 3（非法值按 3 处理） |
| `API_BASE` / `FRONTEND_BASE` | 否 | 自检与前端指纹探测地址 |
| `BACKUP_ROOT` / `EXPECT_BOOKS` | 否 | 备份根目录 / 书库自检期望数量 |

数据库快照读取函数环境变量里的 `MYSQL_URL`（只在内存中使用，不输出）。

### 安全约定

- `--prune-only` 只演练不删除；`--prune-dry-run` 用于正式发布时同样只打印。
- 快照清理只保留最近 `SCF_KEEP_RELEASES` 份，本次刚生成的快照与当前代码包始终受保护。
- 删除快照失败只告警，不中断发布。
