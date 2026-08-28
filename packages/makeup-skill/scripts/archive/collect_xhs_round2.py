#!/usr/bin/env python3
"""
第二轮小红书补爬脚本
目标：补充缺失风格 + 细分品类，达到 1000+ 总数据量
改进：加大请求间隔（10秒），避免风控
"""

import json
import subprocess
import os
import sys
import time
import argparse
import hashlib
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).parent.parent
DATA_DIR = PROJECT_ROOT / "data" / "xhs_raw"
METADATA_FILE = PROJECT_ROOT / "data" / "metadata.jsonl"
PROGRESS_FILE = DATA_DIR / ".progress.json"

# 第二轮关键词：补充缺失风格 + 细分品类
KEYWORDS = [
    # 缺失风格
    ("欧美妆", "style_western"),
    ("辣妹妆", "style_spicy"),
    ("复古妆", "style_retro"),
    ("港风妆", "style_hongkong"),
    ("日系妆容", "style_japanese"),
    ("泰式妆容", "style_thai"),
    ("中式妆容", "style_chinese"),
    ("混血妆", "style_mixed"),
    # 细分部位
    ("修容教程", "part_contour"),
    ("高光画法", "part_highlight"),
    ("眼线画法", "part_eyeliner"),
    ("假睫毛教程", "part_lashes"),
    ("美瞳搭配", "part_circle_lens"),
    # 色系
    ("红唇妆", "color_red"),
    ("豆沙色妆容", "color_bean"),
    ("奶茶色妆容", "color_milktea"),
    ("橘色妆容", "color_orange"),
    ("紫色妆容", "color_purple"),
    # 场景
    ("通勤妆容", "scene_work"),
    ("毕业妆", "scene_graduation"),
    ("新年妆", "scene_festival"),
    ("蹦迪妆", "scene_party"),
    # 肤色（重试，加大间隔）
    ("黄皮显白妆", "skin_warm2"),
    ("橄榄皮妆容", "skin_olive2"),
    # 热门话题
    ("有效化妆", "trend_effective"),
    ("无效化妆", "trend_ineffective"),
    ("化妆前后对比", "trend_before_after"),
    ("整容级化妆", "trend_transform"),
    ("新手避雷", "trend_tips"),
    ("化妆步骤详解", "trend_detailed"),
]


def run_opencli(cmd: list[str], timeout: int = 120) -> dict | None:
    """运行 opencli 命令"""
    try:
        if sys.platform == "win32":
            quoted = " ".join(f'"{arg}"' if " " in arg or "&" in arg or "=" in arg else arg for arg in cmd)
            result = subprocess.run(quoted, capture_output=True, text=True, timeout=timeout, shell=True)
        else:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)

        if result.returncode != 0:
            return None

        output = result.stdout.strip()
        lines = [l for l in output.split("\n") if not l.startswith("Update available") and not l.startswith("Run:") and not l.startswith("Extension")]
        clean = "\n".join(lines).strip()
        if not clean:
            return None
        return json.loads(clean)
    except:
        return None


def search_notes(keyword: str, limit: int = 20) -> list[dict]:
    """搜索小红书笔记"""
    result = run_opencli(["opencli", "xiaohongshu", "search", keyword, "--limit", str(limit), "-f", "json"], timeout=180)
    if result and isinstance(result, list):
        return result
    return []


def get_note_detail(url: str) -> dict | None:
    """获取笔记详情"""
    result = run_opencli(["opencli", "xiaohongshu", "note", url, "-f", "json"], timeout=120)
    if not result or not isinstance(result, list):
        return None
    return {item["field"]: item["value"] for item in result if "field" in item and "value" in item}


def download_media(url: str, output_dir: Path) -> list[dict]:
    """下载媒体"""
    result = run_opencli(["opencli", "xiaohongshu", "download", url, "--output", str(output_dir), "-f", "json"], timeout=300)
    if result and isinstance(result, list):
        return result
    return []


def extract_note_id(url: str) -> str:
    parts = url.split("/")
    for part in reversed(parts):
        if len(part) >= 20 and part.replace("?", "").isalnum():
            return part.split("?")[0]
    return hashlib.md5(url.encode()).hexdigest()[:20]


