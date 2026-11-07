#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ToonCrafter 真实推理服务（官方模型 + HTTP 接口）

直接复用官方仓库的 scripts/gradio/i2v_test_application.py 中的 Image2Video，
把「首帧 + 尾帧 → 中间动画视频」包成 HTTP 接口，供绘梦前端调用。

启动：
    cd 插件/09-ToonCrafter首尾帧补间/服务
    python server.py --port 7861

依赖：官方 requirements.txt + flask + flask-cors（见同目录 install.sh）
显存：512 分辨率约需 24G；256 约需 12G；1024 需 40G+
"""
import argparse
import os
import shutil
import sys
import threading
import time
import traceback
import uuid
from pathlib import Path

TOOL_DIR = Path(__file__).resolve().parent
REPO_DIR = TOOL_DIR.parent / "源码" / "ToonCrafter-main"
RESULT_DIR = REPO_DIR / "results"
CHECKPOINT_DIR = REPO_DIR / "checkpoints"

ALLOWED_RES = {"256_256", "320_512", "576_1024"}

# 官方实现使用相对路径（./configs、./checkpoints），必须在仓库根目录运行
os.chdir(REPO_DIR)
sys.path.insert(0, str(REPO_DIR))
sys.path.insert(1, str(REPO_DIR / "lvdm"))

import numpy as np
from PIL import Image
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

app = Flask(__name__, static_folder=None)
CORS(app, resources={r"/api/*": {"origins": "*"}}, expose_headers=["Content-Disposition"])

MODELS = {}
MODEL_LOCK = threading.Lock()
INFER_LOCK = threading.Lock()


def ckpt_ready(res: str) -> bool:
    return (CHECKPOINT_DIR / ("tooncrafter_%s_interp_v1" % res.split("_")[1]) / "model.ckpt").exists()


def get_model(res: str):
    """惰性加载并缓存各分辨率模型（首次会从 HuggingFace 拉取权重）。"""
    with MODEL_LOCK:
        if res not in MODELS:
            from scripts.gradio.i2v_test_application import Image2Video
            RESULT_DIR.mkdir(parents=True, exist_ok=True)
            MODELS[res] = Image2Video(result_dir=str(RESULT_DIR), gpu_num=1, resolution=res)
        return MODELS[res]


def read_rgb(file_storage) -> np.ndarray:
    img = Image.open(file_storage.stream).convert("RGB")
    return np.array(img, dtype=np.uint8)


@app.get("/api/health")
def health():
    info = {
        "ok": True,
        "service": "tooncrafter",
        "repo": str(REPO_DIR),
        "resolutions": sorted(ALLOWED_RES),
        "loaded": sorted(MODELS.keys()),
        "busy": INFER_LOCK.locked(),
        "device": "cpu",
        "gpu": None,
        "torch": None,
        "checkpoints": {r: ckpt_ready(r) for r in ALLOWED_RES},
    }
    try:
        import torch
        info["torch"] = torch.__version__
        if torch.cuda.is_available():
            info["device"] = "cuda"
            info["gpu"] = torch.cuda.get_device_name(0)
            info["vram_gb"] = round(torch.cuda.get_device_properties(0).total_memory / 1024 ** 3, 1)
    except Exception as exc:  # pragma: no cover
        info["torch_error"] = str(exc)
    return jsonify(info)


@app.post("/api/interpolate")
def interpolate():
    if "first" not in request.files or "last" not in request.files:
        return jsonify(ok=False, error="缺少首帧或尾帧文件（字段名 first / last）"), 400

    res = request.form.get("resolution", "320_512")
    if res not in ALLOWED_RES:
        return jsonify(ok=False, error="不支持的分辨率：%s" % res), 400

    try:
        steps = max(1, min(60, int(request.form.get("steps", 50))))
        cfg = max(1.0, min(15.0, float(request.form.get("cfg", 7.5))))
        eta = max(0.0, min(1.0, float(request.form.get("eta", 1.0))))
        fs = max(5, min(30, int(request.form.get("fs", 10))))
        seed = int(request.form.get("seed", 123))
        prompt = (request.form.get("prompt") or "an anime scene").strip()[:120]
    except ValueError as exc:
        return jsonify(ok=False, error="参数格式错误：%s" % exc), 400

    if not INFER_LOCK.acquire(blocking=False):
        return jsonify(ok=False, error="推理服务正忙，请稍后再试"), 429

    started = time.time()
    try:
        first = read_rgb(request.files["first"])
        last = read_rgb(request.files["last"])
        model = get_model(res)
        out = model.get_image(first, prompt, steps=steps, cfg_scale=cfg,
                              eta=eta, fs=fs, seed=seed, image2=last)
        # 官方按 prompt 命名，可能互相覆盖：转存为唯一文件名
        token = uuid.uuid4().hex[:12]
        final_name = "toon_%s.mp4" % token
        RESULT_DIR.mkdir(parents=True, exist_ok=True)
        shutil.move(out, str(RESULT_DIR / final_name))
        return jsonify(ok=True, video="/results/" + final_name,
                       elapsed=round(time.time() - started, 2),
                       resolution=res, steps=steps, fps=fs, seed=seed,
                       prompt=prompt, size=os.path.getsize(RESULT_DIR / final_name))
    except Exception as exc:  # pragma: no cover
        traceback.print_exc()
        return jsonify(ok=False, error="%s: %s" % (type(exc).__name__, exc)), 500
    finally:
        INFER_LOCK.release()


@app.get("/results/<path:name>")
def results(name):
    return send_from_directory(str(RESULT_DIR), name, conditional=True)


@app.post("/api/warmup")
def warmup():
    res = request.args.get("resolution", "320_512")
    if res not in ALLOWED_RES:
        return jsonify(ok=False, error="不支持的分辨率"), 400
    try:
        get_model(res)
        return jsonify(ok=True, loaded=sorted(MODELS.keys()))
    except Exception as exc:  # pragma: no cover
        traceback.print_exc()
        return jsonify(ok=False, error=str(exc)), 500


@app.get("/")
def index():
    return ("ToonCrafter 推理服务运行中\n"
            "GET  /api/health\n"
            "POST /api/interpolate  (multipart: first, last, prompt, steps, cfg, eta, fs, seed, resolution)\n"), 200


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=7861)
    ap.add_argument("--warmup", default="", help="启动时预加载分辨率，如 320_512")
    args = ap.parse_args()

    print("[ToonCrafter] 仓库：%s" % REPO_DIR)
    print("[ToonCrafter] 权重：%s" % CHECKPOINT_DIR)
    print("[ToonCrafter] 接口：http://%s:%d/api/health" % (args.host, args.port))
    if args.warmup:
        try:
            get_model(args.warmup)
            print("[ToonCrafter] 已预加载 %s" % args.warmup)
        except Exception:
            traceback.print_exc()
    app.run(host=args.host, port=args.port, threaded=True)


if __name__ == "__main__":
    main()
