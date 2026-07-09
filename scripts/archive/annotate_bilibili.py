#!/usr/bin/env python3
"""批量标注B站封面图"""
import json, os, sys, time, re, base64
from pathlib import Path
from datetime import datetime

DATA_DIR = Path("E:/projects/AI妆教/data/bilibili")
COVERS_DIR = DATA_DIR / "covers"
METADATA_FILE = DATA_DIR / "metadata.jsonl"
ANNOTATIONS_FILE = DATA_DIR / "annotations.jsonl"

PROMPT = "分析这张美妆视频封面图，用JSON返回：style(妆容风格), lip_color(唇色), eyeshadow(眼影), blush(腮红), skin_finish(底妆质感), techniques(技法列表), difficulty(easy/medium/hard), vibe(氛围). 只返回JSON。"

def get_api_key():
    import yaml
    config_path = Path.home() / "AppData/Local/hermes/config.yaml"
    with open(config_path, "r", encoding="utf-8") as f:
        config = yaml.safe_load(f)
    return (config.get("mcp_servers", {}).get("MiniMax", {}).get("env", {}).get("MINIMAX_API_KEY", ""))

def annotate_image(img_path: str, api_key: str) -> dict | None:
    try:
        import httpx
        with open(img_path, "rb") as f:
            img_data = base64.b64encode(f.read()).decode()
        resp = httpx.post(
            "https://api.minimaxi.com/v1/chat/completions",
            json={
                "model": "MiniMax-M3",
                "messages": [{"role": "user", "content": [
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{img_data}"}},
                    {"type": "text", "text": PROMPT},
                ]}],
                "max_tokens": 800,
            },
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            timeout=60,
        )
        resp.raise_for_status()
        content = resp.json()["choices"][0]["message"]["content"]
        m = re.search(r'```(?:json)?\s*\n?(.*?)\n?\s*```', content, re.DOTALL)
        return json.loads(m.group(1) if m else content.strip())
    except:
        return None

def main():
    api_key = get_api_key()
    if not api_key:
        print("❌ 找不到 API key")
        return

    # 加载元数据
    with open(METADATA_FILE, "r", encoding="utf-8") as f:
        metadata = {json.loads(line)["bvid"]: json.loads(line) for line in f}

    # 已完成的
    done = set()
    if ANNOTATIONS_FILE.exists():
        with open(ANNOTATIONS_FILE, "r", encoding="utf-8") as f:
            for line in f:
                try:
                    done.add(json.loads(line).get("bvid", ""))
                except:
                    pass

    covers = list(COVERS_DIR.glob("*.jpg"))
    todo = [c for c in covers if c.stem not in done]
    print(f"🖼️  总封面: {len(covers)}, 待标注: {len(todo)}, 已完成: {len(done)}")

    success = 0
    for i, cover in enumerate(todo):
        bvid = cover.stem
        meta = metadata.get(bvid, {})
        title = meta.get("title", "?")

        ann = annotate_image(str(cover), api_key)
        record = {
            "bvid": bvid,
            "source": "bilibili",
            "keyword": meta.get("keyword", ""),
            "title": title,
            "author": meta.get("author", ""),
            "likes": meta.get("likes", 0),
            "cover_path": str(cover),
            "annotation": ann,
            "annotated_at": datetime.now().isoformat(),
        }

        with open(ANNOTATIONS_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")

        if ann:
            success += 1
            print(f"  [{i+1}/{len(todo)}] ✅ {ann.get('style','?')} | {title[:30]}")
        else:
            print(f"  [{i+1}/{len(todo)}] ❌ {title[:30]}")

        if (i + 1) % 50 == 0:
            print(f"\n📊 进度: {i+1}/{len(todo)} | 成功: {success}\n")

        time.sleep(1)

    print(f"\n🎉 标注完成！成功: {success}/{len(todo)}")

if __name__ == "__main__":
    main()
