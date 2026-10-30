# -*- coding: utf-8 -*-
"""
blender_web_bridge.viewport
~~~~~~~~~~~~~~~~~~~~~~~~~~~

视口画面捕获：把 Blender 当前视图渲染成一帧图像字节，供桥接推送到网页。
使用 bpy.ops.render.opengl(..., view_context=True) 输出真实渲染画面，
不依赖 Pillow 等第三方编码库（由 Blender 自身按 file_format 写出）。

为兼容 3.6 / 4.x 的 GPU 离屏渲染差异，这里提供两档实现：
  1) 标准路径：render.opengl 写临时文件 -> 读字节（稳定，首选）
  2) 若需要更快帧率，可自行扩展 gpu.offscreen 路径。
"""
import os
import tempfile
import bpy

DEFAULT_WIDTH = 960
DEFAULT_HEIGHT = 540
DEFAULT_QUALITY = 85


def capture_frame(width=DEFAULT_WIDTH, height=DEFAULT_HEIGHT,
                  quality=DEFAULT_QUALITY):
    """渲染当前视图，返回 (jpeg_bytes, width, height)。"""
    scene = bpy.context.scene
    prev_res = (scene.render.resolution_x, scene.render.resolution_y)
    prev_fmt = scene.render.image_settings.file_format
    prev_qual = scene.render.image_settings.quality
    prev_fp = scene.render.filepath
    try:
        scene.render.resolution_x = int(width)
        scene.render.resolution_y = int(height)
        scene.render.image_settings.file_format = "JPEG"
        scene.render.image_settings.quality = int(quality)
        fd, tmp = tempfile.mkstemp(suffix=".jpg")
        os.close(fd)
        scene.render.filepath = tmp
        # view_context=True 沿用当前 3D 视图相机，输出所见即所得画面
        bpy.ops.render.opengl(write_still=True, view_context=True)
        with open(tmp, "rb") as f:
            data = f.read()
        os.unlink(tmp)
        return data, int(width), int(height)
    finally:
        scene.render.resolution_x = prev_res[0]
        scene.render.resolution_y = prev_res[1]
        scene.render.image_settings.file_format = prev_fmt
        scene.render.image_settings.quality = prev_qual
        scene.render.filepath = prev_fp


def frame_to_base64(jpeg_bytes):
    import base64
    return base64.b64encode(jpeg_bytes).decode("ascii")


def capture_window(quality=80):
    """截取整个 Blender 窗口（含菜单、工具栏、属性面板等原生 UI）。

    返回 (jpeg_bytes, width, height)。width/height 为窗口实际像素尺寸。
    使用 bpy.ops.screen.screenshot 捕获窗口，再按 JPEG 编码输出。
    """
    import bpy
    scene = bpy.context.scene
    prev_fmt = scene.render.image_settings.file_format
    prev_qual = scene.render.image_settings.quality
    try:
        scene.render.image_settings.file_format = "JPEG"
        scene.render.image_settings.quality = int(quality)
        fd, tmp = tempfile.mkstemp(suffix=".jpg")
        os.close(fd)
        # full=False 仅捕获当前窗口（不含桌面其他区域）
        bpy.ops.screen.screenshot(filepath=tmp, full=False)
        with open(tmp, "rb") as f:
            data = f.read()
        try:
            os.unlink(tmp)
        except OSError:
            pass
        w = bpy.context.window.width
        h = bpy.context.window.height
        return data, int(w), int(h)
    finally:
        scene.render.image_settings.file_format = prev_fmt
        scene.render.image_settings.quality = prev_qual
