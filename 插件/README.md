# 绘梦平台 · Blender 桥接插件

本插件让本地 Blender 接入绘梦平台（https://liqi279.github.io/huimeng-ai/）的「建模」模块。

> **重要：「远程操作」和「平台操作」是同一个插件的两种使用模式**，只需安装一次 `doubao_web_bridge.zip`，在平台建模页面顶部切换标签即可。

| 模式 | 说明 | 适用场景 |
|---|---|---|
| **远程操作** | 只传输 3D 视口画面 + 右侧按钮面板操作（添加物体、位移、上色等） | 简单建模、快速操作 |
| **平台操作** | 传输完整 Blender 窗口（含菜单/工具栏/属性面板），鼠标键盘直接操作 Blender 原生界面 | 复杂建模、完整 Blender 体验 |

- **插件版本**：1.1.0
- **兼容 Blender**：3.6.0 ~ 4.x（已在 4.2.1 LTS 验证）
- **默认连接**：`ws://127.0.0.1:9876`
- **协议**：`doubao-blender-bridge/1.0`（详见 `hook.json`）

---

## 目录内容

| 文件/目录 | 说明 |
|---|---|
| `doubao_web_bridge.zip` | **插件安装包**（在 Blender 里直接安装这个） |
| `addon-source/` | 插件源码（5 个 .py 文件，供参考/二次开发） |
| `detect_blender.py` | 本地 Blender 探测脚本（可选） |
| `hook.json` | 桥接协议规范（API / 事件 / 错误码） |

---

## 安装步骤（两种模式通用）

### 第 1 步：安装插件
1. 打开 Blender → 顶部菜单 **编辑(Edit)** → **偏好设置(Preferences)**
2. 左侧选 **插件(Add-ons)**
3. 右上角点 **安装...(Install...)**
4. 选择 `doubao_web_bridge.zip` → 点 **安装插件(Install Add-on)**
5. 在列表里找到 **"Doubao Web Bridge"**（System 分类），勾选启用

### 第 2 步：启动桥接服务
1. 回到 3D 视图，按 **N 键** 调出右侧侧栏
2. 切换到 **「Doubao Bridge」** 标签页
3. 确认 Host=`127.0.0.1`、Port=`9876`（默认即可）
4. 点击 **「Start Bridge Server」**
5. 面板状态显示 `Status: RUNNING` 即成功

### 第 3 步：连接绘梦平台
1. 浏览器打开 [绘梦平台](https://liqi279.github.io/huimeng-ai/)
2. 点击左侧栏 **「建模」** 图标
3. 顶部连接栏显示 `已连接`（绿灯）即连接成功
4. 在顶部切换 **「远程操作」** 或 **「平台操作」** 标签

---

## 模式一：远程操作

只渲染 3D 视口画面，通过右侧按钮面板操作。

### 操作面板功能

| 分组 | 功能 |
|---|---|
| **场景控制** | 场景信息、对象列表、打开 .blend 文件 |
| **对象操作** | 选择对象、删除、X/Y/Z 位移、设置漫反射颜色 |
| **添加对象** | 立方体、球体、圆柱、平面、圆环、猴头、相机、灯光 |
| **视图与流** | 抓一帧、开启实时流（15fps）、撤销、重做 |
| **日志** | 连接与操作日志 |

### 使用建议
- 点「开启实时流」获得流畅的视口画面
- 位移步长为 0.1，可连续点击累积
- 上色功能设置对象的 Principled BSDF 基础色

---

## 模式二：平台操作

完整 Blender 窗口渲染到网页，鼠标键盘直接操作 Blender 原生界面，**无操作面板**。

### 支持的操作

| 输入 | 效果 |
|---|---|
| **左键点击/拖拽** | 选择、框选、变换（G/S/R 需配合键盘） |
| **中键拖拽** | 旋转视图 |
| **右键** | 上下文菜单 |
| **滚轮** | 缩放视图 |
| **键盘** | 所有 Blender 快捷键（G 移动、S 缩放、R 旋转、Tab 编辑模式、X 删除 等） |

### 工作原理
- 插件通过 `bpy.ops.screen.screenshot` 截取整个 Blender 窗口，以 JPEG 推送到网页（约 8fps）
- 网页端的鼠标/键盘事件通过 WebSocket 发送给插件
- 插件使用 OS 级输入注入（Windows: `ctypes` user32；macOS: Quartz）把事件转成真实的系统输入
- 坐标自动映射：网页显示尺寸 → Blender 窗口实际像素

### 使用注意
1. **鼠标会真实移动**：平台操作模式会移动你本机的鼠标光标到 Blender 窗口上，这是正常的
2. **建议 Blender 窗口可见**：操作时确保 Blender 窗口在屏幕上处于非最小化状态
3. **快捷键**：先点击画面区域获得焦点，再按键盘。F5/Ctrl+R 等浏览器快捷键会被浏览器拦截
4. **切换模式**：顶部标签可随时切换「远程操作」↔「平台操作」

---

## 验证清单

| 检查项 | 预期 |
|---|---|
| Blender 侧栏 `Doubao Bridge` 面板 | `Status: RUNNING` |
| 绘梦建模页状态灯 | 绿色「已连接」 |
| 远程操作模式视口 | 显示 3D 视图画面 |
| 平台操作模式画面 | 显示完整 Blender 窗口（含菜单栏） |
| 平台操作点击物体 | Blender 中物体被选中 |

---

## 常见问题

### Q1：点击 Start Bridge Server 报错 `AttributeError: 'NoneType' object has no attribute 'host'`
旧版本 bug。请使用本目录的最新 `doubao_web_bridge.zip`，移除旧插件后重新安装。

### Q2：平台操作模式画面不更新/黑屏
- 确认 Blender 窗口未最小化
- 确认插件状态为 RUNNING
- 切换到远程操作再切回平台操作试试

### Q3：平台操作鼠标点击位置不准
- 网页画面会按比例缩放，坐标已自动映射。如果 Blender 窗口被系统缩放（DPI 缩放），可能有偏差
- 建议将 Blender 窗口最大化或调整到合适大小

### Q4：键盘快捷键没反应
- 先点击画面区域让它获得焦点（边框变色表示已聚焦）
- 部分浏览器保留快捷键（F5、Ctrl+W、Ctrl+T 等）无法转发

### Q5：远程操作「添加对象」报错 `could not be found`
- 某些 Blender 版本的 primitive 算子名称有差异。请升级到 Blender 4.0+

### Q6：如何停止服务
- 面板点 `Stop Bridge Server`，或直接关闭 Blender

---

## 卸载

Blender → 编辑 → 偏好设置 → 插件 → 找到 "Doubao Web Bridge" → 展开 → 点「移除」。

## 协议概览

- **传输**：WebSocket `ws://127.0.0.1:9876`
- **信封**：`{v:1, type:"request|response|event|error", id, method, params, result, error, ts}`
- **远程操作命令**：`scene.*`、`object.*`、`camera.set`、`viewport.frame`、`viewport.stream`、`undo`、`redo`
- **平台操作命令**：`screen.info`、`screen.capture`、`input.mouse`、`input.key`
- **事件**：`ready`、`viewport.frame`、`selection.changed`、`scene.updated`、`log`、`closed`
