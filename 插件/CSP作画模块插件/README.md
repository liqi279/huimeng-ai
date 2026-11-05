# CSP作画模块插件（HMCSPBridge）

绘梦 AI 动漫创作平台「作画 → CSP作画」子模块的联动插件。

## 功能

- **唤起本地 CSP**：通过 `clipstudio://` 系统协议打开你电脑上**已正版安装**的 CLIP STUDIO PAINT（每次切换到「CSP作画」子模块时自动尝试唤起，也可手动点击按钮）
- **状态探测**：`unknown / launching / launched / notfound`，未安装时展示 CELSYS 官网引导
- **完成稿回导**：拖放或选择 PNG / JPG / WebP，一键导入平台「资产」模块

## 合规声明

本插件**只提供与本地正版 CSP 的联动接口**：

- 不包含 CLIP STUDIO PAINT 安装包或任何破解补丁
- 不包含、不实现任何激活绕过 / 启动密码逻辑
- 桌面软件无法在网页内运行，作画始终在你本机的 CSP 窗口中进行

CLIP STUDIO PAINT 为 CELSYS 株式会社的商业软件，请通过
[官方网站](https://www.clipstudio.net/) 获取正版。

## 接口

见 [interface.json](interface.json)。核心方法：

| 方法 | 说明 |
| --- | --- |
| `HMCSPBridge.launch()` | 唤起本地 CSP（协议探测） |
| `HMCSPBridge.status()` | 查询联动状态 |
| `HMCSPBridge.importFiles(files)` | 完成稿导入平台资产库 |
| `HMCSPBridge.openAssets()` | 跳转平台资产模块 |

## 平台内集成

- 前端模块：`frontend/sakuga.js`（顶栏切换 + CSP 联动面板）
- 视图容器：`frontend/index.html` 中 `#sakugaTabs` 与 `#view-sakuga`
- 本目录为独立分发版接口，可被第三方页面单独引用
