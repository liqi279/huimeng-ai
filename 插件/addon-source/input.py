# -*- coding: utf-8 -*-
"""
blender_web_bridge.input
~~~~~~~~~~~~~~~~~~~~~~~~

OS 级输入注入：让网页客户端直接驱动 Blender 原生界面（点击、拖拽、滚轮、键盘）。

实现策略：
  - Windows：ctypes 调用 user32（SetCursorPos / mouse_event / keybd_event）
  - macOS：Quartz CGWarpMouseCursorPosition（未完整测试）
  - Linux：暂不支持（需 xdotool 等外部工具）

坐标约定：
  - 屏幕绝对坐标（左上角为原点），与 Blender 窗口位置叠加后使用
  - 网页端传来的是「Blender 窗口内相对坐标」，由 commands 层叠加窗口偏移
"""
import platform

_PLATFORM = platform.system()


def _find_blender_hwnd():
    """在 Windows 上查找 Blender 主窗口句柄（与 viewport.py 保持一致）。"""
    try:
        import ctypes
        from ctypes import wintypes
        user32 = ctypes.windll.user32
        hwnd = user32.FindWindowW("GHOST_WindowClass", None)
        if hwnd:
            return hwnd
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
    except Exception:
        pass
    return None


def get_window_geometry():
    """返回 Blender 主窗口在屏幕上的几何信息 {x, y, width, height}。

    优先用 Windows GDI GetWindowRect（物理像素，与 viewport.capture_window 的
    截图坐标系一致），避免 DPI 缩放下 bpy.context.window 的逻辑像素与截图
    物理像素不匹配导致鼠标点击位置偏移。
    """
    if _PLATFORM == "Windows":
        hwnd = _find_blender_hwnd()
        if hwnd:
            try:
                import ctypes
                from ctypes import wintypes
                user32 = ctypes.windll.user32
                rect = wintypes.RECT()
                user32.GetWindowRect(hwnd, ctypes.byref(rect))
                w = rect.right - rect.left
                h = rect.bottom - rect.top
                if w > 0 and h > 0:
                    return {
                        "x": int(rect.left),
                        "y": int(rect.top),
                        "width": int(w),
                        "height": int(h),
                    }
            except Exception:
                pass
    # 回退：bpy 窗口属性（可能受 DPI 缩放影响）
    import bpy
    w = bpy.context.window
    if w is None:
        wm = bpy.context.window_manager
        if wm and wm.windows:
            w = wm.windows[0]
    if w is None:
        return {"x": 0, "y": 0, "width": 1920, "height": 1080}
    return {
        "x": int(w.x),
        "y": int(w.y),
        "width": int(w.width),
        "height": int(w.height),
    }


# ---------------------------------------------------------------- 鼠标
# Windows 消息常量
_WM_MOUSEMOVE = 0x0200
_WM_LBUTTONDOWN = 0x0201
_WM_LBUTTONUP = 0x0202
_WM_RBUTTONDOWN = 0x0204
_WM_RBUTTONUP = 0x0205
_WM_MBUTTONDOWN = 0x0207
_WM_MBUTTONUP = 0x0208
_WM_MOUSEWHEEL = 0x020A

# 最近一次鼠标位置（客户区坐标），用于 down/up 消息
_last_client_pos = [0, 0]

# mouse_event 标志位（Windows，用于绝对定位点击的回退方案）
_MEVENT_LEFTDOWN = 0x0002
_MEVENT_LEFTUP = 0x0004
_MEVENT_RIGHTDOWN = 0x0008
_MEVENT_RIGHTUP = 0x0010
_MEVENT_MIDDLEDOWN = 0x0020
_MEVENT_MIDDLEUP = 0x0040
_MEVENT_WHEEL = 0x0800
_MEVENT_MOVE = 0x0001
_MEVENT_ABSOLUTE = 0x8000


def _post_mouse_to_blender(msg, wparam, client_x, client_y):
    """通过 PostMessage 直接向 Blender 窗口发送鼠标消息，不移动系统光标。

    这样浏览器不会失去光标焦点，拖拽时网页仍能持续收到 mousemove/mouseup。
    client_x / client_y 是相对于 Blender 窗口客户区左上角的坐标。
    """
    hwnd = _find_blender_hwnd()
    if not hwnd:
        return False
    try:
        import ctypes
        from ctypes import wintypes
        user32 = ctypes.windll.user32
        # 坐标打包到 lParam：LOWORD=x, HIWORD=y
        lparam = (int(client_y) << 16) | (int(client_x) & 0xFFFF)
        user32.PostMessageW(hwnd, msg, wparam, lparam)
        return True
    except Exception:
        return False


