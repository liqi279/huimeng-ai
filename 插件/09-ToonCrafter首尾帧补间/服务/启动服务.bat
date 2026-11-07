@echo off
cd /d "%~dp0"
title ToonCrafter 首尾帧补间 - 本地推理服务
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
  echo [1/2] 首次安装依赖，需要数 GB 下载，请耐心等待...
  %PY% -m venv .venv
  if errorlevel 1 goto FAIL
  call ".venv\Scripts\activate.bat"
  python -m pip install --upgrade pip
  python -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
  python -m pip install flask flask-cors ftfy regex tqdm einops omegaconf pandas imageio imageio-ffmpeg opencv-python-headless
  if errorlevel 1 goto FAIL
) else (
  call ".venv\Scripts\activate.bat"
)

echo.
echo [2/2] 启动服务: http://127.0.0.1:7861
echo 首次使用会自动下载模型权重，约数 GB
echo 浏览器打开 http://127.0.0.1:7861/api/health 可自检
echo.
python server.py --port 7861 --warmup 320_512
goto END

:FAIL
echo.
echo [失败] 依赖安装失败，请把本窗口报错内容截图反馈

:END
echo.
pause
