#!/usr/bin/env bash
# 绘梦 AI 后端 OCI 一键部署脚本
# 适用：Oracle Cloud Infrastructure Always-Free Ubuntu 22.04/24.04
# 用法：在 OCI VM 上以 root 执行：
#   bash <(curl -fsSL https://raw.githubusercontent.com/liqi279/huimeng-ai/main/scripts/deploy-oci.sh)
# 或手动：
#   git clone https://github.com/liqi279/huimeng-ai.git /opt/huimeng-ai
#   cd /opt/huimeng-ai && bash scripts/deploy-oci.sh

set -e

APP_NAME="huimeng-ai"
APP_DIR="/opt/${APP_NAME}"
USER_HOME="$HOME"

echo "=========================================="
echo " 绘梦 AI - OCI 一键部署"
echo "=========================================="

# ---- 1. 系统包 ----
echo "[1/6] 更新系统 + 装基础工具..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl wget git nginx ufw certbot python3-certbot-nginx unzip jq 2>&1 | tail -3

# ---- 2. Node.js 22 ----
echo "[2/6] 安装 Node.js 22 + PM2..."
if ! command -v node &>/dev/null || [[ "$(node -v)" != v2[0-9].* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi
npm install -g pm2 2>/dev/null || true
node -v && npm -v && pm2 -v

# ---- 3. 拉代码 + 装依赖 ----
echo "[3/6] 拉代码 + 装依赖..."
if [[ -d "$APP_DIR/.git" ]]; then
  cd "$APP_DIR"
  git pull origin main
else
  rm -rf "$APP_DIR"
  git clone https://github.com/liqi279/huimeng-ai.git "$APP_DIR"
fi
cd "$APP_DIR/server"
npm install --omit=dev 2>&1 | tail -2

# data 目录给 node 进程读写权限（PM2 用 root 跑，或 deploy 用户）
mkdir -p data/users data/media data/assets
chmod -R 755 data

# ---- 4. PM2 启动后端 ----
echo "[4/6] PM2 守护后端..."
cd "$APP_DIR/server"
pm2 delete huimeng-backend 2>/dev/null || true
pm2 start src/index.js --name huimeng-backend --node-args="--max-old-space-size=512" \
  -- --PORT 8787 --HTTPS off
pm2 save
pm2 startup systemd -u "$(whoami)" --hp "$HOME" 2>/dev/null || true
sleep 2
curl -sf http://127.0.0.1:8787/api/health && echo "✅ 后端健康检查 OK" || { echo "❌ 后端启动失败"; pm2 logs huimeng-backend --lines 30; exit 1; }

# ---- 5. Nginx 反向代理 ----
echo "[5/6] Nginx 反代配置..."
PUBLIC_IP=$(curl -sf https://checkip.amazonaws.com || curl -sf https://icanhazip.com || echo "X.X.X.X")
cat > /etc/nginx/sites-available/huimeng <<NGINX
# 绘梦 AI OCI 反代
server {
  listen 80 default_server;
  server_name _;

  # 后端 API
  location /api/ {
    proxy_pass http://127.0.0.1:8787/api/;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_read_timeout 180s;
    proxy_send_timeout 180s;
  }

  # /uploads 静态资源（data/media）
  location /uploads/ {
    alias ${APP_DIR}/server/data/;
    access_log off;
    expires 7d;
  }

  # 默认首页：给个部署说明（前端 GitHub Pages 单独托管）
  location / {
    return 200 '绘梦 AI 后端 OK - 前端在 https://liqi279.github.io/huimeng-ai/';
    add_header Content-Type text/plain;
  }
}
NGINX
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/huimeng /etc/nginx/sites-enabled/huimeng
nginx -t && systemctl restart nginx
echo "✅ Nginx 已配置 http://${PUBLIC_IP}/api/health"

# ---- 6. 防火墙 ----
echo "[6/6] 配置 UFW 防火墙..."
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable 2>/dev/null || true

echo ""
echo "=========================================="
echo " 部署完成 ✅"
echo "=========================================="
echo "  后端 API:   http://${PUBLIC_IP}/api"
echo "  前端页面:   https://liqi279.github.io/huimeng-ai/"
echo "  PM2 日志:   pm2 logs huimeng-backend"
echo "  重启后端:   pm2 restart huimeng-backend"
echo "  Nginx 日志: journalctl -u nginx -f"
echo ""
echo "下一步："
echo "  1) 在 GitHub Pages 前端 config 里把 autoBase 改成 http://${PUBLIC_IP}/api"
echo "  2) 买个域名 + DNS 指到 ${PUBLIC_IP}，然后 certbot --nginx -d 你的域名"
echo "  3) OCI 控制台：安全列表必须放行 22 / 80 / 443"
echo "=========================================="
