# 环境变量清单

> 本文件只记录变量名与用途，**不记录任何真实值**。生产值在腾讯云 SCF 控制台的函数环境变量里配置；本地开发放在不入库的 `.env` / 终端环境里。仓库中不得出现连接串、密钥、密码、token。

## 运行时（SCF 函数 / 本地服务）

| 变量名 | 必填 | 用途 |
| --- | --- | --- |
| `MYSQL_URL` | 生产必填 | TiDB 连接串（含库名）。只在内存中使用，任何日志与接口都不得输出。缺失时书库会退化为 file 模式。 |
| `CORS_ORIGINS` | 生产建议显式设置 | 允许调用 API 的前端来源，逗号分隔，可多条。代码内有默认白名单；设为 `*` 仅限本地调试，切勿用于生产。 |
| `CORS_ORIGIN` | 可选 | 旧变量名，兼容用；同时存在时 `CORS_ORIGINS` 优先。 |
| `LIBRARY_UPLOAD_KEY` | 可选 | 书库上传接口的校验 key。不设置时上传接口按代码默认策略处理。 |
| `ADMIN_USER` | 可选 | 管理入口用户名（代码有内置默认值，生产建议显式覆盖）。 |
| `ADMIN_PASS` | 生产必设 | 管理入口密码（代码有内置默认值，生产必须覆盖为强口令）。 |
| `HM_ADMIN_PASS` | 可选 | 部署侧使用的管理密码别名，与 `ADMIN_PASS` 对应。 |
| `SCF_MODE` | 部署时设置 | 标识当前运行在 SCF 环境；影响启动与错误处理分支。 |
| `COS_BUCKET` | 使用对象存储时必填 | 对象存储桶名。 |
| `COS_REGION` | 使用对象存储时必填 | 对象存储地域。 |
| `COS_SECRET_ID` | 使用对象存储时必填 | 腾讯云 API SecretId；只从环境变量注入。 |
| `COS_SECRET_KEY` | 使用对象存储时必填 | 腾讯云 API SecretKey；只从环境变量注入，不打印、不写文件。 |
| `MYSQL_CONNECT_TIMEOUT_MS` | 可选 | MySQL 连接超时（毫秒），默认 5000。 |
| `LIBRARY_USAGE_TTL_MS` | 可选 | `usedBytes` 用量缓存 TTL（毫秒），默认 90000。 |
| `DATA_DIR` | 本地/自托管可选 | 运行数据目录（file 模式落盘位置）。 |
| `DATA_ROOT` | 本地/自托管可选 | 数据根目录。 |
| `FRONTEND_DIR` | 本地/自托管可选 | 前端静态文件目录。 |
| `COMFY_BASE` | 可选 | 本地 ComfyUI 服务地址（默认本机端口）。 |
| `OLLAMA_BASE` | 可选 | 本地 Ollama 服务地址（默认本机端口）。 |
| `HTTPS_PROXY` / `HTTP_PROXY` | 可选 | 出网代理（Edge TTS 等外部请求使用）。 |

## 部署与数据脚本（`server/scripts/*`）

| 变量名 | 必填 | 用途 |
| --- | --- | --- |
| `HM_GITHUB_TOKEN` | 部署/导出脚本必填 | GitHub Contents / Git Data API 提交用 token。只从环境变量读，不打印。 |
| `SCF_FUNCTION` | 可选 | SCF 函数名；脚本未设置时使用代码内置默认。 |
| `SCF_NAMESPACE` | 可选 | SCF 命名空间；脚本未设置时使用代码内置默认。 |
| `API_BASE` | 可选 | 脚本自检时请求的线上 API 基址；不设则用内置默认地址。 |
| `CLOUDBASE_ENV_ID` | 仅 CloudBase 发布时需要 | 云开发环境 ID，`web-deploy.js --cloudbase` 使用。 |
| `CLOUDBASE_DOMAIN` | 可选 | 覆盖 CloudBase 默认域名（绑定自定义域名后使用）。 |
| `CLOUDBASE_APPID` | 可选 | 用于推导 CloudBase 默认域名，默认从桶名解析。 |

## 约定

- 新增变量必须同步更新本文件（只写名字与用途）。
- 密钥类变量一律只通过环境变量注入，不入库、不写日志、不回显。
- 本地 `.env` 不提交；仓库里只保留下这份清单。
