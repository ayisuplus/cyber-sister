#!/usr/bin/env python3
"""
OpenCLI 批量搜索 - 只收集搜索结果（标题/作者/点赞/URL），不获取详情
"""

import json
import subprocess
import sys
import time
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).parent.parent
DATA_DIR = PROJECT_ROOT / "data"
OUTPUT_FILE = DATA_DIR / "xhs_search_results.jsonl"

KEYWORDS = [
    "欧美妆", "辣妹妆", "复古妆", "港风妆", "日系妆容", "泰式妆容",
    "中式妆容", "混血妆", "修容教程", "高光画法", "眼线画法",
    "假睫毛教程", "红唇妆", "豆沙色妆容", "奶茶色妆容", "橘色妆容",
    "紫色妆容", "通勤妆容", "毕业妆", "蹦迪妆", "黄皮显白妆",
    "橄榄皮妆容", "有效化妆", "整容级化妆", "化妆步骤详解",
    "眼妆教程", "底妆教学", "唇妆画法", "眉毛画法", "腮红画法",
    "日常妆容", "新手化妆", "美妆教程", "妆教", "白开水妆",
    "蜜桃妆", "伪素颜妆", "素颜妆", "奶fufu妆", "约会妆",
    "面试妆", "上学妆", "黄皮妆容", "白皮妆容",
]


def search_keyword(keyword: str, limit: int = 20) -> list[dict]:
    """用 OpenCLI 搜索小红书"""
    try:
        if sys.platform == "win32":
            cmd = f'opencli xiaohongshu search "{keyword}" --limit {limit} -f json'
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=60, shell=True)
        else:
            result = subprocess.run(
                ["opencli", "xiaohongshu", "search", keyword, "--limit", str(limit), "-f", "json"],
                capture_output=True, text=True, timeout=60,
            )

        if result.returncode != 0:
            return []

        output = result.stdout.strip()
        lines = [l for l in output.split("\n") if not l.startswith("Update") and not l.startswith("Run:") and not l.startswith("Extension")]
        clean = "\n".join(lines).strip()
        if not clean:
            return []
        data = json.loads(clean)
        return data if isinstance(data, list) else []
    except:
        return []


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    # 加载已有结果
    existing_ids = set()
    if OUTPUT_FILE.exists():
        with open(OUTPUT_FILE, "r", encoding="utf-8") as f:
            for line in f:
                try:
                    r = json.loads(line)
                    existing_ids.add(r.get("url", ""))
                except:
                    pass

    print(f"🌸 OpenCLI 批量搜索")
    print(f"   关键词: {len(KEYWORDS)} 个")
    print(f"   已有: {len(existing_ids)} 条")
    print("=" * 50)

    total_new = 0
    start = time.time()

    for i, kw in enumerate(KEYWORDS):
        print(f"\n📌 [{i+1}/{len(KEYWORDS)}] {kw}", end=" ")

        results = search_keyword(kw, 20)
        if not results:
            print("❌ 失败")
            time.sleep(5)
            continue

        new_count = 0
        for r in results:
            url = r.get("url", "")
            if url in existing_ids:
                continue

            record = {
                "keyword": kw,
                "title": r.get("title", ""),
                "author": r.get("author", ""),
                "author_url": r.get("author_url", ""),
                "likes": r.get("likes", ""),
                "url": url,
                "published_at": r.get("published_at", ""),
                "collected_at": datetime.now().isoformat(),
            }

            with open(OUTPUT_FILE, "a", encoding="utf-8") as f:
                f.write(json.dumps(record, ensure_ascii=False) + "\n")

            existing_ids.add(url)
            new_count += 1
            total_new += 1

        print(f"✅ {len(results)}条 (新增{new_count})")
        time.sleep(5)

    elapsed = time.time() - start
    print(f"\n{'='*50}")
    print(f"🎉 搜索完成！新增 {total_new} 条，耗时 {int(elapsed//60)}分{int(elapsed%60)}秒")
    print(f"   总计: {len(existing_ids)} 条")
    print(f"   输出: {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
