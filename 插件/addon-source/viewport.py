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


def _find_blender_hwnd():
    """在 Windows 上查找 Blender 主窗口句柄。"""
    try:
        import ctypes
        from ctypes import wintypes
        user32 = ctypes.windll.user32

        # Blender 使用 GHOST 窗口类
        hwnd = user32.FindWindowW("GHOST_WindowClass", None)
        if hwnd:
            return hwnd

        # 备用：枚举所有窗口，找含 "Blender" 的可见窗口
        EnumWindows = user32.EnumWindows
        EnumWindowsProc = ctypes.WINFUNCTYPE(
            wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
        found = []

        def _cb(h, _l):
            if user32.IsWindowVisible(h):
                length = user32.GetWindowTextLengthW(h)
                if length > 0:
                    buf = ctypes.create_unicode_buffer(length + 1)
                    user32.GetWindowTextW(h, buf, length + 1)
                    if "blender" in buf.value.lower():
                        found.append(h)
                        return False
            return True

        EnumWindows(EnumWindowsProc(_cb), 0)
        if found:
            return found[0]
    except Exception as e:
        print(f"[Bridge] _find_blender_hwnd error: {e}", flush=True)
    return None


def _capture_via_gdi(hwnd):
    """用 Windows GDI 抓取窗口，返回 (bmp_bytes, width, height)。"""
    import ctypes
    from ctypes import wintypes
    user32 = ctypes.windll.user32
    gdi32 = ctypes.windll.gdi32

    rect = wintypes.RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(rect))
    w = rect.right - rect.left
    h = rect.bottom - rect.top
    if w <= 0 or h <= 0:
        return None, 0, 0

    hwnd_dc = user32.GetWindowDC(hwnd)
    if not hwnd_dc:
        return None, 0, 0
    mem_dc = gdi32.CreateCompatibleDC(hwnd_dc)
    if not mem_dc:
        user32.ReleaseDC(hwnd, hwnd_dc)
        return None, 0, 0
    bmp = gdi32.CreateCompatibleBitmap(hwnd_dc, w, h)
    if not bmp:
        gdi32.DeleteDC(mem_dc)
        user32.ReleaseDC(hwnd, hwnd_dc)
        return None, 0, 0
    old = gdi32.SelectObject(mem_dc, bmp)

    # SRCCOPY = 0x00CC0020；抓取含标题栏边框的整个窗口
    bitblt_ok = gdi32.BitBlt(mem_dc, 0, 0, w, h, hwnd_dc, 0, 0, 0x00CC0020)

    # 构造 BMP 信息头（在 GetDIBits 之前准备好）
    class BITMAPINFOHEADER(ctypes.Structure):
        _fields_ = [
            ("biSize", wintypes.DWORD),
            ("biWidth", wintypes.LONG),
            ("biHeight", wintypes.LONG),
            ("biPlanes", wintypes.WORD),
            ("biBitCount", wintypes.WORD),
            ("biCompression", wintypes.DWORD),
            ("biSizeImage", wintypes.DWORD),
            ("biXPelsPerMeter", wintypes.LONG),
            ("biYPelsPerMeter", wintypes.LONG),
            ("biClrUsed", wintypes.DWORD),
            ("biClrImportant", wintypes.DWORD),
        ]

    bih = BITMAPINFOHEADER()
    bih.biSize = ctypes.sizeof(BITMAPINFOHEADER)
    bih.biWidth = w
    bih.biHeight = -h  # 顶到底（top-down），避免上下颠倒
    bih.biPlanes = 1
    bih.biBitCount = 32
    bih.biCompression = 0  # BI_RGB

    buf_size = w * h * 4
    buf = ctypes.create_string_buffer(buf_size)
    # GetDIBits 必须在位图仍被选入 mem_dc 时调用
    lines = gdi32.GetDIBits(mem_dc, bmp, 0, h, buf,
                            ctypes.byref(bih), 0)  # DIB_RGB_COLORS

    gdi32.SelectObject(mem_dc, old)
    gdi32.DeleteObject(bmp)
    gdi32.DeleteDC(mem_dc)
    user32.ReleaseDC(hwnd, hwnd_dc)

    if not bitblt_ok or lines == 0:
        print(f"[Bridge] GDI BitBlt/GetDIBits failed: bitblt={bitblt_ok}, lines={lines}", flush=True)
        return None, 0, 0

    # BMP 文件头
    import struct
    file_header = bytearray(14)
    file_header[0:2] = b'BM'
    struct.pack_into('<I', file_header, 2, 14 + bih.biSize + buf_size)
    struct.pack_into('<I', file_header, 10, 14 + bih.biSize)

    bmp_bytes = bytes(file_header) + bytes(bih) + bytes(buf.raw)
    return bmp_bytes, w, h


