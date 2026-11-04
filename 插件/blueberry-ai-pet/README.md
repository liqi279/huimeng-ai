# 蓝莓酱 AI 桌宠（Blueberry AI Pet）

来自 `Blueberry-AI-Pet` 桌宠项目的可复用插件版本：Electron 透明桌宠 + AI（Ollama / Qwen3、OpenAI 兼容）+ 语音输入 / 朗读 + 一套可嵌入任意网页的 Web SDK。

- 桌面版：透明无边框窗口、置顶、拖动、双击开聊天、退出 / 隐藏按钮
- 网页版：`web/blueberry-pet-web.js` 单文件 SDK，一个 `BlueberryPet.init()` 即可在任意页面接入形象与 AI 语音聊天
- 形象素材：`assets/blueberry-avatar.png`（透明底、已优化）与 `assets/blueberry-reference.webp`（参考立绘）
- Live2D：保留了接入代码，但**不包含** Cubism SDK / `.moc3` 正式模型，需自行放入 `vendor/live2d/` 与 `live2d/model/`

## 目录

```
blueberry-ai-pet/
├── main.js / preload.js            Electron 主进程与预加载（透明窗口、置顶、IPC、AI 请求）
├── pet-live2d.html / .css / .js    桌面形象层（Live2D 加载入口，缺运行时自动降级）
├── chat.html / .css / .js          聊天窗口 UI
├── index.html / renderer.js / style.css   基础页面
├── assets/                         立绘与参考图
├── live2d/model/                   放置 .moc3 模型（当前为空）
├── vendor/live2d/                  放置 Cubism Core 与 Pixi Live2D 运行库（当前为空）
├── web/
│   ├── blueberry-pet-web.js        Web 接入 SDK（无依赖，单文件）
│   └── demo.html                   SDK 演示页
└── README.md / LICENSE / 说明文档
```

## 桌面版运行

```bash
cd blueberry-ai-pet
npm install        # 安装 Electron 等依赖（包内不含 node_modules）
npm start          # 启动桌宠
```

AI 默认连接本机 Ollama：

| 项 | 默认值 |
|---|---|
| provider | `ollama` |
| baseUrl | `http://localhost:11434` |
| model | `qwen3:4b` |
| 备选 | OpenAI 兼容接口（`/responses`），需填写 API Key |

准备本地模型：

```bash
ollama pull qwen3:4b
ollama serve
```

设置保存在 Electron 的 `userData/settings.json`，聊天窗口右上角「设置」可切换服务、模型、接口地址与 Key。桌宠对 Qwen3 的 `<think>` 思考内容做了过滤，不会出现在聊天正文。

Live2D 模型需要自行获取（受 License 约束，随包不含）：

1. 把 `*.moc3`、纹理与 `blueberry.model3.json` 放入 `live2d/model/`；
2. 把 `live2dcubismcore.min.js`、`pixi.min.js`、`pixi-live2d-display.min.js` 放入 `vendor/live2d/`；
3. 参见 `LIVE2D-接入说明.txt`。

缺少运行库时，桌宠会自动退化为可拖动的立绘，聊天功能不受影响。

## Web SDK 接入（任意页面 / 工程）

单文件、零依赖。复制 `web/blueberry-pet-web.js` 到你的项目，或直接引用：

```html
<script src="/path/to/blueberry-pet-web.js"></script>
<script>
  var pet = BlueberryPet.init({
    height: 280,
    right: 32,
    bottom: 24,
    api: { provider: 'ollama', baseUrl: 'http://localhost:11434', model: 'qwen3:4b' }
  });
</script>
```

挂到某个容器内部（相对定位，不遮挡全局）：

```js
BlueberryPet.init({ container: '#my-desk', height: 240, right: 12, bottom: 12 });
```

### `init(options)` 参数

| 参数 | 默认 | 说明 |
|---|---|---|
| `container` | 无（挂到 body） | 选择器或元素，传入后改为容器内绝对定位 |
| `avatar` | 内置立绘 | 自定义图片 URL，可换成自己的形象 |
| `height` | `260` | 形象高度（px），宽度按比例自适应 |
| `right` / `bottom` | `24` / `16` | 初始位置（仅在无历史位置时生效） |
| `x` / `y` | 无 | 直接指定坐标，优先级最高 |
| `zIndex` | `99998` | 层级 |
| `persist` | `true` | 是否把拖动位置记录到 localStorage |
| `greet` | `true` | 启动后是否打招呼（头顶气泡） |
| `greetings` | 内置 | 打招呼文案数组 |
| `tip` / `tipText` | 显示 | 悬停提示，`tip:false` 关闭 |
| `api` | `{provider:'ollama',baseUrl:'http://localhost:11434',model:'qwen3:4b'}` | AI 接口配置 |
| `systemPrompt` | 蓝莓酱人格 | 覆盖系统提示词 |
| `menu` | `[]` | 追加菜单项 `{ label, onClick(pet) }` |
| `onReady` / `onOpenChat` / `onCloseChat` / `onReply` / `onError` | 无 | 生命周期回调 |

### 实例方法

```js
pet.openChat();  pet.closeChat();  pet.toggleChat();
pet.ask('帮我写一句生日祝福');     // Promise<{ text } | { error, text }>
pet.say('主人早上好～');            // 头顶气泡
pet.speak('这段文字会被朗读');      // 系统语音
pet.stopSpeak();
pet.moveTo(40, 40); pet.hide(); pet.show();
pet.setAvatar('/img/my-avatar.png'); pet.setSize(300);
pet.configure({ model: 'qwen3:8b', tts: false });
pet.getSettings(); pet.resetHistory(); pet.destroy();
```

全局快捷方式（作用于第一个实例）：

```js
BlueberryPet.ask('你好');
BlueberryPet.openChat();
BlueberryPet.destroy();
```

交互约定：拖动移动、单击打招呼、双击打开聊天、右键呼出菜单（聊天 / 设置 / 隐藏）。

自动挂载（可选，二选一）：

```html
<script src="blueberry-pet-web.js" data-auto-pet></script>
```

或引入前设 `window.BLUEBERRY_PET_AUTO = true`。

### 语音能力

- 语音输入：`SpeechRecognition`（`zh-CN`），浏览器需支持（Chrome / Edge），并允许麦克风权限
- 语音朗读：`SpeechSynthesis`，自动优先选择中文女声
- 接口地址与模型可在聊天面板「设置」里修改，保存在 `localStorage: blueberry.pet.settings`

## 跨域与混合内容（重要）

1. **Ollama 跨域**：启动前设置环境变量
   ```bash
   # Windows PowerShell
   $env:OLLAMA_ORIGINS="*"; ollama serve
   # macOS / Linux
   OLLAMA_ORIGINS=* ollama serve
   ```
2. **HTTPS 页面**：浏览器会拦截 HTTPS 页面对 `http://localhost` 的请求（混合内容）。
   解决方式：用 `http` 页面 / 本地文件打开；或给 Ollama 配 HTTPS 反向代理，把 `baseUrl` 改成代理地址；
   或在 Electron / Tauri 里由主进程代发请求（桌面版 `main.js` 就是这样做的）。
3. **OpenAI 兼容接口**：在面板里选择「OpenAI 兼容」，填 `baseUrl`（如 `https://api.openai.com/v1`）、模型与 API Key。

## License

`LICENSE` 随项目附带，使用与二次分发请遵守原项目许可；Live2D Cubism SDK 与模型受 Live2D 官方许可约束，需自行取得。
