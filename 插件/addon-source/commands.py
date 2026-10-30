# -*- coding: utf-8 -*-
"""
blender_web_bridge.commands
~~~~~~~~~~~~~~~~~~~~~~~~~~~

实现 hook.json 中 api.commands 声明的全部命令（method -> handler）。
通过 Blender Python API (bpy) 操作场景、对象、相机与视口。

注意：本模块在 Blender 主线程被调用（由 addon 的 bpy.app.timers 轮询
bridge_server.pending 队列），因此所有 bpy 调用都是线程安全的。
"""
import math
import os
import bpy

from .bridge_server import BridgeError


# ---------------------------------------------------------------- 工具
def _obj_or_error(name):
    obj = bpy.data.objects.get(name)
    if obj is None:
        raise BridgeError(-32003, f"对象不存在: {name}")
    return obj


def _list_objects(selected_only=False):
    out = []
    for obj in bpy.data.objects:
        if selected_only and not obj.select_get():
            continue
        loc = [round(v, 4) for v in obj.location]
        rot = [round(math.degrees(v), 2) for v in obj.rotation_euler]
        scl = [round(v, 4) for v in obj.scale]
        out.append({"name": obj.name, "type": obj.type,
                    "location": loc, "rotation": rot, "scale": scl})
    return out


def _ensure_material_color(obj, color):
    if not hasattr(obj, "data"):
        return False
    mats = obj.data.materials
    if not mats:
        mat = bpy.data.materials.new(obj.name + "_mat")
        mats.append(mat)
    mat = mats[0]
    mat.use_nodes = True
    nt = getattr(mat, "node_tree", None)
    if nt is not None:
        bsdf = nt.nodes.get("Principled BSDF")
        if bsdf is not None and "Base Color" in bsdf.inputs:
            bsdf.inputs["Base Color"].default_value = color
    return True


# ---------------------------------------------------------------- 命令表
# 用户类型 -> bpy.ops.mesh.primitive_<suffix>_add 的算子后缀
_PRIMITIVES = {
    "cube": "cube", "sphere": "uvsphere", "cylinder": "cylinder",
    "plane": "plane", "cone": "cone", "torus": "torus", "monkey": "monkey",
}


def _cmd_ping(params):
    v = tuple(bpy.app.version)
    return {"pong": True, "blender_version": bpy.app.version_string,
            "version_tuple": list(v)}


def _cmd_auth(params):
    # 实际鉴权在 bridge_server 层完成（token 匹配）；这里仅确认客户端已握手
    return {"ok": True}


def _cmd_get_info(params):
    return {
        "blender": {"version": bpy.app.version_string,
                    "version_tuple": list(bpy.app.version),
                    "path": os.path.abspath(bpy.app.binary_path)},
        "capabilities": ["websocket_control", "viewport_stream",
                         "command_exec", "file_io", "scene_graph"],
        "scene": {"name": bpy.context.scene.name,
                  "objects_count": len(bpy.data.objects),
                  "frame": bpy.context.scene.frame_current},
    }


def _cmd_scene_info(params):
    sc = bpy.context.scene
    return {"name": sc.name, "objects": len(bpy.data.objects),
            "frame": sc.frame_current, "renderer": sc.render.engine}


def _cmd_scene_open(params):
    fp = params.get("filepath")
    if not fp or not os.path.isfile(fp):
        raise BridgeError(-32003, f"无效文件路径: {fp}")
    append = bool(params.get("append"))
    bpy.ops.wm.open_mainfile(filepath=fp) if not append \
        else bpy.ops.wm.append(filepath=fp, directory=fp.rsplit(os.sep, 1)[0] + os.sep + "Object" + os.sep)
    return {"loaded": True, "objects": len(bpy.data.objects)}


def _cmd_scene_save(params):
    fp = params.get("filepath")
    if fp:
        bpy.ops.wm.save_as_mainfile(filepath=fp)
        return {"saved_to": fp}
    bpy.ops.wm.save_mainfile()
    return {"saved_to": os.path.abspath(bpy.data.filepath) if bpy.data.filepath else None}


