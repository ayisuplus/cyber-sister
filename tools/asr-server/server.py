"""语音转文字 sidecar：FunASR + ModelScope iic/SenseVoiceSmall。

本机开发用独立进程（与 tools/ 下既有离线工具同约定，不进 compose），装在本目录的独立环境里，不动全局 Python：
  python -m venv .venv
  .venv\\Scripts\\python -m pip install -r requirements.txt
  .venv\\Scripts\\python server.py            （或 .venv\\Scripts\\uvicorn server:app --host 127.0.0.1 --port 5005）
首跑自动从 ModelScope 下载 SenseVoiceSmall（约 936MB）+ fsmn-vad，请耐心等启动完成；设了 MODELSCOPE_CACHE 就读那里的缓存。
仅接受 16kHz 单声道 WAV（前端负责转码，全链路零 ffmpeg）。
返回 {text, emotions, events}：文字里不带表情，情绪与事件标签单独列出，主 API 只把文字交给浏览器（见 asr_core.py）。
"""
import io
import os

import soundfile as sf
from fastapi import FastAPI, UploadFile
from fastapi.responses import JSONResponse

import asr_core

DEVICE = asr_core.pick_device()
model = asr_core.load_model(DEVICE)

app = FastAPI(title="cyber-sister-asr")


@app.get("/health")
def health():
    return {"status": "ok", "model": asr_core.MODEL_ID, "device": DEVICE}


@app.post("/transcribe")
async def transcribe(file: UploadFile):
    raw = await file.read()
    if not raw:
        return JSONResponse(status_code=400, content={"error": "音频为空"})
    try:
        audio, sample_rate = sf.read(io.BytesIO(raw), dtype="float32", always_2d=True)
    except Exception:
        return JSONResponse(status_code=400, content={"error": "无法解析音频，需要 16kHz 单声道 WAV"})
    if sample_rate != asr_core.SAMPLE_RATE or audio.shape[1] != 1:
        return JSONResponse(
            status_code=400,
            content={"error": f"需要 {asr_core.SAMPLE_RATE}Hz 单声道 WAV（当前 {sample_rate}Hz/{audio.shape[1]} 声道）"},
        )
    try:
        return asr_core.transcribe(model, audio[:, 0])
    except Exception as error:  # sidecar 如实上报推理失败
        return JSONResponse(status_code=500, content={"error": f"推理失败：{error}"})


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("ASR_PORT", "5005")))
