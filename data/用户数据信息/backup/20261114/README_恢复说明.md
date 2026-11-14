# 绘梦 AI 云端数据备份（20261114）

数据来源：腾讯云 SCF 后端 `https://1527498271-1pw3yw7nzz.ap-guangzhou.tencentscf.com`（Render 已下线）。全程只读 GET，未改动云端业务数据。

## 文件清单
- `library-snapshot.json`：书库全量书目（公开接口 /api/library/books，含 COS 对象字节数）
- `works.json`：作品列表（/api/works，本次为空）
- `desk.json`：桌面布局
- `manifest.json`：各文件字节数与 SHA256

## 本次缺口
- `accounts.json` 未导出：管理员登录接口返回 401，`HM_ADMIN_PASS` 与线上口令不一致，账号清单需在口令更新后补导。
- 作品图片：本次作品列表为空，无图片需要下载。

## 恢复要点
1. 书目：按 `library-snapshot.json` 的 books[] 回灌 `huimeng_library.books`，PDF/封面按 pdfKey/coverKey 对应 COS 对象。
2. 桌面：`desk.json` 的 desk 字段走 `PUT /api/desk`。
3. 账号：口令恢复后重跑备份脚本补齐 accounts.json（salt/password_hash 只留本机，不推仓库）。