def load_progress() -> dict:
    if PROGRESS_FILE.exists():
        with open(PROGRESS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"completed_keywords": [], "completed_notes": []}


def save_progress(progress: dict):
    with open(PROGRESS_FILE, "w", encoding="utf-8") as f:
        json.dump(progress, f, ensure_ascii=False, indent=2)


def append_metadata(record: dict):
    with open(METADATA_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def main():
    parser = argparse.ArgumentParser(description="小红书补爬（第二轮）")
    parser.add_argument("--keyword", type=str, help="只爬指定关键词")
    parser.add_argument("--limit", type=int, default=20, help="每关键词搜索条数")
    parser.add_argument("--resume", action="store_true", help="断点续传")
    parser.add_argument("--dry-run", action="store_true", help="只搜索不下媒体")
    parser.add_argument("--delay", type=float, default=10.0, help="请求间隔秒数（防风控）")
    args = parser.parse_args()

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    progress = load_progress() if args.resume else {"completed_keywords": [], "completed_notes": []}

    print("=" * 60)
    print("🌸 小红书补爬（第二轮）")
    print(f"   关键词: {len(KEYWORDS)} 个")
    print(f"   每条: {args.limit} 条")
    print(f"   间隔: {args.delay}s")
    print(f"   Dry Run: {args.dry_run}")
    print("=" * 60)

    start = time.time()

    keywords = KEYWORDS if not args.keyword else [(args.keyword, "custom")]

    for i, (kw, cat) in enumerate(keywords):
        if kw in progress["completed_keywords"]:
            print(f"⏭️  跳过: {kw}")
            continue

        print(f"\n📌 [{i+1}/{len(keywords)}] {kw} ({cat})")
        notes = search_notes(kw, args.limit)
        if not notes:
            print(f"  ❌ 搜索失败或为空")
            progress["completed_keywords"].append(kw)
            save_progress(progress)
            time.sleep(args.delay)
            continue

        print(f"  🔍 找到 {len(notes)} 条")
        stats = {"total": len(notes), "text_ok": 0, "media_ok": 0}

        for j, note in enumerate(notes):
            url = note.get("url", "")
            nid = extract_note_id(url)
            title = note.get("title", "?")

            if nid in progress["completed_notes"]:
                continue

            print(f"  📝 [{j+1}/{len(notes)}] {title[:35]}")

            record = {
                "note_id": nid, "url": url, "keyword": kw, "category": cat,
                "title": title, "author": note.get("author", ""),
                "author_url": note.get("author_url", ""),
                "likes": note.get("likes", ""),
                "published_at": note.get("published_at", ""),
                "collected_at": datetime.now().isoformat(),
                "content": "", "tags": "", "media_files": [], "media_types": [],
            }

            # 获取详情
            time.sleep(args.delay)
            detail = get_note_detail(url)
            if detail:
                record["content"] = detail.get("content", "")
                record["tags"] = detail.get("tags", "")
                record["collects"] = detail.get("collects", "")
                record["comment_count"] = detail.get("comments", "")
                stats["text_ok"] += 1
                print(f"    ✅ {record['content'][:50]}...")

            # 下载媒体
            if not args.dry_run:
                time.sleep(args.delay)
                out_dir = DATA_DIR / kw.replace(" ", "_")
                media = download_media(url, out_dir)
                for m in media:
                    if m.get("status") == "success":
                        record["media_files"].append(str(out_dir / nid))
                        record["media_types"].append(m.get("type", ""))
                        stats["media_ok"] += 1

            append_metadata(record)
            progress["completed_notes"].append(nid)
            save_progress(progress)

        progress["completed_keywords"].append(kw)
        save_progress(progress)
        print(f"  📊 完成: {stats['text_ok']}文字 / {stats['media_ok']}媒体")

        # 关键词间隔
        time.sleep(args.delay)

    elapsed = time.time() - start
    print(f"\n{'='*60}")
    print(f"🎉 补爬完成！耗时: {int(elapsed//60)}分{int(elapsed%60)}秒")
    print(f"   关键词: {len(progress['completed_keywords'])}")
    print(f"   笔记: {len(progress['completed_notes'])}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
