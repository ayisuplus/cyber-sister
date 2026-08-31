#!/usr/bin/env python3
"""
批量标注脚本：用 MiniMax Vision 模型给妆教图片生成结构化属性
"""

import json
import os
import sys
import time
import re
import shutil
import tempfile
import subprocess
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).parent.parent
DATA_DIR = PROJECT_ROOT / "data" / "xhs_raw"
ANNOTATIONS_FILE = PROJECT_ROOT / "data" / "annotations.jsonl"
TEMP_DIR = PROJECT_ROOT / "data" / "_temp_imgs"

PROMPT = """分析这张美妆图片，用JSON返回以下字段（只返回JSON，不要其他文字）：
{
  "style": "妆容风格（白开水妆/蜜桃妆/纯欲妆/辣妹妆/伪素颜妆/欧美妆/日系妆/韩系妆/中式妆/复古妆/其他）",
  "lip_color": "唇色描述",
  "eyeshadow": "眼影描述",
  "blush": "腮红描述",
  "skin_finish": "底妆质感（光泽奶油肌/哑光雾面/水光肌/自然裸肌）",
  "techniques": ["可见技法列表"],
  "difficulty": "easy/medium/hard",
  "occasion": "适合场合",
  "vibe": "整体氛围词",
  "dominant_colors": ["主色调"]
}"""


def collect_images() -> list[dict]:
    """收集所有图片文件及其元数据"""
    images = []
    for keyword_dir in DATA_DIR.iterdir():
        if not keyword_dir.is_dir() or keyword_dir.name.startswith("."):
            continue
        for note_dir in keyword_dir.iterdir():
            if not note_dir.is_dir():
                continue
            for img_file in note_dir.glob("*.jpg"):
                images.append({
                    "path": str(img_file),
                    "keyword": keyword_dir.name,
                    "note_id": note_dir.name,
                    "filename": img_file.name,
                })
    return images


def prepare_temp_copy(img_path: str) -> str:
    """复制图片到临时目录（ASCII路径），避免中文路径问题"""
    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    src = Path(img_path)
    # 用 hash 保证唯一性
    name_hash = hash(img_path) & 0xFFFFFFFF
    dst = TEMP_DIR / f"img_{name_hash:08d}{src.suffix}"
    shutil.copy2(src, dst)
    return str(dst)


def call_vision_api(image_path: str, retry: int = 2) -> dict | None:
    """调用 MiniMax understand_image（通过 MCP CLI 或直接 HTTP）"""
    # 先复制到临时目录
    temp_path = prepare_temp_copy(image_path)

    for attempt in range(retry + 1):
        try:
            # 用 hermes 的 MCP 工具直接调用
            # 由于 Python 脚本无法直接调 MCP，我们用 subprocess 调 hermes CLI
            # 或者直接用 httpx 调 MiniMax API
            # 这里用简化方案：写一个临时的 Node.js 脚本调 MCP

            # 更好的方案：直接用 MiniMax API
            import httpx

            api_key = os.environ.get("MINIMAX_API_KEY", "")
            if not api_key:
                # 从 hermes config 读取
                config_path = Path.home() / "AppData/Local/hermes/config.yaml"
                if config_path.exists():
                    import yaml
                    with open(config_path, "r", encoding="utf-8") as f:
                        config = yaml.safe_load(f)
                    api_key = (config.get("mcp_servers", {})
                               .get("MiniMax", {})
                               .get("env", {})
                               .get("MINIMAX_API_KEY", ""))

            if not api_key:
                print("  ❌ 找不到 MINIMAX_API_KEY")
                return None

            # 读取图片为 base64
            import base64
            with open(temp_path, "rb") as f:
                img_data = base64.b64encode(f.read()).decode()

            # 判断格式
            suffix = Path(temp_path).suffix.lower()
            mime = {"jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}.get(suffix, "image/jpeg")

            # MiniMax Vision API
            url = os.environ["ARCHIVE_LLM_BASE_URL"]
            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            }
            payload = {
                "model": os.environ["ARCHIVE_LLM_MODEL"],
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{img_data}"}},
                            {"type": "text", "text": PROMPT},
                        ],
                    }
                ],
                "max_tokens": 1000,
            }

            resp = httpx.post(url, json=payload, headers=headers, timeout=60)
            resp.raise_for_status()
            data = resp.json()

            content = data["choices"][0]["message"]["content"]
            # 提取 JSON
            json_match = re.search(r'```(?:json)?\s*\n?(.*?)\n?\s*```', content, re.DOTALL)
            if json_match:
                return json.loads(json_match.group(1))
            else:
                # 尝试直接解析
                return json.loads(content.strip())

        except Exception as e:
            if attempt < retry:
                print(f"  ⚠️  重试 {attempt+1}/{retry}: {e}")
                time.sleep(3)
            else:
                print(f"  ❌ 失败: {e}")
                return None
        finally:
            # 清理临时文件
            try:
                os.remove(temp_path)
            except:
                pass

    return None


def annotate_batch(images: list[dict], start_idx: int = 0, delay: float = 2.0):
    """批量标注"""
    total = len(images)
    success = 0
    failed = 0

    for i, img in enumerate(images[start_idx:], start=start_idx):
        print(f"\n📷 [{i+1}/{total}] {img['keyword']}/{img['note_id'][:12]}...")

        result = call_vision_api(img["path"])

        if result:
            record = {
                **img,
                "annotation": result,
                "annotated_at": datetime.now().isoformat(),
            }
            with open(ANNOTATIONS_FILE, "a", encoding="utf-8") as f:
                f.write(json.dumps(record, ensure_ascii=False) + "\n")
            success += 1
            print(f"  ✅ {result.get('style', '?')} | {result.get('vibe', '?')}")
        else:
            failed += 1

        # 速率控制
        if i < total - 1:
            time.sleep(delay)

        # 每50张报告一次进度
        if (i + 1) % 50 == 0:
            print(f"\n📊 进度: {i+1}/{total} | 成功: {success} | 失败: {failed}")

    print(f"\n{'='*50}")
    print(f"🎉 标注完成！成功: {success} | 失败: {failed} | 总计: {total}")
    print(f"   输出文件: {ANNOTATIONS_FILE}")


def main():
    import argparse
    parser = argparse.ArgumentParser(description="批量标注妆教图片")
    parser.add_argument("--start", type=int, default=0, help="从第几张开始（用于断点续传）")
    parser.add_argument("--limit", type=int, default=0, help="最多标注几张（0=全部）")
    parser.add_argument("--delay", type=float, default=2.0, help="请求间隔秒数")
    parser.add_argument("--test", action="store_true", help="只标注前3张测试")
    args = parser.parse_args()

    images = collect_images()
    print(f"🖼️  找到 {len(images)} 张图片")

    if args.test:
        images = images[:3]
        print(f"   测试模式: 只标注前3张")
    elif args.limit > 0:
        images = images[:args.limit]

    # 检查已完成的（断点续传）
    if ANNOTATIONS_FILE.exists() and args.start == 0:
        with open(ANNOTATIONS_FILE, "r", encoding="utf-8") as f:
            done = set()
            for line in f:
                try:
                    r = json.loads(line)
                    done.add(r.get("path", ""))
                except:
                    pass
        before = len(images)
        images = [img for img in images if img["path"] not in done]
        print(f"   已标注: {before - len(images)} 张, 待标注: {len(images)} 张")

    if not images:
        print("没有需要标注的图片")
        return

    annotate_batch(images, delay=args.delay)


if __name__ == "__main__":
    main()