def _cmd_object_list(params):
    return {"objects": _list_objects(bool(params.get("selected_only")))}


def _cmd_object_add(params):
    ptype = (params.get("type") or "cube").lower()
    if ptype in ("camera", "light", "empty"):
        if ptype == "camera":
            bpy.ops.object.camera_add()
        elif ptype == "light":
            bpy.ops.object.light_add(type="POINT")
        else:
            bpy.ops.object.empty_add()
    elif ptype in _PRIMITIVES:
        op = getattr(bpy.ops.mesh, f"primitive_{_PRIMITIVES[ptype]}_add")
        op()
    else:
        raise BridgeError(-32003, f"不支持的对象类型: {ptype}")
    obj = bpy.context.active_object
    if params.get("name"):
        obj.name = params["name"]
    if params.get("location") is not None:
        obj.location = params["location"]
    if params.get("scale") is not None:
        obj.scale = params["scale"]
    return {"name": obj.name, "type": obj.type}


def _cmd_object_select(params):
    name = params.get("name")
    add = bool(params.get("add", False))
    for obj in bpy.data.objects:
        obj.select_set(False)
    if name:
        obj = _obj_or_error(name)
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
    return {"selected": [o.name for o in bpy.data.objects if o.select_get()]}


def _cmd_object_transform(params):
    obj = _obj_or_error(params.get("name"))
    rel = bool(params.get("relative", True))
    if params.get("location") is not None:
        obj.location = [(obj.location[i] + v if rel else v)
                        for i, v in enumerate(params["location"])]
    if params.get("rotation") is not None:
        new_rot = params["rotation"]
        if rel:
            obj.rotation_euler = [
                obj.rotation_euler[i] + math.radians(r)
                if abs(new_rot[i]) > 2 * math.pi else obj.rotation_euler[i] + new_rot[i]
                for i, r in enumerate(new_rot)
            ]
        else:
            obj.rotation_euler = new_rot
    if params.get("scale") is not None:
        obj.scale = [(obj.scale[i] * v if rel else v)
                     for i, v in enumerate(params["scale"])]
    return {"name": obj.name,
            "location": [round(v, 4) for v in obj.location],
            "rotation": [round(math.degrees(v), 2) for v in obj.rotation_euler],
            "scale": [round(v, 4) for v in obj.scale]}


def _cmd_object_duplicate(params):
    obj = _obj_or_error(params.get("name"))
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.duplicate()
    new_obj = bpy.context.active_object
    return {"name": new_obj.name}


def _cmd_object_delete(params):
    obj = _obj_or_error(params.get("name"))
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.ops.object.delete()
    return {"deleted": params.get("name")}


def _cmd_object_rename(params):
    obj = _obj_or_error(params.get("name"))
    obj.name = params.get("new_name") or (params["name"] + ".renamed")
    return {"renamed_to": obj.name}


def _cmd_object_material_set(params):
    obj = _obj_or_error(params.get("name"))
    color = params.get("color") or [0.8, 0.2, 0.2, 1.0]
    ok = _ensure_material_color(obj, color)
    return {"color_set": ok, "color": color}


def _cmd_camera_set(params):
    cam = _obj_or_error(params.get("name"))
    if cam.type != "CAMERA":
        raise BridgeError(-32003, f"{cam.name} 不是相机")
    bpy.context.scene.camera = cam
    if params.get("view", True):
        for area in bpy.context.screen.areas:
            if area.type == "VIEW_3D":
                area.spaces[0].region_3d.view_perspective = "CAMERA"
    return {"active": cam.name}


def _cmd_mode_set(params):
    mode = (params.get("mode") or "OBJECT").upper()
    if mode not in ("OBJECT", "EDIT", "SCULPT", "POSE"):
        raise BridgeError(-32003, f"不支持的交互模式: {mode}")
    if bpy.context.active_object:
        bpy.ops.object.mode_set(mode=mode)
    return {"mode": bpy.context.active_object.mode if bpy.context.active_object else mode}


