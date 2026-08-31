#!/usr/bin/env python3
"""
数据增强脚本：
1. 对现有386张图片做变换（翻转/色彩抖动/裁剪）→ 膨胀3倍
2. 用 MiniMax API 标注 MCP 新数据的文字内容
3. 合并所有数据为统一训练集
"""

import json
import os
import sys
import time
import re
import base64
import random
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).parent.parent
DATA_DIR = PROJECT_ROOT / "data"
ANNOTATIONS_FILE = DATA_DIR / "annotations.jsonl"
METADATA_FILE = DATA_DIR / "metadata.jsonl"
AUGMENTED_FILE = DATA_DIR / "augmented_annotations.jsonl"
TRAINING_FILE = DATA_DIR / "training_dataset.jsonl"


def get_api_key() -> str:
    config_path = Path.home() / "AppData/Local/hermes/config.yaml"
    if config_path.exists():
        import yaml
        with open(config_path, "r", encoding="utf-8") as f:
            config = yaml.safe_load(f)
        key = (config.get("mcp_servers", {})
               .get("MiniMax", {})
               .get("env", {})
               .get("MINIMAX_API_KEY", ""))
        if key:
            return key
    return os.environ.get("MINIMAX_API_KEY", "")


def augment_image(img_path: str, output_dir: str, aug_type: str) -> str | None:
    """对图片做数据增强"""
    try:
        from PIL import Image, ImageEnhance, ImageOps
        img = Image.open(img_path)
        
        if aug_type == "flip":
            img = ImageOps.mirror(img)
        elif aug_type == "brightness":
            enhancer = ImageEnhance.Brightness(img)
            img = enhancer.enhance(random.uniform(0.8, 1.2))
        elif aug_type == "contrast":
            enhancer = ImageEnhance.Contrast(img)
            img = enhancer.enhance(random.uniform(0.8, 1.2))
        elif aug_type == "saturation":
            enhancer = ImageEnhance.Color(img)
            img = enhancer.enhance(random.uniform(0.8, 1.2))
        elif aug_type == "crop":
            w, h = img.size
            crop_ratio = random.uniform(0.85, 0.95)
            new_w, new_h = int(w * crop_ratio), int(h * crop_ratio)
            left = random.randint(0, w - new_w)
            top = random.randint(0, h - new_h)
            img = img.crop((left, top, left + new_w, top + new_h))
            img = img.resize((w, h), Image.LANCZOS)
        
        os.makedirs(output_dir, exist_ok=True)
        base = Path(img_path).stem
        out_path = os.path.join(output_dir, f"{base}_{aug_type}.jpg")
        img.save(out_path, "JPEG", quality=90)
        return out_path
    except Exception as e:
        return None


