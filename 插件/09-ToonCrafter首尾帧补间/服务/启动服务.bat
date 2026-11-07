@echo off
cd /d "%~dp0"
title ToonCrafter 首尾帧补间 - 本地推理服务
echo 版本 2026-11-07 · 修复代理导致的依赖安装失败
echo ============================================
echo  ToonCrafter 首尾帧补间 本地推理服务
echo ============================================
echo.

set PY=
where py >nul 2>nul && set PY=py -3
if not defined PY (
  where python >nul 2>nul && set PY=python
)
if not defined PY (
  echo [错误] 未找到 Python，请先安装 Python 3.10 并勾选 Add to PATH
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo [1/3] 创建虚拟环境...
  %PY% -m venv .venv
  if errorlevel 1 goto FAIL
)
call ".venv\Scripts\activate.bat"

rem 清除失效代理，避免 pip 卡在 ProxyError；并改用国内镜像下载
if defined HTTP_PROXY echo [提示] 检测到系统代理 %HTTP_PROXY%，本次安装将忽略它
set "HTTP_PROXY="
set "HTTPS_PROXY="
set "ALL_PROXY="
set "http_proxy="
set "https_proxy="
set "all_proxy="
set "PIP_PROXY="
set "NO_PROXY=*"
set "no_proxy=*"
set "PIP_INDEX_URL="
set "PIP_EXTRA_INDEX_URL="
set "PIP_DISABLE_PIP_VERSION_CHECK=1"

set NEED_INSTALL=0
python -c "import torch, flask, flask_cors" >nul 2>nul || set NEED_INSTALL=1
if "%NEED_INSTALL%"=="1" (
  echo [2/3] 安装依赖，首次需下载数 GB，请耐心等待...
  python -m pip install --upgrade pip -i https://pypi.tuna.tsinghua.edu.cn/simple --timeout 60
  python -m pip install torch torchvision --index-url https://mirrors.aliyun.com/pytorch-wheels/cu121 --timeout 120
  if errorlevel 1 (
    echo [提示] 国内镜像不可用，改用 PyTorch 官方源...
    python -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121 --timeout 120
  )
  if errorlevel 1 goto FAIL
  python -m pip install flask flask-cors ftfy regex tqdm einops omegaconf pandas imageio imageio-ffmpeg opencv-python-headless -i https://pypi.tuna.tsinghua.edu.cn/simple --timeout 60
  if errorlevel 1 goto FAIL
) else (
  echo [2/3] 依赖已就绪，跳过安装
)

echo.
echo [3/3] 启动服务: http://127.0.0.1:7861
echo 首次使用会自动下载模型权重，约数 GB
echo 浏览器打开 http://127.0.0.1:7861/api/health 可自检
echo.
python server.py --port 7861 --warmup 320_512
goto END

:FAIL
echo.
echo [失败] 依赖安装失败，请把本窗口的报错截图反馈
echo 若你的网络必须走代理，请先启动代理软件，再重新双击本脚本

:END
echo.
pause
