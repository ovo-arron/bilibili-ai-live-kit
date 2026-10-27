# 接自己的动态头像

仓库不提供角色素材，也不打包任何 Live2D/Cubism 商业运行时。

## 图片 / 已有动画

把自己的资源放 `user-assets/`，例如 `avatar.webp` 或 `avatar.gif`；在配置里设：

```json
{"avatar":{"mode":"image","url":"/user-assets/avatar.webp"}}
```

这是配置片段，要合并到完整配置再保存。静态 PNG 不会自动变成能眨眼说话的模型；GIF/APNG 动作由文件本身提供。

## 自己的网页模型

把自己的网页模型与授权运行时放 `user-assets/my-avatar/`，或使用已经运行的本机头像网页；设 `mode:"web"`、`url:"/user-assets/my-avatar/index.html"`。网页在 sandbox iframe 中运行。主页面定向把脱敏状态发给这个 iframe，不接受它发来的控制指令。

模型页监听：

```js
window.addEventListener('message', event => {
  if (event.source !== parent || event.data?.type !== 'bili-ai-live-state') return;
  const { speaking, mouth, thought, gameState } = event.data;
  // 只把 mouth（0..1）映射到自己的模型嘴部参数。
  // 眨眼、呼吸与发丝物理在自己的模型页内持续运行。
});
```

`mouth` 来自独立播放器对实际音频的 RMS 测量；不是模型思考时的假说话。浏览器可能要求用户允许播放/启动 AudioContext。播放结束时 `speaking=false`；收到该状态应关闭嘴巴。

自带网页若要求同源存储或外部资源请求，可能需要自行调整自己的集成。不要为了陌生网页关闭全局浏览器安全保护。可先用图片模式验收位置，再接模型。

默认框布局：头像 360 高，上下文字框各150高。配置 `overlay` 可调整宽、高、字号和颜色；本项目不改直播姬场景文件，使用者自己把网页源放到需要的位置。