def _cmd_undo(params):
    bpy.ops.ed.undo()
    return {"done": True}


def _cmd_redo(params):
    bpy.ops.ed.redo()
    return {"done": True}


def _cmd_app_quit(params):
    bpy.ops.wm.quit_blender() if params.get("force") else None
    return {"quitting": True}


# ---------------------------------------------------------------- 平台操作：整窗截图 + 输入注入
def _cmd_screen_info(params):
    from . import input as _input
    return _input.get_window_geometry()


def _cmd_screen_capture(params):
    from . import viewport
    quality = int(params.get("quality", 80))
    data, w, h = viewport.capture_window(quality)
    return {"width": w, "height": h, "format": "jpeg",
            "data_base64": viewport.frame_to_base64(data)}


def _to_screen_xy(rel_x, rel_y):
    """把窗口内相对坐标换算为屏幕绝对坐标。"""
    from . import input as _input
    geo = _input.get_window_geometry()
    return geo["x"] + int(rel_x), geo["y"] + int(rel_y)


def _cmd_input_mouse(params):
    from . import input as _input
    action = params.get("action", "click")
    button = params.get("button", "left")
    rel_x = params.get("x")
    rel_y = params.get("y")

    if action == "move":
        if rel_x is not None and rel_y is not None:
            sx, sy = _to_screen_xy(rel_x, rel_y)
            _input.move_mouse(sx, sy)
    elif action == "down":
        if rel_x is not None and rel_y is not None:
            sx, sy = _to_screen_xy(rel_x, rel_y)
            _input.move_mouse(sx, sy)
        _input.mouse_down(button)
    elif action == "up":
        _input.mouse_up(button)
    elif action == "click":
        if rel_x is not None and rel_y is not None:
            sx, sy = _to_screen_xy(rel_x, rel_y)
            _input.move_mouse(sx, sy)
        _input.mouse_click(button)
    elif action == "scroll":
        _input.mouse_scroll(params.get("delta", 0))
    else:
        raise BridgeError(-32003, f"未知鼠标动作: {action}")
    return {"ok": True}


def _cmd_input_key(params):
    from . import input as _input
    vk = int(params.get("vk", 0))
    action = params.get("action", "press")
    if action == "down":
        _input.key_down(vk)
    elif action == "up":
        _input.key_up(vk)
    else:
        _input.key_press(vk)
    return {"ok": True}


_HANDLERS = {
    "auth": _cmd_auth,
    "ping": _cmd_ping,
    "get_info": _cmd_get_info,
    "scene.info": _cmd_scene_info,
    "scene.open": _cmd_scene_open,
    "scene.save": _cmd_scene_save,
    "object.list": _cmd_object_list,
    "object.add": _cmd_object_add,
    "object.select": _cmd_object_select,
    "object.transform": _cmd_object_transform,
    "object.duplicate": _cmd_object_duplicate,
    "object.delete": _cmd_object_delete,
    "object.rename": _cmd_object_rename,
    "object.material.set": _cmd_object_material_set,
    "camera.set": _cmd_camera_set,
    "mode.set": _cmd_mode_set,
    "undo": _cmd_undo,
    "redo": _cmd_redo,
    "app.quit": _cmd_app_quit,
    "screen.info": _cmd_screen_info,
    "screen.capture": _cmd_screen_capture,
    "input.mouse": _cmd_input_mouse,
    "input.key": _cmd_input_key,
}


def handle_request(method, params):
    """主线程命令分发入口。返回 result dict；出错抛 BridgeError。"""
    handler = _HANDLERS.get(method)
    if handler is None:
        raise BridgeError(-32002, f"不支持的方法: {method}")
    return handler(params or {})


def supported_methods():
    return list(_HANDLERS.keys())
