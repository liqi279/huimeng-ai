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


def get_window_geometry():
    """返回 Blender 主窗口在屏幕上的几何信息 {x, y, width, height}。"""
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
def move_mouse(x, y):
    """移动鼠标到屏幕绝对坐标。"""
    if _PLATFORM == "Windows":
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


# mouse_event 标志位（Windows）
_MEVENT_LEFTDOWN = 0x0002
_MEVENT_LEFTUP = 0x0004
_MEVENT_RIGHTDOWN = 0x0008
_MEVENT_RIGHTUP = 0x0010
_MEVENT_MIDDLEDOWN = 0x0020
_MEVENT_MIDDLEUP = 0x0040
_MEVENT_WHEEL = 0x0800


def mouse_down(button="left"):
    if button == "left":
        _mouse_event(_MEVENT_LEFTDOWN)
    elif button == "right":
        _mouse_event(_MEVENT_RIGHTDOWN)
    elif button == "middle":
        _mouse_event(_MEVENT_MIDDLEDOWN)


def mouse_up(button="left"):
    if button == "left":
        _mouse_event(_MEVENT_LEFTUP)
    elif button == "right":
        _mouse_event(_MEVENT_RIGHTUP)
    elif button == "middle":
        _mouse_event(_MEVENT_MIDDLEUP)


def mouse_click(button="left"):
    mouse_down(button)
    mouse_up(button)


def mouse_scroll(delta):
    """delta > 0 向上滚，< 0 向下滚。"""
    if _PLATFORM == "Windows":
        import ctypes
        ctypes.windll.user32.mouse_event(_MEVENT_WHEEL, 0, 0, int(delta * 120), 0)


# ---------------------------------------------------------------- 键盘
def _key_event(vk, flags):
    if _PLATFORM == "Windows":
        import ctypes
        ctypes.windll.user32.keybd_event(int(vk), 0, flags, 0)


_KEY_DOWN = 0x0000
_KEY_UP = 0x0002


def key_down(vk):
    _key_event(vk, _KEY_DOWN)


def key_up(vk):
    _key_event(vk, _KEY_UP)


def key_press(vk):
    key_down(vk)
    key_up(vk)
