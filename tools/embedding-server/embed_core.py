"""本机向量服务的核心：从 ModelScope 下载句向量模型，按 OpenAI /v1/embeddings 的格式回向量。

纯函数（请求解析、令牌核对、响应组装）不依赖模型，单测直接测；加载模型只在 load_model 里。
"""
import hmac
import os

# 默认 Qwen/Qwen3-Embedding-0.6B：Apache-2.0，1024 维，约 1.2GB，CPU 上一句话约 0.1 秒，整章也能读完（32k）。
# 2026-09-24 在书架选章检验集上和 BAAI/bge-small-zh-v1.5（MIT，512 维，只读前 512 个字）比过：
# 同样零误翻，换个说法能补上的 Qwen3 远多于 bge-small，见 docs/04-开发/书架选章评测.md。
# 换模型设 EMBEDDING_MODEL_ID，主 API 的 MEMORY_EMBEDDING_MODEL / MEMORY_EMBEDDING_DIMENSIONS 要跟着改，
# 并重建书架索引（books:index）与记忆投影。
MODEL_ID = os.environ.get("EMBEDDING_MODEL_ID", "Qwen/Qwen3-Embedding-0.6B")
MAX_INPUTS = 64
MAX_CHARS = 8000


def read_token():
    """令牌从文件读（EMBEDDING_API_KEY_FILE），不在命令行和日志里出现；没配就不启动。"""
    path = os.environ.get("EMBEDDING_API_KEY_FILE")
    if not path:
        raise SystemExit("需要 EMBEDDING_API_KEY_FILE：主 API 的 MEMORY_EMBEDDING_API_KEY_FILE 指向同一个文件")
    with open(path, encoding="utf-8") as handle:
        token = handle.read().strip()
    if not token:
        raise SystemExit("EMBEDDING_API_KEY_FILE 是空的")
    return token


def authorized(header, token):
    """Authorization: Bearer <令牌>，按恒定时间比较。"""
    if not isinstance(header, str) or not header.startswith("Bearer "):
        return False
    return hmac.compare_digest(header[len("Bearer "):].encode(), token.encode())


def parse_request(body, model_id=MODEL_ID):
    """把请求体整理成一组字符串；不对就返回 (None, 错误说明)。"""
    if not isinstance(body, dict):
        return None, "请求体要是 JSON 对象"
    if body.get("model") not in (None, model_id):
        return None, f"这里只有 {model_id}"
    inputs = body.get("input")
    texts = [inputs] if isinstance(inputs, str) else inputs
    if not isinstance(texts, list) or not texts or not all(isinstance(text, str) and text.strip() for text in texts):
        return None, "input 要是非空字符串或非空字符串数组"
    if len(texts) > MAX_INPUTS or any(len(text) > MAX_CHARS for text in texts):
        return None, f"一次最多 {MAX_INPUTS} 段、每段最多 {MAX_CHARS} 字"
    return texts, None


def build_response(vectors, model_id=MODEL_ID):
    return {
        "object": "list",
        "model": model_id,
        "data": [{"object": "embedding", "index": index, "embedding": [float(value) for value in vector]} for index, vector in enumerate(vectors)],
    }


def load_model(model_id=MODEL_ID):
    """首跑从 ModelScope 下载（设了 MODELSCOPE_CACHE 就读那里的缓存），之后离线可用。"""
    from modelscope import snapshot_download
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(snapshot_download(model_id), device="cpu")


def embed(model, texts):
    """L2 归一化后的句向量（余弦相似度即点积）。"""
    return model.encode(texts, normalize_embeddings=True, convert_to_numpy=True).tolist()
