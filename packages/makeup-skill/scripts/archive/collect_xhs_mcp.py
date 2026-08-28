#!/usr/bin/env python3
"""
小红书数据收集（第三轮）- 通过 xiaohongshu-mcp 收集
使用 MCP 工具搜索 + 获取笔记详情，绕过 OpenCLI 的风控
"""

import json
import subprocess
import sys
import time
import os
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).parent.parent
DATA_DIR = PROJECT_ROOT / "data" / "xhs_raw"
METADATA_FILE = PROJECT_ROOT / "data" / "metadata.jsonl"
PROGRESS_FILE = DATA_DIR / ".progress.json"
BRIDGE_PATH = Path(__file__).parent.parent.parent / "xiaohongshu-mcp2" / "stdio_bridge.py"

KEYWORDS = [
    "欧美妆", "辣妹妆", "复古妆", "港风妆", "日系妆容", "泰式妆容",
    "中式妆容", "混血妆", "修容教程", "高光画法", "眼线画法",
    "假睫毛教程", "红唇妆", "豆沙色妆容", "奶茶色妆容", "橘色妆容",
    "紫色妆容", "通勤妆容", "毕业妆", "蹦迪妆", "黄皮显白妆",
    "橄榄皮妆容", "有效化妆", "整容级化妆", "化妆步骤详解",
    "眼妆教程", "底妆教学", "唇妆画法", "眉毛画法", "腮红画法",
]


def call_mcp(tool_name: str, arguments: dict, timeout: int = 30) -> dict | None:
    """通过 stdio bridge 调用 MCP 工具"""
    req = json.dumps({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": tool_name, "arguments": arguments}
    })
    
    try:
        result = subprocess.run(
            [sys.executable, str(BRIDGE_PATH)],
            input=req + "\n",
            capture_output=True,
            text=True,
            timeout=timeout,
            encoding="utf-8",
            errors="replace",
        )
        if result.returncode != 0:
            return None
        
        for line in result.stdout.strip().split("\n"):
            if line.strip():
                try:
                    data = json.loads(line)
                    content = data.get("result", {}).get("content", [])
                    for c in content:
                        if c.get("type") == "text":
                            return json.loads(c["text"])
                    return data
                except json.JSONDecodeError:
                    continue
        return None
    except subprocess.TimeoutExpired:
        return None
    except Exception as e:
        return None


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
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    progress = load_progress()

    print("=" * 60)
    print("🌸 小红书数据收集（MCP 版）")
    print(f"   关键词: {len(KEYWORDS)} 个")
    print(f"   已完成: {len(progress['completed_keywords'])} 关键词, {len(progress['completed_notes'])} 笔记")
    print("=" * 60)

    total_new = 0
    start = time.time()

    for i, kw in enumerate(KEYWORDS):
        if kw in progress["completed_keywords"]:
            print(f"⏭️  跳过: {kw}")
            continue

        print(f"\n📌 [{i+1}/{len(KEYWORDS)}] {kw}")
        
        # 搜索
        result = call_mcp("search_feeds", {"keyword": kw}, timeout=60)
        if not result or "feeds" not in result:
            print(f"  ❌ 搜索失败")
            progress["completed_keywords"].append(kw)
            save_progress(progress)
            time.sleep(5)
            continue

        feeds = result["feeds"]
        print(f"  🔍 找到 {len(feeds)} 条")

        for j, feed in enumerate(feeds):
            feed_id = feed.get("id", "")
            xsec_token = feed.get("xsecToken", "")
            card = feed.get("noteCard", {})
            title = card.get("displayTitle", "?")
            nickname = card.get("user", {}).get("nickname", "?")
            likes = card.get("interactInfo", {}).get("likedCount", "0")
            note_type = card.get("type", "unknown")

            if feed_id in progress["completed_notes"]:
                continue

            print(f"  📝 [{j+1}/{len(feeds)}] {title[:35]} | {nickname} | ❤️{likes}")

            # 获取详情
            time.sleep(3)
            detail = call_mcp("get_feed_detail", {
                "feed_id": feed_id,
                "xsec_token": xsec_token,
            }, timeout=60)

            record = {
                "note_id": feed_id,
                "keyword": kw,
                "title": title,
                "author": nickname,
                "likes": likes,
                "type": note_type,
                "collected_at": datetime.now().isoformat(),
                "content": "",
                "tags": "",
                "images": [],
                "comments_count": card.get("interactInfo", {}).get("commentCount", "0"),
                "collects_count": card.get("interactInfo", {}).get("collectedCount", "0"),
            }

            if detail:
                record["content"] = detail.get("content", detail.get("desc", ""))
                record["tags"] = ", ".join(detail.get("tagList", []))
                record["images"] = [img.get("urlDefault", "") for img in detail.get("imageList", [])]
                print(f"    ✅ {record['content'][:60]}...")
            else:
                print(f"    ⚠️  详情获取失败")

            append_metadata(record)
            progress["completed_notes"].append(feed_id)
            save_progress(progress)
            total_new += 1

        progress["completed_keywords"].append(kw)
        save_progress(progress)
        time.sleep(5)

    elapsed = time.time() - start
    print(f"\n{'='*60}")
    print(f"🎉 收集完成！新增 {total_new} 条，耗时 {int(elapsed//60)}分{int(elapsed%60)}秒")
    print(f"   总计: {len(progress['completed_notes'])} 条笔记")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
