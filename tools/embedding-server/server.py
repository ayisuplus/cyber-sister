"""本机向量服务：ModelScope 句向量模型 + OpenAI 兼容的 /v1/embeddings（记忆检索与书架选章共用）。

日常由一键启动（仓库根目录 start-amie.cmd 或 pnpm start:local）跟着产品一起起，令牌文件、模型与端口从 apps/api/.env 读。
单独起时同 tools/asr-server 的约定（不进 compose），装在本目录的独立环境里，不动全局 Python：
  python -m venv .venv
  .venv\\Scripts\\python -m pip install -r requirements.txt
  set EMBEDDING_API_KEY_FILE=<令牌文件>          （主 API 的 MEMORY_EMBEDDING_API_KEY_FILE 指向同一个文件）
  .venv\\Scripts\\python server.py                （只听 127.0.0.1，端口 EMBEDDING_PORT，默认 5006）
首跑自动从 ModelScope 下载模型（默认 Qwen/Qwen3-Embedding-0.6B，约 1.2GB；设了 MODELSCOPE_CACHE 就读那里的缓存）。
算向量只在这台电脑上，不联网、不花钱。
"""
import os

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

import embed_core

TOKEN = embed_core.read_token()
model = embed_core.load_model()
# sentence-transformers 6 起改名为 get_embedding_dimension；旧版只有 get_sentence_embedding_dimension
DIMENSIONS = (getattr(model, "get_embedding_dimension", None) or model.get_sentence_embedding_dimension)()

app = FastAPI(title="cyber-sister-embedding")


@app.get("/health")
def health():
    return {"status": "ok", "model": embed_core.MODEL_ID, "dimensions": DIMENSIONS}


@app.post("/v1/embeddings")
async def embeddings(request: Request):
    if not embed_core.authorized(request.headers.get("authorization"), TOKEN):
        return JSONResponse(status_code=401, content={"error": "令牌不对"})
    try:
        body = await request.json()
    except ValueError:
        return JSONResponse(status_code=400, content={"error": "请求体不是 JSON"})
    texts, problem = embed_core.parse_request(body)
    if problem:
        return JSONResponse(status_code=400, content={"error": problem})
    try:
        return embed_core.build_response(embed_core.embed(model, texts))
    except Exception as error:  # 如实上报推理失败，不回半截向量
        return JSONResponse(status_code=500, content={"error": f"推理失败：{error}"})


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("EMBEDDING_PORT", "5006")))
