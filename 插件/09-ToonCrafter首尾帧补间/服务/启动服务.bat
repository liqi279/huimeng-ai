@echo off
cd /d "%~dp0"
title ToonCrafter 首尾帧补间 - 本地推理服务
echo 版本 2026-11-07 · 走代理下载模式
echo ============================================
echo  ToonCrafter 首尾帧补间 本地推理服务
echo ============================================
echo.

rem ===== 代理配置：端口不同就改这一行（也支持先设置系统 HTTP_PROXY 环境变量）=====
set "PROXY=http://127.0.0.1:7890"
if defined HTTP_PROXY set "PROXY=%HTTP_PROXY%"
if defined HTTPS_PROXY set "PROXY=%HTTPS_PROXY%"

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

rem 依赖与模型权重全部走代理
set "HTTP_PROXY=%PROXY%"
set "HTTPS_PROXY=%PROXY%"
set "ALL_PROXY=%PROXY%"
set "http_proxy=%PROXY%"
set "https_proxy=%PROXY%"
set "all_proxy=%PROXY%"
set "PIP_PROXY=%PROXY%"
set "NO_PROXY=localhost,127.0.0.1"
set "no_proxy=localhost,127.0.0.1"
set "PIP_DISABLE_PIP_VERSION_CHECK=1"

echo [提示] 依赖下载将走代理 %PROXY%
echo [提示] 若端口不一致，编辑本脚本开头的 PROXY 变量
where curl >nul 2>nul && (
  curl -s -m 8 -x %PROXY% https://pypi.org/simple/ -o nul
  if errorlevel 1 echo [警告] 代理连通性检查失败，请确认代理软件已启动且端口正确
)
echo.

set NEED_INSTALL=0
python -c "import torch, flask, flask_cors" >nul 2>nul || set NEED_INSTALL=1
if "%NEED_INSTALL%"=="1" (
  echo [2/3] 安装依赖，首次需下载数 GB，请耐心等待...
  python -m pip install --upgrade pip --timeout 60
  python -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121 --timeout 120
  if errorlevel 1 (
    echo [提示] 官方源失败，改用阿里云镜像...
    python -m pip install torch torchvision --index-url https://mirrors.aliyun.com/pytorch-wheels/cu121 --timeout 120
  )
  if errorlevel 1 goto FAIL
  python -m pip install flask flask-cors ftfy regex tqdm einops omegaconf pandas imageio imageio-ffmpeg opencv-python-headless --timeout 60
  if errorlevel 1 goto FAIL
) else (
  echo [2/3] 依赖已就绪，跳过安装
)

echo.
echo [3/3] 启动服务: http://127.0.0.1:7861
echo 首次使用会自动下载模型权重，约数 GB，同样走代理
echo 浏览器打开 http://127.0.0.1:7861/api/health 可自检
echo.
python server.py --port 7861 --warmup 320_512
goto END

:FAIL
echo.
echo [失败] 依赖安装失败，请把本窗口的报错截图反馈
echo 代理模式下请确认：代理软件已启动、PROXY 端口与软件一致

:END
echo.
pause
