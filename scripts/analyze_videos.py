#!/usr/bin/env python3
"""
视频分析管线：ffmpeg抽帧 → MiniMax Vision分析 → 结构化标注
"""

import json
import os
import sys
import time
import re
import shutil
import subprocess
import base64
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).parent.parent
DATA_DIR = PROJECT_ROOT / "data" / "xhs_raw"
FRAMES_DIR = PROJECT_ROOT / "data" / "_video_frames"
OUTPUT_FILE = PROJECT_ROOT / "data" / "video_annotations.jsonl"
PROGRESS_FILE = PROJECT_ROOT / "data" / ".video_progress.json"

FRAME_PROMPT = """分析这张化妆教程视频截图，用JSON返回：
{
  "current_step": "当前化妆步骤（如：底妆/眼影/腮红/唇妆/定妆/完成）",
  "lip_color": "唇色描述",
  "eyeshadow": "眼影描述",
  "blush": "腮红描述",
  "skin_finish": "底妆质感",
  "techniques": ["可见技法"],
  "tools_visible": ["可见工具/产品"]
}
只返回JSON。"""

MERGE_PROMPT = """根据以下化妆教程视频的多帧分析结果，总结完整妆容信息，用JSON返回：
{
  "style": "妆容风格",
  "steps_summary": ["步骤1: ...", "步骤2: ...", ...],
  "lip_color": "最终唇色",
  "eyeshadow": "眼影描述",
  "blush": "腮红描述",
  "skin_finish": "底妆质感",
  "all_techniques": ["所有使用技法"],
  "difficulty": "easy/medium/hard",
  "key_tips": "关键技巧",
  "product_clues": ["可识别的产品/工具"]
}
只返回JSON。"""


def get_api_key() -> str:
    """获取 MiniMax API key"""
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


def extract_frames(video_path: str, output_dir: str, num_frames: int = 4) -> list[str]:
    """从视频中提取均匀分布的关键帧"""
    os.makedirs(output_dir, exist_ok=True)

    # 获取视频时长
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", video_path],
        capture_output=True, text=True, timeout=10
    )
    try:
        duration = float(probe.stdout.strip())
    except:
        duration = 10.0

    # 均匀抽帧
    interval = max(duration / (num_frames + 1), 1.0)
    frames = []
    for i in range(num_frames):
        ts = interval * (i + 1)
        frame_path = os.path.join(output_dir, f"frame_{i:02d}.jpg")
        subprocess.run(
            ["ffmpeg", "-ss", str(ts), "-i", video_path,
             "-vframes", "1", "-q:v", "3", "-vf", "scale=640:-1",
             frame_path, "-y"],
            capture_output=True, timeout=15
        )
        if os.path.exists(frame_path):
            frames.append(frame_path)

    return frames


def analyze_frame(frame_path: str, api_key: str) -> dict | None:
    """用 MiniMax Vision 分析单帧"""
    try:
        import httpx

        with open(frame_path, "rb") as f:
            img_data = base64.b64encode(f.read()).decode()

        url = "https://api.minimaxi.com/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": "MiniMax-M3",
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{img_data}"}},
                    {"type": "text", "text": FRAME_PROMPT},
                ],
            }],
            "max_tokens": 800,
        }

        resp = httpx.post(url, json=payload, headers=headers, timeout=60)
        resp.raise_for_status()
        data = resp.json()
        content = data["choices"][0]["message"]["content"]

        json_match = re.search(r'```(?:json)?\s*\n?(.*?)\n?\s*```', content, re.DOTALL)
        if json_match:
            return json.loads(json_match.group(1))
        return json.loads(content.strip())
    except Exception as e:
        return {"error": str(e)}


def merge_frame_analyses(frame_analyses: list[dict], api_key: str) -> dict | None:
    """合并多帧分析为完整视频标注"""
    try:
        import httpx

        frames_text = json.dumps(frame_analyses, ensure_ascii=False, indent=2)

        url = "https://api.minimaxi.com/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": "MiniMax-M3",
            "messages": [{
                "role": "user",
                "content": f"以下是化妆教程视频的多帧分析结果：\n\n{frames_text}\n\n{MERGE_PROMPT}",
            }],
            "max_tokens": 1000,
        }

        resp = httpx.post(url, json=payload, headers=headers, timeout=60)
        resp.raise_for_status()
        data = resp.json()
        content = data["choices"][0]["message"]["content"]

        json_match = re.search(r'```(?:json)?\s*\n?(.*?)\n?\s*```', content, re.DOTALL)
        if json_match:
            return json.loads(json_match.group(1))
        return json.loads(content.strip())
    except Exception as e:
        return {"error": str(e)}


