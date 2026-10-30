# Doubao Web Bridge — Blender 桥接插件

让本地 Blender 把视口画面实时渲染到绘梦平台网页，并支持远程建模操作（WebSocket + 视口画面流）。

- **插件版本**：1.0.0
- **兼容 Blender**：3.6.0 ~ 4.x（已在 4.2.1 LTS 验证）
- **协议**：`doubao-blender-bridge/1.0`（详见 `hook.json`）
- **默认连接**：`ws://127.0.0.1:9876`

## 目录内容

| 文件 | 说明 |
|---|---|
| `doubao_web_bridge.zip` | Blender 插件安装包（直接在 Blender 里安装） |
| `detect_blender.py` | 本地 Blender 探测脚本（可选，用于自动定位 Blender） |
| `hook.json` | 桥接协议规范（能力声明 + API/事件/错误码） |

---

## 安装步骤（Blender 4.2.1）

### 第 1 步：安装插件

1. 打开 Blender → 顶部菜单 **编辑(Edit)** → **偏好设置(Preferences)**
2. 左侧选 **插件(Add-ons)**
3. 右上角点 **安装...(Install...)**
4. 选择下载好的 `doubao_web_bridge.zip` → 点 **安装插件(Install Add-on)**
5. 在插件列表里找到 **"Doubao Web Bridge"**（System 分类），勾选左侧复选框启用

### 第 2 步：启动桥接服务

1. 回到 3D 视图，按 **N 键** 调出右侧侧栏
2. 切换到 **「Doubao Bridge」** 标签页
3. 确认 Host=`127.0.0.1`、Port=`9876`（默认即可）
4. 点击 **「Start Bridge Server」**
5. 面板状态变为 `Status: RUNNING` 即成功

### 第 3 步：连接绘梦平台

1. 浏览器打开 [绘梦平台](https://liqi279.github.io/huimeng-ai/)
2. 点击左侧栏 **「建模」** 图标
3. 顶部连接栏会显示 `已连接`（绿灯），视口区开始实时渲染 Blender 画面
4. 点 **「开启实时流」** 获得 15fps 流畅画面；可用右侧面板添加物体、位移、上色等

---

## 验证清单

| 检查项 | 预期 |
|---|---|
| Blender 侧栏 `Doubao Bridge` 面板 | `Status: RUNNING` |
| 本机端口 9876 | 开始监听 |
| 绘梦建模页状态灯 | 绿色「已连接」 |
| 视口区域 | 显示 Blender 当前场景画面 |
| 点「抓一帧」 | 画面刷新，日志显示「已抓帧」 |

---

## 操作面板功能

### 场景控制
- **场景信息**：返回场景名称、对象数、当前帧、渲染器
- **对象列表**：刷新场景对象下拉菜单
- **打开**：加载本地 `.blend` 文件（需绝对路径）

### 对象操作
- **对象**：下拉选择场景中的对象
- **删除**：删除选中对象
- **位移 X/Y/Z**：相对移动选中对象（步长 0.1）
- **颜色**：为选中对象设置漫反射颜色

### 添加对象
支持：立方体、球体、圆柱、平面、圆环、猴头(Suzanne)、相机、灯光

### 视图与流
- **抓一帧**：请求单帧离屏渲染（960×540 JPEG）
- **开启实时流**：15fps 实时画面推送
- **撤销 / 重做**

---

## 常见问题

### Q1：面板里找不到「Doubao Bridge」标签
- 确认插件已勾选启用
- 必须在 **3D 视图** 里按 N 键（不是在其他编辑器）

### Q2：点击 Start Bridge Server 报错 `AttributeError: 'NoneType' object has no attribute 'host'`
- 这是旧版本插件的 bug，已修复。请重新下载本目录的 `doubao_web_bridge.zip`，在插件偏好设置里**移除旧版本**后重新安装。

### Q3：绘梦平台显示「连接被拒绝」
- 确认 Blender 里点了 `Start Bridge Server`
- 确认端口是 9876（未被其他程序占用）
- Windows 防火墙首次会弹窗，选择「允许访问」

### Q4：视口画面是黑的
- Blender 需有可见视口内容（默认立方体场景即可）
- 先点「抓一帧」测试单帧渲染是否正常
- 实时流依赖 GPU 离屏渲染，核显/集显可能不支持

### Q5：如何停止服务
- 面板点 `Stop Bridge Server`，或直接关闭 Blender

---

## 协议概览（hook.json）

- **传输**：WebSocket `ws://127.0.0.1:9876`
- **信封**：`{v:1, type:"request|response|event|error", id, method, params, result, error, ts}`
- **核心命令**：`ping`、`get_info`、`scene.info/open/save`、`object.list/add/select/transform/duplicate/delete/rename/material.set`、`camera.set`、`viewport.frame/stream`、`mode.set`、`undo`、`redo`、`app.quit`
- **核心事件**：`ready`、`viewport.frame`（JPEG base64 流）、`selection.changed`、`scene.updated`、`log`、`closed`

## 卸载

Blender → 编辑 → 偏好设置 → 插件 → 找到 "Doubao Web Bridge" → 展开 → 点「移除」。
