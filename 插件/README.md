# 绘梦平台 · 插件目录

本目录收录绘梦平台的可扩展插件。每个插件放在独立子目录中，互不干扰。

| 目录 | 插件 | 说明 |
|---|---|---|
| [`blender-bridge/`](./blender-bridge/) | Blender 桥接插件 | 把本地 Blender 渲染到网页平台并可视化操作（WebSocket + 视口画面流） |
| [`miku-player/`](./miku-player/) | 初音胶片音乐播放器 | 可嵌入任何网页的悬浮音乐播放器，内置初音未来 Live2D 唱跳形象 |

## 快速使用

### Blender 桥接
参见 [`blender-bridge/README.md`](./blender-bridge/README.md)。

### 初音胶片播放器（嵌入任意页面）
只需引入一个 JS 文件（已部署到 GitHub Pages，可直接用线上地址）：

```html
<script src="https://liqi279.github.io/huimeng-ai/miku-player.js"></script>
<script>
  // 挂到 body（默认右下角悬浮）
  MikuPlayer.init();

  // 或挂到指定容器
  // MikuPlayer.init('#my-container');
</script>
```

也支持自动挂载——给容器加 `data-miku-player` 属性即可：

```html
<div data-miku-player></div>
<script src="插件/miku-player/dist/miku-player.js"></script>
```

返回的 API 对象提供 `play()` / `pause()` / `toggle()` / `destroy()` 方法。
详见 [`miku-player/README.md`](./miku-player/README.md) 的「嵌入接口」章节。