def analyze_video(video_path: str, api_key: str) -> dict | None:
    """分析单个视频"""
    # 创建临时帧目录
    note_id = Path(video_path).parent.name
    tmp_frames = FRAMES_DIR / note_id
    tmp_frames.mkdir(parents=True, exist_ok=True)

    try:
        # 1. 抽帧
        frames = extract_frames(video_path, str(tmp_frames), num_frames=4)
        if not frames:
            return None

        # 2. 逐帧分析
        frame_results = []
        for frame_path in frames:
            result = analyze_frame(frame_path, api_key)
            if result and "error" not in result:
                frame_results.append(result)
            time.sleep(0.5)  # API 限流

        if not frame_results:
            return None

        # 3. 合并
        merged = merge_frame_analyses(frame_results, api_key)
        return merged

    finally:
        # 清理临时帧
        shutil.rmtree(tmp_frames, ignore_errors=True)


def collect_videos() -> list[dict]:
    """收集所有视频文件"""
    videos = []
    for keyword_dir in DATA_DIR.iterdir():
        if not keyword_dir.is_dir() or keyword_dir.name.startswith("."):
            continue
        for note_dir in keyword_dir.iterdir():
            if not note_dir.is_dir():
                continue
            for vid_file in note_dir.glob("*.mp4"):
                videos.append({
                    "path": str(vid_file),
                    "keyword": keyword_dir.name,
                    "note_id": note_dir.name,
                })
    return videos


def load_progress() -> set:
    done = set()
    if PROGRESS_FILE.exists():
        with open(PROGRESS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            done = set(data.get("done", []))
    return done


def save_progress(done: set):
    with open(PROGRESS_FILE, "w", encoding="utf-8") as f:
        json.dump({"done": list(done)}, f)


def main():
    import argparse
    parser = argparse.ArgumentParser(description="视频妆容分析")
    parser.add_argument("--limit", type=int, default=0, help="最多分析几个（0=全部）")
    parser.add_argument("--test", action="store_true", help="只分析前2个测试")
    args = parser.parse_args()

    api_key = get_api_key()
    if not api_key:
        print("❌ 找不到 MINIMAX_API_KEY")
        return

    videos = collect_videos()
    print(f"🎬 找到 {len(videos)} 个视频")

    if args.test:
        videos = videos[:2]
    elif args.limit > 0:
        videos = videos[:args.limit]

    done = load_progress()
    videos = [v for v in videos if v["path"] not in done]
    print(f"   待分析: {len(videos)} 个 (已完成: {len(done)})")

    success = 0
    failed = 0

    for i, vid in enumerate(videos):
        print(f"\n🎬 [{i+1}/{len(videos)}] {vid['keyword']}/{vid['note_id'][:12]}...")

        result = analyze_video(vid["path"], api_key)

        record = {
            "video_path": vid["path"],
            "keyword": vid["keyword"],
            "note_id": vid["note_id"],
            "annotation": result,
            "analyzed_at": datetime.now().isoformat(),
        }

        with open(OUTPUT_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")

        done.add(vid["path"])
        save_progress(done)

        if result and "error" not in result:
            success += 1
            style = result.get("style", "?")
            steps = len(result.get("steps_summary", []))
            print(f"  ✅ {style} | {steps}步")
        else:
            failed += 1
            print(f"  ❌ {result}")

        # API 限流
        if i < len(videos) - 1:
            time.sleep(2)

        # 进度报告
        if (i + 1) % 10 == 0:
            print(f"\n📊 进度: {i+1}/{len(videos)} | 成功: {success} | 失败: {failed}")

    print(f"\n{'='*50}")
    print(f"🎉 视频分析完成！成功: {success} | 失败: {failed}")
    print(f"   输出: {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
