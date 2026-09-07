"""语音转文字 sidecar：FunASR + ModelScope iic/SenseVoiceSmall。

本机开发用独立进程（与 tools/ 下既有离线工具同约定，不进 compose）。
启动：uvicorn server:app --host 127.0.0.1 --port 5005
首跑自动从 ModelScope 下载 SenseVoiceSmall（约 936MB）+ fsmn-vad，请耐心等启动完成。
仅接受 16kHz 单声道 WAV（前端负责转码，全链路零 ffmpeg）。
"""
import io
import os

import soundfile as sf
import torch
from fastapi import FastAPI, UploadFile
from fastapi.responses import JSONResponse
from funasr import AutoModel
from funasr.utils.postprocess_utils import rich_transcription_postprocess

DEVICE = "cuda:0" if torch.cuda.is_available() else "cpu"
MODEL_ID = "iic/SenseVoiceSmall"
SAMPLE_RATE = 16000

model = AutoModel(
    model=MODEL_ID,
    vad_model="fsmn-vad",
    vad_kwargs={"max_single_segment_time": 30000},
    device=DEVICE,
    disable_update=True,
)

app = FastAPI(title="cyber-sister-asr")


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_ID, "device": DEVICE}


@app.post("/transcribe")
async def transcribe(file: UploadFile):
    raw = await file.read()
    if not raw:
        return JSONResponse(status_code=400, content={"error": "音频为空"})
    try:
        audio, sample_rate = sf.read(io.BytesIO(raw), dtype="float32", always_2d=True)
    except Exception:
        return JSONResponse(status_code=400, content={"error": "无法解析音频，需要 16kHz 单声道 WAV"})
    if sample_rate != SAMPLE_RATE or audio.shape[1] != 1:
        return JSONResponse(
            status_code=400,
            content={"error": f"需要 {SAMPLE_RATE}Hz 单声道 WAV（当前 {sample_rate}Hz/{audio.shape[1]} 声道）"},
        )
    try:
        result = model.generate(
            input=audio[:, 0],
            cache={},
            language="auto",
            use_itn=True,
            batch_size_s=60,
            merge_vad=True,
            merge_length_s=15,
        )
    except Exception as error:  # sidecar 如实上报推理失败
        return JSONResponse(status_code=500, content={"error": f"推理失败：{error}"})
    text = rich_transcription_postprocess(result[0]["text"]) if result else ""
    return {"text": text}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("ASR_PORT", "5005")))
