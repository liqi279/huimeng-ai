#!/usr/bin/env bash
# ToonCrafter 推理服务安装（Linux / WSL / macOS，需 NVIDIA GPU）
set -e

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$HERE/../源码/ToonCrafter-main"

echo "==> 1/4 创建虚拟环境"
python3 -m venv "$HERE/.venv"
# shellcheck disable=SC1091
source "$HERE/.venv/bin/activate"

echo "==> 2/4 安装 PyTorch（CUDA 12.1，可按显卡驱动调整）"
pip install --upgrade pip
pip install torch==2.1.0 torchvision==0.16.0 --index-url https://download.pytorch.org/whl/cu121

echo "==> 3/4 安装官方依赖 + HTTP 服务依赖"
pip install -r "$REPO/requirements.txt"
pip install flask flask-cors pillow

echo "==> 4/4 准备权重目录"
mkdir -p "$REPO/checkpoints/tooncrafter_512_interp_v1" \
         "$REPO/checkpoints/tooncrafter_256_interp_v1" \
         "$REPO/checkpoints/tooncrafter_1024_interp_v1"
echo "   首次推理会自动从 HuggingFace(Doubiiu/ToonCrafter) 下载对应权重"
echo "   也可手动：huggingface-cli download Doubiiu/ToonCrafter model.ckpt \\"
echo "                --local-dir $REPO/checkpoints/tooncrafter_512_interp_v1"

echo
echo "安装完成。启动服务："
echo "  source \"$HERE/.venv/bin/activate\" && python \"$HERE/server.py\" --port 7861"