def capture_window(quality=80):
    """截取整个 Blender 窗口（含菜单、工具栏、属性面板等原生 UI）。

    返回 (image_bytes, width, height, format)，format 为 "jpeg" 或 "bmp"。
    策略：Windows GDI 直抓 > bpy.ops.screen.screenshot > 视口降级。
    """
    import bpy
    scene = bpy.context.scene
    prev_fmt = scene.render.image_settings.file_format
    prev_qual = scene.render.image_settings.quality

    # ---- 方法 1: Windows GDI 直接抓窗（最可靠） ----
    import platform
    if platform.system() == "Windows":
        try:
            hwnd = _find_blender_hwnd()
            if hwnd:
                bmp_data, w, h = _capture_via_gdi(hwnd)
                if bmp_data:
                    # 优先把 BMP 转成 JPEG：写临时 bmp -> 用 Blender image API 转存
                    import tempfile, os
                    fd_bmp, bmp_path = tempfile.mkstemp(suffix=".bmp")
                    os.close(fd_bmp)
                    try:
                        with open(bmp_path, "wb") as f:
                            f.write(bmp_data)
                        img = bpy.data.images.load(bmp_path)
                        try:
                            scene.render.image_settings.file_format = "JPEG"
                            scene.render.image_settings.quality = int(quality)
                            fd_jpg, jpg_path = tempfile.mkstemp(suffix=".jpg")
                            os.close(fd_jpg)
                            try:
                                # 优先用 img.save()（按 image.file_format 输出），
                                # 失败再回退到 save_render
                                saved = False
                                try:
                                    img.file_format = "JPEG"
                                    img.filepath_raw = jpg_path
                                    img.save()
                                    if os.path.exists(jpg_path) and os.path.getsize(jpg_path) > 0:
                                        saved = True
                                except Exception as e:
                                    print(f"[Bridge] img.save() failed: {e}", flush=True)
                                if not saved:
                                    try:
                                        img.save_render(jpg_path, scene=scene)
                                    except Exception as e:
                                        print(f"[Bridge] save_render() failed: {e}", flush=True)
                                if os.path.exists(jpg_path) and os.path.getsize(jpg_path) > 0:
                                    with open(jpg_path, "rb") as f:
                                        data = f.read()
                                    print(f"[Bridge] GDI capture OK (jpeg): {w}x{h}, {len(data)} bytes", flush=True)
                                    return data, int(w), int(h), "jpeg"
                                else:
                                    # JPEG 转存失败，直接发 BMP
                                    print(f"[Bridge] GDI jpeg convert failed, send BMP directly: {w}x{h}, {len(bmp_data)} bytes", flush=True)
                                    return bmp_data, int(w), int(h), "bmp"
                            finally:
                                try:
                                    os.unlink(jpg_path)
                                except OSError:
                                    pass
                        finally:
                            try:
                                bpy.data.images.remove(img)
                            except Exception:
                                pass
                    finally:
                        try:
                            os.unlink(bmp_path)
                        except OSError:
                            pass
        except Exception as e:
            print(f"[Bridge] GDI capture failed: {e}", flush=True)

    # ---- 方法 2: bpy.ops.screen.screenshot ----
    try:
        scene.render.image_settings.file_format = "JPEG"
        scene.render.image_settings.quality = int(quality)
        fd, tmp = tempfile.mkstemp(suffix=".jpg")
        os.close(fd)

        wm = bpy.context.window_manager
        window = wm.windows[0] if wm and wm.windows else bpy.context.window
        w = getattr(window, "width", 0) or 1920
        h = getattr(window, "height", 0) or 1080

        ok = False
        # 尝试 full=True（全屏）和 full=False（仅窗口）
        for full_val in (True, False):
            try:
                if hasattr(bpy.context, "temp_override") and window:
                    with bpy.context.temp_override(window=window, screen=window.screen):
                        bpy.ops.screen.screenshot('EXEC_DEFAULT', filepath=tmp, full=full_val)
                else:
                    bpy.ops.screen.screenshot('EXEC_DEFAULT', filepath=tmp, full=full_val)
                if os.path.exists(tmp) and os.path.getsize(tmp) > 0:
                    ok = True
                    print(f"[Bridge] screenshot full={full_val} OK: {os.path.getsize(tmp)} bytes", flush=True)
                    break
            except Exception as e:
                print(f"[Bridge] screenshot full={full_val} failed: {e}", flush=True)

        if ok:
            with open(tmp, "rb") as f:
                data = f.read()
            try:
                os.unlink(tmp)
            except OSError:
                pass
            return data, int(w), int(h), "jpeg"

        try:
            os.unlink(tmp)
        except OSError:
            pass
    except Exception as e:
        print(f"[Bridge] screenshot method error: {e}", flush=True)
    finally:
        scene.render.image_settings.file_format = prev_fmt
        scene.render.image_settings.quality = prev_qual

    # ---- 方法 3: 降级到视口渲染 ----
    print("[Bridge] window capture failed, fallback to viewport", flush=True)
    try:
        data, w, h = capture_frame(quality=int(quality))
        return data, int(w), int(h), "jpeg"
    except Exception as e:
        print(f"[Bridge] viewport fallback also failed: {e}", flush=True)
        raise
    finally:
        scene.render.image_settings.file_format = prev_fmt
        scene.render.image_settings.quality = prev_qual