def _screen_to_client(sx, sy):
    """屏幕坐标 -> Blender 窗口客户区坐标。"""
    hwnd = _find_blender_hwnd()
    if not hwnd:
        return sx, sy
    try:
        import ctypes
        from ctypes import wintypes
        user32 = ctypes.windll.user32
        pt = wintypes.POINT(int(sx), int(sy))
        user32.ScreenToClient(hwnd, ctypes.byref(pt))
        return pt.x, pt.y
    except Exception:
        return sx, sy


def move_mouse(x, y):
    """移动鼠标到屏幕绝对坐标。用 PostMessage 发送 WM_MOUSEMOVE，不移动系统光标。"""
    global _last_client_pos
    if _PLATFORM == "Windows":
        cx, cy = _screen_to_client(x, y)
        _last_client_pos = [cx, cy]
        if not _post_mouse_to_blender(_WM_MOUSEMOVE, 0, cx, cy):
            # 回退：SetCursorPos + mouse_event
            import ctypes
            ctypes.windll.user32.SetCursorPos(int(x), int(y))
    elif _PLATFORM == "Darwin":
        try:
            import Quartz
            Quartz.CGWarpMouseCursorPosition((float(x), float(y)))
        except Exception:
            pass


def _mouse_event(flag):
    if _PLATFORM == "Windows":
        import ctypes
        ctypes.windll.user32.mouse_event(flag, 0, 0, 0, 0)


def mouse_down(button="left"):
    if _PLATFORM == "Windows":
        cx, cy = _last_client_pos
        # 先确保光标位置正确，再按下
        if button == "left":
            _post_mouse_to_blender(_WM_MOUSEMOVE, 0, cx, cy)
            _post_mouse_to_blender(_WM_LBUTTONDOWN, 0x0001, cx, cy)
        elif button == "right":
            _post_mouse_to_blender(_WM_MOUSEMOVE, 0, cx, cy)
            _post_mouse_to_blender(_WM_RBUTTONDOWN, 0x0002, cx, cy)
        elif button == "middle":
            _post_mouse_to_blender(_WM_MOUSEMOVE, 0, cx, cy)
            _post_mouse_to_blender(_WM_MBUTTONDOWN, 0x0010, cx, cy)
    elif _PLATFORM == "Darwin":
        pass


def mouse_up(button="left"):
    if _PLATFORM == "Windows":
        cx, cy = _last_client_pos
        if button == "left":
            _post_mouse_to_blender(_WM_LBUTTONUP, 0, cx, cy)
        elif button == "right":
            _post_mouse_to_blender(_WM_RBUTTONUP, 0, cx, cy)
        elif button == "middle":
            _post_mouse_to_blender(_WM_MBUTTONUP, 0, cx, cy)
    elif _PLATFORM == "Darwin":
        pass


def mouse_click(button="left"):
    mouse_down(button)
    mouse_up(button)


def mouse_scroll(delta):
    """delta > 0 向上滚，< 0 向下滚。"""
    if _PLATFORM == "Windows":
        # PostMessage WM_MOUSEWHEEL: wParam 高 16 位为滚轮量(*120)，低 16 位为按键状态
        hwnd = _find_blender_hwnd()
        if hwnd:
            try:
                import ctypes
                from ctypes import wintypes
                user32 = ctypes.windll.user32
                wheel_amount = int(delta * 120)
                wparam = (wheel_amount << 16) & 0xFFFFFFFF
                user32.PostMessageW(hwnd, _WM_MOUSEWHEEL, wparam, 0)
                return
            except Exception:
                pass
        # 回退
        import ctypes
        ctypes.windll.user32.mouse_event(_MEVENT_WHEEL, 0, 0, int(delta * 120), 0)


# ---------------------------------------------------------------- 键盘
_WM_KEYDOWN = 0x0100
_WM_KEYUP = 0x0101

# keybd_event 标志位（回退用）
_KEY_DOWN = 0x0000
_KEY_UP = 0x0002


def key_down(vk):
    if _PLATFORM == "Windows":
        # 优先 PostMessage 到 Blender 窗口，避免按键被浏览器拦截
        if not _post_mouse_to_blender(_WM_KEYDOWN, int(vk), 0, 0):
            import ctypes
            ctypes.windll.user32.keybd_event(int(vk), 0, _KEY_DOWN, 0)


def key_up(vk):
    if _PLATFORM == "Windows":
        if not _post_mouse_to_blender(_WM_KEYUP, int(vk), 0, 0):
            import ctypes
            ctypes.windll.user32.keybd_event(int(vk), 0, _KEY_UP, 0)


def key_press(vk):
    key_down(vk)
    key_up(vk)
