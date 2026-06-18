#!/usr/bin/env python3
"""
小红书数据收集 - 长连接 MCP 模式
一个 bridge 进程复用同一个浏览器会话，不会反复开新窗口
"""

import json
import subprocess
import sys
import time
import os
import threading
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


class MCPClient:
    """长连接 MCP 客户端，复用同一个 bridge 进程"""
    
    def __init__(self):
        self.proc = subprocess.Popen(
            [sys.executable, str(BRIDGE_PATH)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        # 读取初始化响应
        init_line = self.proc.stdout.readline()
        # 发送 initialized 通知
        self._send_raw({"jsonrpc": "2.0", "method": "notifications/initialized"})
        print("✅ MCP 长连接已建立")
    
    def _send_raw(self, msg: dict):
        self.proc.stdin.write(json.dumps(msg) + "\n")
        self.proc.stdin.flush()
    
    def call(self, tool_name: str, arguments: dict, timeout: int = 60) -> dict | None:
        """调用 MCP 工具"""
        req = {
            "jsonrpc": "2.0",
            "id": int(time.time() * 1000) % 100000,
            "method": "tools/call",
            "params": {"name": tool_name, "arguments": arguments}
        }
        self._send_raw(req)
        
        # 用线程实现超时读取
        result_holder = [None]
        def read_line():
            try:
                result_holder[0] = self.proc.stdout.readline()
            except:
                pass
        
        t = threading.Thread(target=read_line, daemon=True)
        t.start()
        t.join(timeout=timeout)
        
        if t.is_alive():
            return None
        
        line = result_holder[0]
        if not line:
            return None
        
        try:
            data = json.loads(line)
            content = data.get("result", {}).get("content", [])
            for c in content:
                if c.get("type") == "text":
                    return json.loads(c["text"])
            return data
        except:
            return None
    
    def close(self):
        if self.proc:
            self.proc.terminate()


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
    print("🌸 小红书数据收集（MCP 长连接版）")
    print(f"   关键词: {len(KEYWORDS)} 个")
    print(f"   已完成: {len(progress['completed_keywords'])} 关键词, {len(progress['completed_notes'])} 笔记")
    print("=" * 60)

    # 建立长连接
    client = MCPClient()

    total_new = 0
    start = time.time()

    try:
        for i, kw in enumerate(KEYWORDS):
            if kw in progress["completed_keywords"]:
                print(f"⏭️  跳过: {kw}")
                continue

            print(f"\n📌 [{i+1}/{len(KEYWORDS)}] {kw}")
            
            result = client.call("search_feeds", {"keyword": kw}, timeout=60)
            if not result or "feeds" not in result:
                print(f"  ❌ 搜索失败")
                progress["completed_keywords"].append(kw)
                save_progress(progress)
                time.sleep(3)
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

                print(f"  📝 [{j+1}/{len(feeds)}] {title[:35]} | ❤️{likes}")

                time.sleep(2)
                detail = client.call("get_feed_detail", {
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
                    print(f"    ✅ {record['content'][:50]}...")
                else:
                    print(f"    ⚠️  详情获取失败")

                append_metadata(record)
                progress["completed_notes"].append(feed_id)
                save_progress(progress)
                total_new += 1

            progress["completed_keywords"].append(kw)
            save_progress(progress)
            time.sleep(3)

    finally:
        client.close()

    elapsed = time.time() - start
    print(f"\n{'='*60}")
    print(f"🎉 收集完成！新增 {total_new} 条，耗时 {int(elapsed//60)}分{int(elapsed%60)}秒")
    print(f"   总计: {len(progress['completed_notes'])} 条笔记")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
