#!/usr/bin/env python3
"""
小红书妆教数据收集脚本
使用 OpenCLI xiaohongshu adapter 通过 Edge 浏览器爬取

工作流：
1. 搜索关键词 → 获取笔记列表
2. 获取每条笔记的文字内容 + 元数据
3. 下载图片/视频

用法：
    python scripts/collect_xhs.py                    # 收集所有关键词
    python scripts/collect_xhs.py --keyword "化妆教程" # 只收集一个关键词
    python scripts/collect_xhs.py --resume            # 从上次中断处继续
    python scripts/collect_xhs.py --dry-run           # 只搜索不下载
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

# ============================================================
# 配置
# ============================================================

PROJECT_ROOT = Path(__file__).parent.parent
DATA_DIR = PROJECT_ROOT / "data" / "xhs_raw"
METADATA_FILE = DATA_DIR / "metadata.jsonl"  # 每行一条 JSON
PROGRESS_FILE = DATA_DIR / ".progress.json"

# 搜索关键词 → (关键词, 类别标签)
KEYWORDS = [
    # 通用化妆教程
    ("化妆教程", "general"),
    ("日常妆容", "general"),
    ("新手化妆", "general"),
    ("美妆教程", "general"),
    ("妆教", "general"),
    # 对应三套妆容
    ("白开水妆", "style_clear"),
    ("蜜桃妆", "style_peach"),
    ("伪素颜妆", "style_natural"),
    ("素颜妆", "style_natural"),
    ("奶fufu妆", "style_peach"),
    # 按部位
    ("底妆教学", "part_base"),
    ("眼妆教程", "part_eye"),
    ("唇妆画法", "part_lip"),
    ("眉毛画法", "part_brow"),
    ("腮红画法", "part_cheek"),
    # 肤色相关
    ("黄皮妆容", "skin_warm"),
    ("白皮妆容", "skin_cool"),
    ("橄榄皮妆容", "skin_olive"),
    # 场景
    ("约会妆", "scene_date"),
    ("面试妆", "scene_interview"),
    ("上学妆", "scene_school"),
]

# 每个关键词搜索多少条（OpenCLI 每页20条，滚动加载更多）
LIMIT_PER_KEYWORD = 50

# 下载控制
DOWNLOAD_VIDEOS = True     # 是否下载视频（视频很大）
DOWNLOAD_IMAGES = True     # 是否下载图片
MAX_VIDEO_SIZE_MB = 100    # 超过此大小跳过视频

# 请求间隔（秒），避免被限流
DELAY_BETWEEN_SEARCHES = 3
DELAY_BETWEEN_NOTES = 2
DELAY_BETWEEN_DOWNLOADS = 2


def run_opencli(cmd: list[str], timeout: int = 120) -> dict | None:
    """运行 opencli 命令并返回 JSON 结果"""
    try:
        # Windows shell=True 时，URL 里的 & 会被解释为命令分隔符
        # 所以需要对整个命令做引号处理
        if sys.platform == "win32":
            # 用 cmd /c 包裹，并给每个参数加引号
            quoted = " ".join(f'"{arg}"' if " " in arg or "&" in arg or "=" in arg else arg for arg in cmd)
            result = subprocess.run(
                quoted,
                capture_output=True,
                text=True,
                timeout=timeout,
                encoding="utf-8",
                errors="replace",
                shell=True,
            )
        else:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=timeout,
                encoding="utf-8",
                errors="replace",
            )
        if result.returncode != 0:
            print(f"  ⚠️  命令失败: {' '.join(cmd[:4])}...")
            print(f"     stderr: {result.stderr[:200]}")
            return None

        output = result.stdout.strip()
        # 去掉 opencli 的更新提示
        lines = output.split("\n")
        json_lines = []
        for line in lines:
            if line.startswith("Update available") or line.startswith("Run:") or line.startswith("Extension update"):
                continue
            json_lines.append(line)
        clean_output = "\n".join(json_lines).strip()

        if not clean_output:
            return None

        return json.loads(clean_output)
    except subprocess.TimeoutExpired:
        print(f"  ⏰ 超时: {' '.join(cmd[:4])}...")
        return None
    except json.JSONDecodeError as e:
        print(f"  ❌ JSON解析失败: {e}")
        return None
    except Exception as e:
        print(f"  ❌ 异常: {e}")
        return None


def search_notes(keyword: str, limit: int = LIMIT_PER_KEYWORD) -> list[dict]:
    """搜索小红书笔记"""
    print(f"\n🔍 搜索: {keyword} (limit={limit})")
    result = run_opencli([
        "opencli", "xiaohongshu", "search", keyword,
        "--limit", str(limit),
        "-f", "json",
    ], timeout=180)

    if not result:
        print(f"  ❌ 搜索失败")
        return []

    if isinstance(result, list):
        print(f"  ✅ 找到 {len(result)} 条笔记")
        return result
    else:
        print(f"  ⚠️  意外返回格式: {type(result)}")
        return []


def get_note_detail(url: str) -> dict | None:
    """获取笔记详情"""
    result = run_opencli([
        "opencli", "xiaohongshu", "note", url,
        "-f", "json",
    ], timeout=120)

    if not result or not isinstance(result, list):
        return None

    # field/value 对 → dict
    detail = {}
    for item in result:
        if "field" in item and "value" in item:
            detail[item["field"]] = item["value"]
    return detail


def download_media(url: str, output_dir: Path) -> list[dict]:
    """下载笔记的图片和视频"""
    result = run_opencli([
        "opencli", "xiaohongshu", "download", url,
        "--output", str(output_dir),
        "-f", "json",
    ], timeout=300)

    if not result or not isinstance(result, list):
        return []

    return result


def extract_note_id(url: str) -> str:
    """从 URL 提取笔记 ID"""
    # https://www.xiaohongshu.com/search_result/69a2ab68000000001d025992?...
    # 或 https://www.xiaohongshu.com/explore/69a2ab68000000001d025992?...
    parts = url.split("/")
    for part in reversed(parts):
        if len(part) >= 20 and part.replace("?", "").isalnum():
            return part.split("?")[0]
    # fallback: 用 hash
    return hashlib.md5(url.encode()).hexdigest()[:20]


def load_progress() -> dict:
    """加载进度"""
    if PROGRESS_FILE.exists():
        with open(PROGRESS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"completed_keywords": [], "completed_notes": []}


def save_progress(progress: dict):
    """保存进度"""
    with open(PROGRESS_FILE, "w", encoding="utf-8") as f:
        json.dump(progress, f, ensure_ascii=False, indent=2)


def append_metadata(record: dict):
    """追加一条元数据到 JSONL"""
    with open(METADATA_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def collect_keyword(keyword: str, category: str, progress: dict, dry_run: bool = False, search_limit: int = LIMIT_PER_KEYWORD):
    """收集一个关键词的所有数据"""
    if keyword in progress["completed_keywords"]:
        print(f"⏭️  跳过已完成的关键词: {keyword}")
        return

    # Step 1: 搜索
    notes = search_notes(keyword, search_limit)
    if not notes:
        print(f"  ⚠️  搜索结果为空，跳过")
        progress["completed_keywords"].append(keyword)
        save_progress(progress)
        return

    stats = {"keyword": keyword, "total": len(notes), "text_ok": 0, "media_ok": 0, "errors": 0}

    for i, note in enumerate(notes):
        url = note.get("url", "")
        note_id = extract_note_id(url)
        title = note.get("title", "未知")

        if note_id in progress["completed_notes"]:
            print(f"  ⏭️  [{i+1}/{len(notes)}] 跳过已完成: {title[:30]}")
            continue

        print(f"\n  📝 [{i+1}/{len(notes)}] {title[:40]}")
        print(f"     作者: {note.get('author', '?')} | 点赞: {note.get('likes', '?')} | 发布: {note.get('published_at', '?')}")

        record = {
            "note_id": note_id,
            "url": url,
            "keyword": keyword,
            "category": category,
            "title": title,
            "author": note.get("author", ""),
            "author_url": note.get("author_url", ""),
            "likes": note.get("likes", ""),
            "published_at": note.get("published_at", ""),
            "collected_at": datetime.now().isoformat(),
            "content": "",
            "tags": "",
            "media_files": [],
            "media_types": [],
        }

        # Step 2: 获取详情
        time.sleep(DELAY_BETWEEN_NOTES)
        detail = get_note_detail(url)
        if detail:
            record["content"] = detail.get("content", "")
            record["tags"] = detail.get("tags", "")
            record["collects"] = detail.get("collects", "")
            record["comment_count"] = detail.get("comments", "")
            stats["text_ok"] += 1
            print(f"     ✅ 文字获取成功 | 收藏: {detail.get('collects', '?')} | 评论: {detail.get('comments', '?')}")
            if record["content"]:
                print(f"     📄 内容: {record['content'][:80]}...")
        else:
            stats["errors"] += 1
            print(f"     ⚠️  详情获取失败")

        # Step 3: 下载媒体
        if not dry_run and (DOWNLOAD_VIDEOS or DOWNLOAD_IMAGES):
            time.sleep(DELAY_BETWEEN_DOWNLOADS)
            output_dir = DATA_DIR / keyword.replace(" ", "_")
            media_results = download_media(url, output_dir)

            for m in media_results:
                if m.get("status") == "success":
                    media_type = m.get("type", "unknown")
                    # 文件已下载到 output_dir/note_id/ 下
                    media_path = output_dir / note_id
                    record["media_files"].append(str(media_path))
                    record["media_types"].append(media_type)
                    stats["media_ok"] += 1

            if media_results:
                media_summary = ", ".join([f"{m.get('type','?')}({m.get('size','?')})" for m in media_results if m.get("status") == "success"])
                print(f"     📦 下载: {media_summary}")
            else:
                print(f"     📦 无可下载媒体")

        # 保存元数据
        append_metadata(record)
        progress["completed_notes"].append(note_id)
        save_progress(progress)

    # 关键词完成
    progress["completed_keywords"].append(keyword)
    save_progress(progress)
    print(f"\n📊 关键词 [{keyword}] 完成: {stats['total']}条 | 文字{stats['text_ok']} | 媒体{stats['media_ok']} | 错误{stats['errors']}")


def main():
    parser = argparse.ArgumentParser(description="小红书妆教数据收集")
    parser.add_argument("--keyword", type=str, help="只收集指定关键词")
    parser.add_argument("--resume", action="store_true", help="从上次中断处继续")
    parser.add_argument("--dry-run", action="store_true", help="只搜索不下载媒体")
    parser.add_argument("--limit", type=int, default=LIMIT_PER_KEYWORD, help=f"每个关键词搜索条数 (默认{LIMIT_PER_KEYWORD})")
    args = parser.parse_args()
    search_limit = args.limit

    # 确保目录存在
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    # 加载进度
    progress = load_progress() if args.resume else {"completed_keywords": [], "completed_notes": []}

    print("=" * 60)
    print("🌸 小红书妆教数据收集器")
    print(f"   数据目录: {DATA_DIR}")
    print(f"   关键词数: {len(KEYWORDS)}")
    print(f"   每词条数: {search_limit}")
    print(f"   下载视频: {'是' if DOWNLOAD_VIDEOS else '否'}")
    print(f"   下载图片: {'是' if DOWNLOAD_IMAGES else '否'}")
    print(f"   Dry Run:  {'是' if args.dry_run else '否'}")
    print(f"   恢复模式: {'是' if args.resume else '否'}")
    print(f"   已完成:   {len(progress['completed_keywords'])}个关键词, {len(progress['completed_notes'])}条笔记")
    print("=" * 60)

    start_time = time.time()

    if args.keyword:
        # 只收集指定关键词
        cat = "custom"
        for kw, c in KEYWORDS:
            if kw == args.keyword:
                cat = c
                break
        collect_keyword(args.keyword, cat, progress, args.dry_run, search_limit)
    else:
        # 收集所有关键词
        for i, (keyword, category) in enumerate(KEYWORDS):
            print(f"\n{'='*60}")
            print(f"📌 [{i+1}/{len(KEYWORDS)}] 关键词: {keyword} (类别: {category})")
            print(f"{'='*60}")
            collect_keyword(keyword, category, progress, args.dry_run, search_limit)

            # 关键词之间等久一点
            if i < len(KEYWORDS) - 1:
                print(f"\n⏳ 等待 {DELAY_BETWEEN_SEARCHES}s 后搜索下一个关键词...")
                time.sleep(DELAY_BETWEEN_SEARCHES)

    elapsed = time.time() - start_time
    minutes = int(elapsed // 60)
    seconds = int(elapsed % 60)

    # 统计
    total_notes = len(progress["completed_notes"])
    print(f"\n{'='*60}")
    print(f"🎉 收集完成！")
    print(f"   耗时: {minutes}分{seconds}秒")
    print(f"   关键词: {len(progress['completed_keywords'])}/{len(KEYWORDS)}")
    print(f"   笔记数: {total_notes}")
    print(f"   数据目录: {DATA_DIR}")
    print(f"   元数据文件: {METADATA_FILE}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
