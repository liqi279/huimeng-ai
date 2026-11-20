# 绘梦 AI 云端书馆数据备份（20261109）

来源：https://huimeng-ai-backend.onrender.com/api/library/books（公开只读 GET，未改动云端任何数据）。

## 本次范围说明
- 正常的账号/作品/桌面备份（run_backup.ps1）自 2026-11-08 晚起登录失败（admin 401，密码已变），
  本次仅完成「云端书馆」这一公开数据源的备份。
- 书馆为生产数据（8 本绘画教程，PDF/封面存于阿里云 OSS，经后端签名直链提供）。
- covers/：8 张封面原图。PDF 原文件仅存本机 pdfs/ 目录（多个 >100MB，超出 GitHub 单文件上限，无法入库）。

## 文件清单
- `library-books.json`：GET /api/library/books 完整响应（书目、页、toc、封面/PDF 直链、存储状态）
- `covers/`：封面原图（文件名与 OSS object 名一致）
- `pdfs/`：PDF 原文件（仅本机）
- `manifest.json`：全部文件相对路径、字节数、SHA256

## 恢复方法
1. PDF/封面：按 object 名回传阿里云 OSS 桶 `huimeng2-assets` 的 `library/books/` 与 `library/covers/` 路径。
2. 书目元数据：以 admin 登录后调用书馆管理接口按 `library-books.json` 逐条重建（id/title/author/category/tags/intro/accent/area/pages/toc/sortNo）。
3. 完整性核对：用 manifest.json 的字节数与 SHA256 校验每个文件。