#!/usr/bin/env python3
"""
B站美妆视频数据收集器
无需登录，直接调 API，反爬极弱
"""

import json
import httpx
import re
import time
import os
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).parent.parent
DATA_DIR = PROJECT_ROOT / "data" / "bilibili"
METADATA_FILE = DATA_DIR / "metadata.jsonl"
IMAGES_DIR = DATA_DIR / "covers"

KEYWORDS = [
    "化妆教程", "新手化妆", "日常妆容", "美妆教程", "妆教",
    "白开水妆", "蜜桃妆", "伪素颜妆", "素颜妆",
    "底妆教学", "眼妆教程", "唇妆画法", "眉毛画法", "腮红画法",
    "修容教程", "高光画法", "眼线画法",
    "欧美妆", "辣妹妆", "复古妆", "港风妆", "日系妆", "韩系妆",
    "约会妆", "通勤妆", "面试妆",
    "黄皮妆容", "圆脸妆容", "方脸妆容",
    "淡妆教程", "浓妆教程", "新娘妆",
]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://search.bilibili.com/",
}

MAX_PAGES = 5  # 每个关键词最多5页（100条）


def search_videos(keyword: str, page: int = 1) -> list[dict]:
    """搜索B站视频"""
    url = "https://api.bilibili.com/x/web-interface/search/type"
    params = {
        "keyword": keyword,
        "search_type": "video",
        "page": page,
        "page_size": 20,
        "order": "totalrank",  # 综合排序
    }
    try:
        resp = httpx.get(url, params=params, headers=HEADERS, timeout=15, follow_redirects=True)
        data = resp.json()
        if data.get("code") == 0:
            return data.get("data", {}).get("result", [])
    except:
        pass
    return []


def get_video_detail(bvid: str) -> dict | None:
    """获取视频详情"""
    url = f"https://api.bilibili.com/x/web-interface/view?bvid={bvid}"
    try:
        resp = httpx.get(url, headers=HEADERS, timeout=10)
        data = resp.json()
        if data.get("code") == 0:
            return data.get("data", {})
    except:
        pass
    return None


def download_cover(url: str, save_path: str) -> bool:
    """下载封面图"""
    try:
        if not url or url.startswith("//"):
            url = "https:" + url
        resp = httpx.get(url, headers=HEADERS, timeout=10, follow_redirects=True)
        if resp.status_code == 200 and len(resp.content) > 1000:
            os.makedirs(os.path.dirname(save_path), exist_ok=True)
            with open(save_path, "wb") as f:
                f.write(resp.content)
            return True
    except:
        pass
    return False


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)

    # 加载已完成的
    done_ids = set()
    if METADATA_FILE.exists():
        with open(METADATA_FILE, "r", encoding="utf-8") as f:
            for line in f:
                try:
                    done_ids.add(json.loads(line).get("bvid", ""))
                except:
                    pass

    print("=" * 60)
    print("📺 B站美妆视频数据收集器")
    print(f"   关键词: {len(KEYWORDS)} 个")
    print(f"   已有: {len(done_ids)} 条")
    print("=" * 60)

    total_new = 0
    start = time.time()

    for i, kw in enumerate(KEYWORDS):
        print(f"\n📌 [{i+1}/{len(KEYWORDS)}] {kw}")
        kw_count = 0

        for page in range(1, MAX_PAGES + 1):
            videos = search_videos(kw, page)
            if not videos:
                break

            for v in videos:
                bvid = v.get("bvid", "")
                if not bvid or bvid in done_ids:
                    continue

                title = re.sub(r"<[^>]+>", "", v.get("title", ""))
                author = v.get("author", "")
                like = v.get("like", 0)
                play = v.get("play", 0)
                duration = v.get("duration", "")
                pubdate = v.get("pubdate", 0)
                description = v.get("description", "")
                pic = v.get("pic", "")  # 封面图URL
                tag = v.get("tag", "")  # 标签
                favorites = v.get("favorites", 0)
                review = v.get("review", 0)  # 评论数
                danmaku = v.get("danmaku", 0)

                # 下载封面图
                cover_path = ""
                if pic:
                    cover_path = str(IMAGES_DIR / f"{bvid}.jpg")
                    download_cover(pic, cover_path)

                record = {
                    "bvid": bvid,
                    "keyword": kw,
                    "title": title,
                    "author": author,
                    "likes": like,
                    "play": play,
                    "duration": duration,
                    "pubdate": datetime.fromtimestamp(pubdate).isoformat() if pubdate else "",
                    "description": description[:500],
                    "tags": tag,
                    "favorites": favorites,
                    "comments": review,
                    "danmaku": danmaku,
                    "cover_url": pic,
                    "cover_path": cover_path,
                    "collected_at": datetime.now().isoformat(),
                    "source": "bilibili",
                }

                with open(METADATA_FILE, "a", encoding="utf-8") as f:
                    f.write(json.dumps(record, ensure_ascii=False) + "\n")

                done_ids.add(bvid)
                kw_count += 1
                total_new += 1

            time.sleep(1)  # API 限流

        print(f"  ✅ 新增 {kw_count} 条")

    elapsed = time.time() - start
    print(f"\n{'='*60}")
    print(f"🎉 收集完成！新增 {total_new} 条，耗时 {int(elapsed//60)}分{int(elapsed%60)}秒")
    print(f"   总计: {len(done_ids)} 条")
    print(f"   输出: {METADATA_FILE}")
    print(f"   封面: {IMAGES_DIR}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
