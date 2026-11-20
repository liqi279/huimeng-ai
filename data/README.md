# 数据data

本项目**所有数据文件**统一收拢到本目录，按用途分文件夹管理。
代码只从这里读写数据，不再散落在仓库各处。

```
data/
├─ README.md                 本说明
├─ library/                  图书馆
│  ├─ books.seed.json        书籍种子数据（唯一数据源，提交到 Git）
│  ├─ books.json             运行时书籍库（首次启动由种子生成，不提交）
│  ├─ favorites.json         运行时收藏（不提交）
│  └─ reading-history.json   运行时阅读进度 / 历史（不提交）
├─ mysql/                    图书馆 MySQL 数据库
│  ├─ schema.sql             建库建表（books / book_pages / book_favorites /
│  │                        reading_history / search_terms）
│  ├─ my.cnf                 InnoDB 表空间上限 500G 的配置
│  ├─ docker-compose.yml     本地一键起 MySQL 8
│  ├─ import-seed.js         把 books.seed.json 导入 MySQL
│  ├─ init-library.sh        一键初始化（建表 + 导入）
│  └─ data/                  MySQL 物理数据目录（运行时生成，不提交）
├─ runtime/                  服务端运行时数据（原 server/data，已整体迁移）
│  ├─ users.json             账号
│  ├─ users/                 用户私有数据
│  ├─ media/                 生成的图片 / 视频 / 音频
│  ├─ assets/                 资产库文件
│  ├─ projects.json          项目
│  └─ cert/                  本地 HTTPS 自签证书（含私钥，不提交）
└─ config/                   配置与密钥类文本
   └─ 视频api密钥（则灵平台）.txt
```

## 一、图书馆数据怎么存

- **有 MySQL（推荐）**：后端 `LIBRARY_STORE=mysql`，书籍、内页、收藏、阅读历史、
  搜索热词全部落在 MySQL 的 `huimeng_library` 库。
- **没有 MySQL**：自动回退到 `data/library/*.json` 文件存储，接口行为完全一致，
  前端不需要改。
- **纯静态页面（GitHub Pages）**：构建时把 `books.seed.json` 内联进单文件 HTML，
  并配合浏览器 localStorage，书架、翻页、收藏、历史、增删改查都能正常演示。

## 二、关于 500G 存储

MySQL 不会在启动时预占 500G 磁盘，而是**按需增长**。`my.cnf` 里配置的是上限：

```ini
innodb_data_file_path = ibdata1:12M:autoextend:max:500G
innodb_autoextend_increment = 64
innodb_file_per_table = ON
```

即：共享表空间从 12M 起步，每次扩 64M，最大可增长到 500G；
开启独立表空间后，每张表也能独立扩容。数据库实际占用随书籍数量增长。

## 三、本地启用 MySQL

```bash
# 方式 A：Docker（推荐）
cd data/mysql
docker compose up -d          # 首次会自动执行 schema.sql

# 方式 B：本机已装 MySQL 8
cp data/mysql/my.cnf /etc/mysql/conf.d/huimeng-library.cnf
sudo systemctl restart mysql
cd data/mysql && MYSQL_USER=root ./init-library.sh

# 导入种子书籍（两种方式都需要）
cd data/mysql && node import-seed.js
```

然后在 `server/` 启动时带上环境变量：

```bash
LIBRARY_STORE=mysql \
MYSQL_HOST=127.0.0.1 MYSQL_PORT=3306 \
MYSQL_USER=huimeng MYSQL_PASSWORD=huimeng_lib_2026 \
MYSQL_DATABASE=huimeng_library \
npm start
```

验证：

```bash
curl http://127.0.0.1:8787/api/library/stats
# { "mode": "mysql", "storageLimit": "500G", "books": 10, ... }
```

## 四、接口（增删改查）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/library/books?q=&category=` | 书籍列表 / 搜索 |
| GET | `/api/library/suggest?q=` | 搜索下拉推荐 |
| GET | `/api/library/books/:id` | 书籍详情（含页、收藏、进度） |
| POST | `/api/library/books` | 新增书籍 |
| PUT | `/api/library/books/:id` | 编辑书籍 |
| DELETE | `/api/library/books/:id` | 删除书籍 |
| GET | `/api/library/favorites` | 收藏列表 |
| POST/DELETE | `/api/library/favorites` `/favorites/:bookId` | 收藏 / 取消 |
| GET | `/api/library/history` | 阅读历史（含上次页码） |
| POST | `/api/library/progress` | 保存阅读进度 |
| GET | `/api/library/stats` | 存储模式 / 容量 / 统计 |

未登录时用请求头 `x-library-user` 区分本地用户（前端会自动生成一个 guest 标识）。

## 五、注意事项

- `data/runtime/cert/`（含私钥）、`data/mysql/data/`（物理数据）、
  运行时生成的 `books.json` / `favorites.json` / `reading-history.json`
  已加入 `.gitignore`，避免把密钥与二进制数据提交到 Git。
- `data/config/` 存放 API 密钥等敏感配置，同样不提交到仓库，仅保留在本地。
- 迁移前的 `server/data/` 已删除，`server/src/config.js` 的 `DATA_DIR`
  默认指向 `data/runtime`，接口与文件读写不受影响。
