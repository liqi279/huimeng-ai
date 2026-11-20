# 绘梦 AI 云端数据本地备份说明

本目录由 run_backup.ps1 自动生成，数据来自线上后端（只读 GET/HEAD，未改动线上任何数据）。

## 文件清单
- `accounts.json`：账号清单（GET /api/auth/users，不含密码哈希）
- `export.json`：官方导出（GET /api/user-data/export，含 works/docs/assets/storageStatus）
- `bootstrap.json`：前端首屏同步包（GET /api/user-data/bootstrap）
- `works.json`：作品列表（GET /api/works 分页取全，仅未删除项）
- `desk.json`：桌面布局（GET /api/desk）
- `user-data-status.json`：存储状态与用量（GET /api/user-data/status）
- `images/`：图片二进制（内联 base64 已解码；资产图来自 /api/user-data/assets/<id>）
- `images-index.json`：每张图的来源、HTTP 状态、字节数、SHA256
- `manifest.json`：全部文件相对路径、字节数、SHA256、抓取结果

## 导回本地 MySQL
1. 先执行仓库里的 `data/用户数据信息/huimeng_users.sql`、`huimeng_user_data.sql` 建表。
2. 账号：`accounts.json` 无密码哈希，需重建账号（POST /api/auth/users）或从旧库 dump。
3. 作品：用 `export.json` 的 `works` 写入 `user_works`（id / owner_id / data / rev / deleted / updated_at）；
   `deleted=true` 为墓碑，可按需丢弃。也可用 `POST /api/works` 逐条回灌。
4. 桌面：`docs` 中 `kind='desk'` 写入 `user_documents`，或 `PUT /api/desk`。
5. `user-data-status.json` 仅作快照参考，无需导入。

## 图片挂回
- 有 assetId 的图：上传到自己的 S3/OSS 后改 `data.url` 与 `asset_key`；或调用 `POST /api/works/<workId>/asset` 让服务端回填。
- 内联缩略图：把文件转回 `data:image/jpeg;base64,...` 塞回 `work.thumb` 即可。
- `images-index.json` 中 `kind=external-link` 且 http 非 200 的，原图已失效，只能靠本机浏览器残留找回。

## 重复执行
设置 `$env:HM_ADMIN_PASS` 后运行 `run_backup.ps1`；每次生成新的日期目录，不覆盖旧备份。