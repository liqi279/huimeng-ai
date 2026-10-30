# -*- coding: utf-8 -*-
"""
Doubao Bridge — 本地 Blender 可视化操作平台桥接插件
====================================================

把本机 Blender 桥接给自研网页平台：
- 启动 WebSocket 服务（bridge_server）
- 命令在主线程执行（bpy.app.timers 轮询 pending 队列）
- 视口实时画面流（viewport.capture_frame -> base64 事件）

安装：Blender 偏好设置 -> 插件 -> 安装... 选择本目录的 __init__.py
启用后：3D 视图 -> N 侧栏 -> 「Doubao Bridge」面板 -> Start Bridge Server

作者: Doubao Work
"""
import os
import time

import bpy
from bpy.types import Operator, Panel, PropertyGroup
from bpy.props import BoolProperty, IntProperty, StringProperty

bl_info = {
    "name": "Doubao Web Bridge",
    "author": "Doubao Work",
    "version": (1, 0, 0),
    "blender": (3, 6, 0),
    "location": "3D View > Sidebar > Doubao Bridge",
    "description": "把本地 Blender 渲染到自研网页平台并可可视化操作（WebSocket + 视口画面流）",
    "category": "System",
}

# 运行时状态（不进 .blend）
_state = {
    "server": None,
    "timer_handle": None,
    "streaming": False,
    "stream_fps": 15,
    "stream_width": 960,
    "stream_height": 540,
    "last_stream_ts": 0.0,
}


# ---------------------------------------------------------------- 属性
class BridgeSettings(PropertyGroup):
    host: StringProperty(
        name="Host", default="127.0.0.1",
        description="WebSocket 监听地址（平台与本机同机时保持默认）")
    port: IntProperty(name="Port", default=9876, min=1024, max=65535)
    token: StringProperty(
        name="Token", default="", subtype="PASSWORD",
        description="可选鉴权 token；设置后客户端须在请求 params.token 携带")
    stream_fps: IntProperty(name="Stream FPS", default=15, min=1, max=60)
    res_w: IntProperty(name="Width", default=960, min=320, max=1920)
    res_h: IntProperty(name="Height", default=540, min=240, max=1080)


# ---------------------------------------------------------------- 服务管理
def _settings():
    return bpy.context.scene.bridge_settings


def _start_server():
    if _state["server"] and _state["server"].is_running():
        return True
    from .bridge_server import BridgeServer
    from . import commands
    s = BridgeServer(
        host=_settings().host, port=_settings().port,
        token=_settings().token or None,
        request_handler=commands.handle_request)
    ok = s.start()
    _state["server"] = s
    if ok and _state["timer_handle"] is None:
        _state["timer_handle"] = bpy.app.timers.register(_poll, first_interval=0.1)
    return ok


def _stop_server():
    if _state["server"]:
        _state["server"].stop()
        _state["server"] = None
    if _state["timer_handle"] is not None:
        try:
            bpy.app.timers.unregister(_state["timer_handle"])
        except Exception:
            pass
        _state["timer_handle"] = None
    _state["streaming"] = False


def _poll():
    """主线程轮询：执行命令 + 推送视口帧。返回下次调度间隔或 None(停止)。"""
    server = _state["server"]
    if not server or not server.is_running():
        _state["streaming"] = False
        return None

    from .bridge_server import BridgeError
    from . import commands, viewport

    for conn_key, mid, method, params in server.drain_pending():
        try:
            if method == "viewport.frame":
                data, w, h = viewport.capture_frame(
                    int(params.get("width", 960)), int(params.get("height", 540)))
                server.send_response(conn_key, mid, result={
                    "width": w, "height": h, "format": "jpeg",
                    "data_base64": viewport.frame_to_base64(data)})
            elif method == "viewport.stream":
                enabled = bool(params.get("enabled"))
                _state["streaming"] = enabled
                if enabled:
                    _state["stream_fps"] = int(params.get("fps", 15))
                    _state["stream_width"] = int(params.get("width", 960))
                    _state["stream_height"] = int(params.get("height", 540))
                    _state["last_stream_ts"] = 0.0
                server.send_response(conn_key, mid, result={
                    "streaming": enabled, "fps": _state["stream_fps"]})
            else:
                result = commands.handle_request(method, params)
                server.send_response(conn_key, mid, result=result)
        except BridgeError as exc:
            server.send_response(conn_key, mid, error={
                "code": exc.code, "message": exc.message, "data": exc.data})
        except Exception as exc:
            server.send_response(conn_key, mid, error={
                "code": -32000, "message": str(exc)})

    # 实时画面流
    if _state["streaming"]:
        now = time.monotonic()
        interval = 1.0 / max(1, _state["stream_fps"])
        if now - _state["last_stream_ts"] >= interval:
            _state["last_stream_ts"] = now
            try:
                data, w, h = viewport.capture_frame(
                    _state["stream_width"], _state["stream_height"])
                server.broadcast_event("viewport.frame", {
                    "width": w, "height": h, "format": "jpeg",
                    "data_base64": viewport.frame_to_base64(data)})
            except Exception as exc:
                server.broadcast_event("log", {"level": "error", "message": str(exc)})
    return 0.1


# ---------------------------------------------------------------- 操作器
class BRIDGE_OT_start(Operator):
    bl_idname = "doubao_bridge.start"
    bl_label = "Start Bridge Server"
    bl_description = "启动 WebSocket 服务，供网页平台连接"

    def execute(self, context):
        ok = _start_server()
        self.report({"INFO"} if ok else {"ERROR"},
                    "Bridge server started" if ok else "Bridge server failed to start")
        return {"FINISHED"} if ok else {"CANCELLED"}


class BRIDGE_OT_stop(Operator):
    bl_idname = "doubao_bridge.stop"
    bl_label = "Stop Bridge Server"
    bl_description = "停止 WebSocket 服务"

    def execute(self, context):
        _stop_server()
        self.report({"INFO"}, "Bridge server stopped")
        return {"FINISHED"}


# ---------------------------------------------------------------- 面板
class BRIDGE_PT_panel(Panel):
    bl_label = "Doubao Bridge"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Doubao Bridge"

    def draw(self, context):
        layout = self.layout
        st = context.scene.bridge_settings
        running = bool(_state["server"] and _state["server"].is_running())
        layout.label(
            text=f"Status: {'RUNNING' if running else 'STOPPED'} | clients={_state['server'].client_count() if _state['server'] else 0}")
        if running:
            layout.operator("doubao_bridge.stop")
        else:
            layout.operator("doubao_bridge.start")
        layout.separator()
        col = layout.column(align=True)
        col.prop(st, "host")
        col.prop(st, "port")
        col.prop(st, "token")
        col.separator()
        col.prop(st, "stream_fps")
        col.prop(st, "res_w")
        col.prop(st, "res_h")
        layout.label(text=f"Web URL: ws://{st.host}:{st.port}", icon="URL")


# ---------------------------------------------------------------- 注册
classes = (BridgeSettings, BRIDGE_OT_start, BRIDGE_OT_stop, BRIDGE_PT_panel)


def register():
    for cls in classes:
        bpy.utils.register_class(cls)
    bpy.types.Scene.bridge_settings = bpy.props.PointerProperty(type=BridgeSettings)


def unregister():
    _stop_server()
    for cls in reversed(classes):
        try:
            bpy.utils.unregister_class(cls)
        except Exception:
            pass
    del bpy.types.Scene.bridge_settings


if __name__ == "__main__":
    register()