def text_to_annotation(text: str, keyword: str, api_key: str) -> dict | None:
    """用 MiniMax API 从文字描述提取结构化妆容属性"""
    try:
        import httpx
        
        prompt = f"""根据以下小红书妆容笔记的文字内容，提取结构化妆容属性，用JSON返回：
{{
  "style": "妆容风格",
  "lip_color": "唇色",
  "eyeshadow": "眼影",
  "blush": "腮红",
  "skin_finish": "底妆质感",
  "techniques": ["技法列表"],
  "difficulty": "easy/medium/hard",
  "vibe": "氛围"
}}

笔记内容：
{text[:500]}

关键词：{keyword}
只返回JSON。"""

        url = os.environ["ARCHIVE_LLM_BASE_URL"]
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": os.environ["ARCHIVE_LLM_MODEL"],
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 500,
        }

        resp = httpx.post(url, json=payload, headers=headers, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        content = data["choices"][0]["message"]["content"]

        json_match = re.search(r'```(?:json)?\s*\n?(.*?)\n?\s*```', content, re.DOTALL)
        if json_match:
            return json.loads(json_match.group(1))
        return json.loads(content.strip())
    except:
        return None


def main():
    import argparse
    parser = argparse.ArgumentParser(description="数据增强")
    parser.add_argument("--augment-images", action="store_true", help="对图片做数据增强")
    parser.add_argument("--annotate-text", action="store_true", help="标注MCP文字数据")
    parser.add_argument("--merge", action="store_true", help="合并为训练集")
    parser.add_argument("--all", action="store_true", help="执行所有步骤")
    args = parser.parse_args()

    if args.all:
        args.augment_images = args.annotate_text = args.merge = True

    api_key = get_api_key()

    # Step 1: 图片数据增强
    if args.augment_images:
        print("🖼️  图片数据增强...")
        with open(ANNOTATIONS_FILE, "r", encoding="utf-8") as f:
            annotations = [json.loads(line) for line in f]
        
        aug_count = 0
        aug_dir = DATA_DIR / "augmented_images"
        
        for ann in annotations:
            img_path = ann.get("path", "")
            if not img_path or not os.path.exists(img_path):
                continue
            
            for aug_type in ["flip", "brightness", "contrast", "saturation", "crop"]:
                new_path = augment_image(img_path, str(aug_dir), aug_type)
                if new_path:
                    new_ann = {
                        **ann,
                        "path": new_path,
                        "annotation": {**ann.get("annotation", {}), "augmentation": aug_type},
                        "is_augmented": True,
                    }
                    with open(AUGMENTED_FILE, "a", encoding="utf-8") as f:
                        f.write(json.dumps(new_ann, ensure_ascii=False) + "\n")
                    aug_count += 1
        
        print(f"   生成 {aug_count} 张增强图片")

    # Step 2: 标注MCP文字数据
    if args.annotate_text and api_key:
        print("📝 标注MCP文字数据...")
        with open(METADATA_FILE, "r", encoding="utf-8") as f:
            metadata = [json.loads(line) for line in f]
        
        text_ann_count = 0
        for i, record in enumerate(metadata):
            content = record.get("content", "")
            keyword = record.get("keyword", "")
            
            if not content or len(content) < 20:
                continue
            
            annotation = text_to_annotation(content, keyword, api_key)
            if annotation:
                text_ann = {
                    "source": "text_mcp",
                    "note_id": record.get("note_id", ""),
                    "keyword": keyword,
                    "title": record.get("title", ""),
                    "content": content,
                    "annotation": annotation,
                }
                with open(AUGMENTED_FILE, "a", encoding="utf-8") as f:
                    f.write(json.dumps(text_ann, ensure_ascii=False) + "\n")
                text_ann_count += 1
            
            if (i + 1) % 50 == 0:
                print(f"   进度: {i+1}/{len(metadata)}")
            time.sleep(1)
        
        print(f"   标注 {text_ann_count} 条文字数据")

    # Step 3: 合并训练集
    if args.merge:
        print("📦 合并训练集...")
        all_records = []
        
        # 原始图片标注
        if ANNOTATIONS_FILE.exists():
            with open(ANNOTATIONS_FILE, "r", encoding="utf-8") as f:
                for line in f:
                    r = json.loads(line)
                    r["source"] = "image_original"
                    all_records.append(r)
        
        # 增强数据
        if AUGMENTED_FILE.exists():
            with open(AUGMENTED_FILE, "r", encoding="utf-8") as f:
                for line in f:
                    all_records.append(json.loads(line))
        
        # 视频标注
        vid_file = DATA_DIR / "video_annotations.jsonl"
        if vid_file.exists():
            with open(vid_file, "r", encoding="utf-8") as f:
                for line in f:
                    r = json.loads(line)
                    if r.get("annotation") and "error" not in r.get("annotation", {}):
                        r["source"] = "video"
                        all_records.append(r)
        
        # 写入训练集
        with open(TRAINING_FILE, "w", encoding="utf-8") as f:
            for r in all_records:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        
        print(f"   总训练数据: {len(all_records)} 条")
        print(f"   输出: {TRAINING_FILE}")


if __name__ == "__main__":
    main()
