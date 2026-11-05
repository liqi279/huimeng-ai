#!/usr/bin/env bash
# =============================================================
# 绘梦 · 图书馆 MySQL 一键初始化（本地 / 单机）
# 步骤：1) 建库建表  2) 导入书籍种子数据
# =============================================================
set -euo pipefail

cd "$(dirname "$0")"

MYSQL_HOST="${MYSQL_HOST:-127.0.0.1}"
MYSQL_PORT="${MYSQL_PORT:-3306}"
MYSQL_USER="${MYSQL_USER:-root}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-}"

echo "==> 1/2 建库建表"
if [ -n "$MYSQL_PASSWORD" ]; then
  mysql -h "$MYSQL_HOST" -P "$MYSQL_PORT" -u "$MYSQL_USER" -p"$MYSQL_PASSWORD" < schema.sql
  export MYSQL_HOST MYSQL_PORT MYSQL_USER MYSQL_PASSWORD
  MYSQL_PASSWORD="$MYSQL_PASSWORD" node import-seed.js
else
  mysql -h "$MYSQL_HOST" -P "$MYSQL_PORT" -u "$MYSQL_USER" < schema.sql
  MYSQL_HOST="$MYSQL_HOST" MYSQL_PORT="$MYSQL_PORT" MYSQL_USER="$MYSQL_USER" node import-seed.js
fi

echo "==> 完成。后端启动时设置："
echo "    LIBRARY_STORE=mysql"
echo "    MYSQL_HOST=$MYSQL_HOST MYSQL_PORT=$MYSQL_PORT MYSQL_USER=$MYSQL_USER MYSQL_DATABASE=huimeng_library"
