@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ============================================
echo  ToonCrafter 首尾帧补间 · 本地推理服务（Windows）
echo ============================================

where python >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 python，请先安装 Python 3.10 并加入 PATH
  pause
  exit /b 1
)

if not exist ".venv" (
  echo [1/2] 首次安装依赖（torch + 官方依赖，需数 GB 下载）...
  python -m venv .venv
  call .venv\Scripts\activate.bat
  python -m pip install --upgrade pip
  python -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
  python -m pip install flask flask-cors ftfy regex tqdm einops omegaconf pandas imageio imageio-ffmpeg opencv-python-headless
) else (
  call .venv\Scripts\activate.bat
)

echo [2/2] 启动推理服务：http://127.0.0.1:7861
echo 权重首次使用会自动从 HuggingFace 下载（约数 GB）
python server.py --port 7861 --warmup 320_512

pause
