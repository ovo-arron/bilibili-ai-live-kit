# 声音接入与首段延迟

核心程序不带语音模型和参考音频。接已有 OpenAI-compatible TTS 服务最简单：请求 `/v1/audio/speech`，发送 `{model,voice,input,response_format}`，返回 WAV/MP3/OGG **音频字节**。返回音频路径的 JSON 不兼容，需要先写适配器。

## 可选 Qwen3-TTS 本机适配器

按 [官方 Qwen3-TTS 文档](https://github.com/QwenLM/Qwen3-TTS) 准备 Python、适合硬件的 PyTorch 和模型。此仓库的薄适配器使用官方 Base 模型接口；不内置第三方流式 fork。

在单独 Python 虚拟环境里安装 `adapters/requirements-qwen.txt`，设置：

```text
QWEN_MODEL=Qwen/Qwen3-TTS-12Hz-0.6B-Base
QWEN_REFERENCE=你自己电脑上的授权参考音频路径
QWEN_REFERENCE_TEXT=参考音频对应文字（建议准确填写）
QWEN_DEVICE=cuda:0
QWEN_WARMUP=1
```

这些变量要在启动适配器的环境中设置；Node 的 `.env` 不会自动注入独立 Python 进程。若使用 TTS_API_KEY，两个进程要设置同一个值。启动：

```sh
python -m uvicorn adapters.qwen_tts_server:app --host 127.0.0.1 --port 8001 --workers 1
```

GPU型号、PyTorch与qwen-tts版本需要自行匹配；CPU可试 `QWEN_DEVICE=cpu`，速度可能不足以直播。适配器在启动时加载一次模型、缓存一次参考提示；`QWEN_WARMUP=1` 只在内存里预热，不播放声音。不要多开 workers 反复占显存。

核心配置设 voice enabled true，URL `http://127.0.0.1:8001/v1/audio/speech`，format `wav`，model可写 `local-qwen`、voice写 `custom`。实际声线取自适配器的本机参考音频，不会使用任何原作者角色声线。

## 已做的提速与限制

- WebSocket接收和SSE推送不等待模型/TTS；思路文字也不等待声音。
- 回答按完整句末分块，尽量约70字一块；不把自然语言强切成碎字。长句没有句号时保留完整句，首段可能较慢。
- 参考提示和模型常驻；一条在播时可以预备后续句块/下一条，最多预备两个任务。
- 只有一个拥有播放租约的播放器，播放结束真实回执才推进队列。

当前返回每个完整句块的音频，**不是 token 级音频流式**。缓存与预取不等于模型首包延迟更低。冷启动、网络、服务排队与GPU都会影响速度；请用控制台实际 `ttsLastSegmentMs` 和 `selectedToPlaybackMs` 观察。适配器源代码已提供，但发布前的隔离测试不加载GPU模型、不克隆/播放任何人声；首次真实使用须自行验收。
