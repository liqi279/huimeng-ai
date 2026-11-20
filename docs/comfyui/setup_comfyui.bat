@echo off
chcp 65001 >nul
title 绘梦AI · ComfyUI + Wan2.1 一键安装脚本
echo ============================================
echo   ComfyUI + Wan2.1 开源视频模型 一键安装
echo   绘梦AI动漫创作平台 · 本地免费无限跑视频
echo ============================================
echo.

REM === 前置检查 ===
echo [1/6] 检查前置依赖...
where git >nul 2>nul
if %errorlevel% neq 0 (
  echo ❌ 未检测到 Git！请先安装 https://git-scm.com/download/win
  pause & exit /b 1
)
echo   ✅ Git 已安装

where python >nul 2>nul
if %errorlevel% neq 0 (
  echo ❌ 未检测到 Python！请先安装 https://www.python.org/downloads/ （勾选 Add to PATH）
  pause & exit /b 1
)
echo   ✅ Python 已安装

where nvidia-smi >nul 2>nul
if %errorlevel% neq 0 (
  echo ❌ 未检测到 NVIDIA 显卡驱动！请先安装显卡驱动
  pause & exit /b 1
)
echo   ✅ NVIDIA 显卡可用
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader
echo.

REM === 选择安装目录 ===
set /p COMFY_DIR="安装目录（回车默认 D:\ComfyUI）: "
if "%COMFY_DIR%"=="" set COMFY_DIR=D:\ComfyUI

if exist "%COMFY_DIR%\ComfyUI" (
  echo ⚠️ 检测到已存在 %COMFY_DIR%\ComfyUI
  set /p UPDATE="更新现有版本？(y/N): "
  if /i not "%UPDATE%"=="y" (
    echo 已取消。
    pause & exit /b 0
  )
) else (
  echo [2/6] 下载 ComfyUI...
  git clone https://github.com/comfyanonymous/ComfyUI.git "%COMFY_DIR%\ComfyUI" || (
    echo ❌ ComfyUI clone 失败，检查网络
    pause & exit /b 1
  )
  echo   ✅ ComfyUI 已下载
)

cd /d "%COMFY_DIR%\ComfyUI"

echo [3/6] 创建 Python 虚拟环境并安装依赖...
if not exist venv (
  python -m venv venv
)
call venv\Scripts\activate.bat

REM 自动 pip install 并处理镜像源问题
pip install --upgrade pip -i https://pypi.tuna.tsinghua.edu.cn/simple
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple || (
  echo ⚠️ 清华镜像源失败，换用官方源重试...
  pip install -r requirements.txt
)
echo   ✅ 依赖安装完成

REM === 下载模型 ===
echo.
echo [4/6] 下载 Wan2.1 模型（首次约 15–30 GB，耐心等待）

REM 创建目录结构
if not exist models\diffusion_models mkdir models\diffusion_models
if not exist models\text_encoders mkdir models\text_encoders
if not exist models\vae mkdir models\vae
if not exist models\clip_vision mkdir models\clip_vision

REM 下载函数：有 aria2 就用 aria2c（并行加速），没有就 curl
where aria2c >nul 2>nul
if %errorlevel% equ 0 (
  set DL=aria2c -c -x 16 -s 16 -k 1M -o
) else (
  echo 💡 建议安装 aria2 加速下载: https://aria2.github.io/
  set DL=curl -L -o
)

echo   📦 文生视频扩散模型 (1.3B FP16, ~2.6GB)...
%DL% models\diffusion_models\wan2.1_t2v_1.3B_fp16.safetensors^
  https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/wan2.1_t2v_1.3B_fp16.safetensors

echo   📦 图生视频扩散模型 (14B 480P FP16, ~28GB)...
set /p I2V480="下载 14B 480P 图生模型？(y/N): "
if /i "%I2V480%"=="y" (
  %DL% models\diffusion_models\wan2.1_i2v_480p_14B_fp16.safetensors^
    https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/wan2.1_i2v_480p_14B_fp16.safetensors
) else (
  echo   ⏭️ 跳过 14B 480P
)

echo   📦 图生视频扩散模型 (14B 720P FP16, ~28GB)...
set /p I2V720="下载 14B 720P 图生模型？(y/N): "
if /i "%I2V720%"=="y" (
  %DL% models\diffusion_models\wan2.1_i2v_720p_14B_fp16.safetensors^
    https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/wan2.1_i2v_720p_14B_fp16.safetensors
) else (
  echo   ⏭️ 跳过 14B 720P
)

echo   📦 文本编码器 umt5_xxl (FP8, ~10GB)...
%DL% models\text_encoders\umt5_xxl_fp8_e4m3fn_scaled.safetensors^
  https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors

echo   📦 Wan2.1 VAE (~400MB)...
%DL% models\vae\wan_2.1_vae.safetensors^
  https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors

echo   📦 CLIP Vision (~2.6GB, 图生视频需要)...
%DL% models\clip_vision\clip_vision_h.safetensors^
  https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/clip_vision/clip_vision_h.safetensors

echo   ✅ 模型下载完成
echo.

REM === 安装 ComfyUI Manager ===
echo [5/6] 安装 ComfyUI Manager (插件管理器)...
if not exist custom_nodes\ComfyUI-Manager (
  git clone https://github.com/ltdrdata/ComfyUI-Manager.git custom_nodes\ComfyUI-Manager
  echo   ✅ ComfyUI-Manager 已安装
) else (
  echo   ✅ ComfyUI-Manager 已存在
)

echo.
echo [6/6] 准备工作流 JSON...
if not exist user\default\workflows mkdir user\default\workflows
copy /y "%~dp0wan2.1_t2v_1.3B.json" user\default\workflows\wan2.1_t2v_1.3B.json >nul
copy /y "%~dp0wan2.1_i2v_14B_480P.json" user\default\workflows\wan2.1_i2v_14B_480P.json >nul
echo   ✅ 工作流已复制到 ComfyUI user\default\workflows\

echo.
echo ============================================
echo   🎉 安装完成！
echo ============================================
echo.
echo 启动 ComfyUI:
echo   cd /d "%COMFY_DIR%\ComfyUI"
echo   run_nvidia_gpu.bat
echo.
echo 启动后:
echo   1. 浏览器打开 http://127.0.0.1:8188
echo   2. 菜单 Load → user → default → workflows → wan2.1_t2v_1.3B.json
echo      或 wan2.1_i2v_14B_480P.json
echo   3. 改提示词 → 点 Queue Prompt 运行
echo.
echo 显存要求:
echo   1.3B 文生视频 - 最低 6GB，推荐 8GB+
echo   14B 图生视频 - 最低 12GB，推荐 16GB+
echo.
pause
