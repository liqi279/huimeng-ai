#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
detect_blender.py — 本地 Blender 安装位置与版本的 JSON 数据处理
================================================================

自研平台接入前，用本脚本探测本机 Blender：
- 自动发现安装位置（按 OS + 环境变量 + 常见路径 + 手动覆盖）
- 解析版本（运行 `blender --version`，匹配 hook.json 的 version.regex）
- 可选：把桥接插件自动安装/启用进 Blender
- 输出对齐 hook.json 的 blender.output 结构，方便平台直接消费

用法：
    python3 detect_blender.py                     # 自动探测，输出 JSON
    python3 detect_blender.py --path /usr/bin/blender   # 手动指定
    python3 detect_blender.py --json file.json    # 读入上次结果做增量判断
    python3 detect_blender.py --install           # 探测 + 安装插件
    python3 detect_blender.py --check-only        # 只判断是否满足 min_version
"""
import argparse
import glob
import json
import os
import platform
import re
import shutil
import subprocess
import sys

VERSION_REGEX = re.compile(
    r"^Blender[\s]+(?P<major>\d+)\.(?P<minor>\d+)\.(?P<patch>\d+)"
    r"(?:[\s]+(?P<edition>[A-Za-z]+))?"
)
MIN_VERSION = (3, 6, 0)
MAX_VERSION = None  # 不设上限

BRIDGE_FOLDER = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "addon"))


def _home():
    return os.path.expanduser("~")


def _expand(path):
    path = os.path.expandvars(os.path.expanduser(path))
    return path


def _candidates():
    sysname = platform.system()
    cands = []
    if sysname == "Linux":
        cands += ["/usr/bin/blender", "/usr/local/bin/blender",
                  "/snap/bin/blender", "/opt/blender*/blender",
                  "/opt/blender-*/blender", "~/.local/bin/blender",
                  "/opt/Blender*/blender"]
        for p in glob.glob(_home() + "/Downloads/blender*.AppImage"):
            cands.append(p)
        for p in glob.glob(_home() + "/Desktop/blender*.AppImage"):
            cands.append(p)
    elif sysname == "Darwin":
        cands += ["/Applications/Blender.app/Contents/MacOS/Blender",
                  "~/Applications/Blender.app/Contents/MacOS/Blender",
                  "/Applications/Blender-*/Blender.app/Contents/MacOS/Blender"]
    elif sysname == "Windows":
        prog = os.environ.get("ProgramFiles", r"C:\Program Files")
        lp = os.environ.get("LOCALAPPDATA", _home() + r"\AppData\Local")
        pfx = os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
        cands += [prog + r"\Blender Foundation\Blender *\blender.exe",
                  lp + r"\Programs\Blender Foundation\Blender *\blender.exe",
                  pfx + r"\Blender Foundation\Blender *\blender.exe"]
    else:
        cands += ["blender"]
    return cands


def _globify(path):
    if any(ch in path for ch in "*?["):
        hits = sorted(glob.glob(_expand(path)))
        return hits[0] if hits else None
    p = _expand(path)
    return p if os.path.isfile(p) else None


def _resolve_path(manual=None, json_file=None):
    """优先级：json_file 中的 path -> manual -> env -> 常见路径 -> which/where"""
    from_json = None
    if json_file and os.path.isfile(json_file):
        try:
            with open(json_file, "r", encoding="utf-8") as f:
                from_json = json.load(f).get("blender", {}).get("path")
        except Exception:
            from_json = None

    if from_json and os.path.isfile(from_json):
        return from_json, "json"
    if manual and os.path.isfile(manual):
        return os.path.abspath(manual), "manual"
    for envk in ("BLENDER_PATH", "BLENDER_EXE"):
        v = os.environ.get(envk)
        if v and os.path.isfile(v):
            return v, "env"
    for cand in _candidates():
        resolved = _globify(cand)
        if resolved:
            return resolved, "auto"
    # which / where
    which = shutil.which("blender")
    if which:
        return which, "auto"
    return None, "none"


def _parse_version_output(text):
    """解析 `blender --version` 首行：'Blender 4.2.1 LTS'"""
    first = text.splitlines()[0] if text.splitlines() else ""
    m = VERSION_REGEX.match(first.strip())
    if not m:
        return None
    return {
        "full": f"{m.group('major')}.{m.group('minor')}.{m.group('patch')}",
        "major": int(m.group("major")),
        "minor": int(m.group("minor")),
        "patch": int(m.group("patch")),
        "edition": m.group("edition") or "Release",
    }


def _read_version(path):
    """运行 blender --version 解析版本；失败返回 None。"""
    try:
        out = subprocess.run(
            [path, "--version"], capture_output=True, text=True,
            timeout=30).stdout
    except (OSError, subprocess.TimeoutExpired):
        return None
    ver = _parse_version_output(out)
    if ver:
        ver["source"] = "cli"
    return ver


def _api_compatible(ver):
    if not ver:
        return False
    tup = (ver["major"], ver["minor"], ver["patch"])
    if tup < MIN_VERSION:
        return False
    if MAX_VERSION and tup > MAX_VERSION:
        return False
    return True


def _addon_state():
    """判断 addon 目录是否可安装（是否存在 __init__.py）"""
    init = os.path.join(BRIDGE_FOLDER, "__init__.py")
    return {
        "registry_id": "blender_web_bridge",
        "folder": BRIDGE_FOLDER,
        "version": "1.0.0",
        "installable": os.path.isfile(init),
        "installed": False,
        "enabled": False,
    }


def _build_output(path, source, ver):
    addon = _addon_state()
    if path:
        addon["installed"] = _is_installed(path)
        addon["enabled"] = addon["installed"]
    return {
        "detected": bool(path),
        "source": source,
        "path": os.path.abspath(path) if path else None,
        "binary": os.path.basename(path) if path else None,
        "version": {
            "full": ver["full"] if ver else None,
            "major": ver["major"] if ver else None,
            "minor": ver["minor"] if ver else None,
            "patch": ver["patch"] if ver else None,
            "edition": ver["edition"] if ver else None,
            "api_compatible": _api_compatible(ver),
            "source": ver["source"] if ver else "none",
        },
        "capabilities": ["websocket_control", "viewport_stream",
                         "command_exec", "file_io", "scene_graph",
                         "addon_autoinstall"],
        "bridge_addon": addon,
    }


def _is_installed(path):
    """尽力探测插件是否已装入用户偏好（通过 --background python-expr 查询）。"""
    expr = ("import bpy,json;"
            "a=bpy.context.preferences.addons.get('blender_web_bridge');"
            "print(json.dumps({'installed': bool(a)}))")
    try:
        out = subprocess.run(
            [path, "--background", "--python-expr", expr],
            capture_output=True, text=True, timeout=60).stdout
        last = [ln for ln in out.splitlines() if "{" in ln]
        if last:
            return json.loads(last[-1]).get("installed", False)
    except (OSError, subprocess.TimeoutExpired, ValueError):
        pass
    return False


def _install_addon(path):
    """向 Blender 安装并启用桥接插件。"""
    init = os.path.join(BRIDGE_FOLDER, "__init__.py")
    if not os.path.isfile(init):
        raise RuntimeError(f"插件目录不存在 __init__.py: {BRIDGE_FOLDER}")
    expr = (
        "import bpy;"
        "bpy.ops.preferences.addon_install(filepath=__import__('os').path.join("
        f"'{BRIDGE_FOLDER}', '__init__.py'" + "));"
        "bpy.ops.preferences.addon_enable(module='blender_web_bridge');"
        "bpy.ops.wm.save_userpref();"
        "print('INSTALL_OK')"
    )
    r = subprocess.run([path, "--background", "--python-expr", expr],
                       capture_output=True, text=True, timeout=120)
    ok = "INSTALL_OK" in r.stdout
    if not ok:
        raise RuntimeError(f"插件安装失败: {r.stderr[-500:]}")
    return True


def main():
    ap = argparse.ArgumentParser(description="探测本地 Blender 位置与版本（JSON）")
    ap.add_argument("--path", default=None, help="手动指定 blender 可执行路径")
    ap.add_argument("--json", default=None, help="读入上次探测 JSON 以复用其 path")
    ap.add_argument("--install", action="store_true", help="探测后自动安装/启用桥接插件")
    ap.add_argument("--check-only", action="store_true", help="仅输出 api_compatible 判定")
    args = ap.parse_args()

    path, source = _resolve_path(manual=args.path, json_file=args.json)
    ver = _read_version(path) if path else None
    out = _build_output(path, source, ver)

    if args.install:
        if not path:
            print(json.dumps({"error": "未探测到 Blender，无法安装插件",
                              **out}, ensure_ascii=False))
            sys.exit(1)
        try:
            _install_addon(path)
            out["bridge_addon"]["installed"] = True
            out["bridge_addon"]["enabled"] = True
        except Exception as exc:
            print(json.dumps({"error": str(exc), **out}, ensure_ascii=False))
            sys.exit(1)

    if args.check_only:
        result = {"detected": out["detected"],
                  "api_compatible": out["version"]["api_compatible"],
                  "version_full": out["version"]["full"],
                  "path": out["path"]}
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
