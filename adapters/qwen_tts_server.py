"""Optional local Qwen3-TTS Base adapter. Bring your own model and reference.
Not imported by the Node app. Starts only when explicitly run with uvicorn.
"""
import io
import os
import time
import hmac
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

lock = threading.Lock()
model = None
prompt = None


@asynccontextmanager
async def lifespan(app):
    global model, prompt
    import torch
    from qwen_tts import Qwen3TTSModel
    reference = os.environ.get("QWEN_REFERENCE", "")
    if not os.path.isfile(reference):
        raise RuntimeError("Set QWEN_REFERENCE to your own local reference audio")
    device = os.environ.get("QWEN_DEVICE", "cuda:0")
    dtype = torch.bfloat16 if device.startswith("cuda") else torch.float32
    model = Qwen3TTSModel.from_pretrained(
        os.environ.get("QWEN_MODEL", "Qwen/Qwen3-TTS-12Hz-0.6B-Base"),
        device_map=device, dtype=dtype, attn_implementation="sdpa",
    )
    ref_text = os.environ.get("QWEN_REFERENCE_TEXT") or None
    prompt = model.create_voice_clone_prompt(
        ref_audio=reference, ref_text=ref_text,
        x_vector_only_mode=ref_text is None,
    )
    if os.environ.get("QWEN_WARMUP") == "1":
        model.generate_voice_clone(text="语音服务已经准备好了。", language="Chinese", voice_clone_prompt=prompt)
    yield


app = FastAPI(lifespan=lifespan)


class Speech(BaseModel):
    input: str = Field(min_length=1, max_length=400)
    model: str = "local-qwen"
    voice: str = "custom"
    response_format: str = "wav"


@app.get("/health")
def health():
    return {"ready": model is not None, "reference_cached": prompt is not None}


@app.post("/v1/audio/speech")
def speech(data: Speech, authorization: str = Header(default="")):
    import soundfile as sf
    key = os.environ.get("TTS_API_KEY", "")
    if key and not hmac.compare_digest(authorization, "Bearer " + key):
        raise HTTPException(401, "invalid TTS key")
    if data.response_format != "wav":
        raise HTTPException(400, "This adapter returns WAV only")
    started = time.perf_counter()
    with lock:
        waves, rate = model.generate_voice_clone(
            text=data.input, language=os.environ.get("QWEN_LANGUAGE", "Chinese"),
            voice_clone_prompt=prompt,
        )
    output = io.BytesIO()
    sf.write(output, waves[0], rate, format="WAV", subtype="PCM_16")
    return Response(output.getvalue(), media_type="audio/wav", headers={
        "X-Synthesis-Ms": str(round((time.perf_counter() - started) * 1000)),
    })
